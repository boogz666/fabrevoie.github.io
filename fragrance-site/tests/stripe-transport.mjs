// Creates and immediately expires a clearly labeled sandbox Checkout fixture.
// Verifies real Stripe-signed delivery, not a paid order or Stripe Tax calculation.
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { STRIPE_API_VERSION, INTEGRATION_IDENTIFIER } from '../lib/commerce-config.mjs';

if (!process.argv.includes('--sandbox-write') || !/^sk_test_/.test(process.env.STRIPE_SECRET_KEY || '')) {
  console.error('This explicit transport check requires --sandbox-write and the dedicated sandbox secret.');
  process.exit(1);
}
const origin = 'https://fabrevoie.com';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {apiVersion:STRIPE_API_VERSION,timeout:10000,maxNetworkRetries:1});
const report = {type:'real Stripe sandbox webhook transport',paidOrderVerified:false,taxCalculationVerified:false,passed:false};
let session;
try {
  const probe = await fetch(`${origin}/api/stripe-webhook`, {method:'POST',body:'{}'});
  assert.equal(probe.status,400,'Deploy the signed webhook handler before running this check.');
  const endpoint = (await stripe.webhookEndpoints.list({limit:100})).data.find(item => item.url === `${origin}/api/stripe-webhook` && !item.livemode && item.status === 'enabled');
  assert.ok(endpoint?.enabled_events.includes('checkout.session.expired'));
  const runId = randomUUID();
  session = await stripe.checkout.sessions.create({mode:'payment',integration_identifier:INTEGRATION_IDENTIFIER,
    line_items:[{quantity:1,price_data:{currency:'eur',unit_amount:100,product_data:{
      name:'FABREVOIE webhook transport QA — not for sale',metadata:{purpose:'webhook-transport-qa'}}}}],
    success_url:`${origin}/order.html`,cancel_url:`${origin}/`,automatic_tax:{enabled:false},
    metadata:{purpose:'webhook-transport-qa',run_id:runId}}, {idempotencyKey:`fabrevoie-transport-${runId}`});
  assert.equal(session.livemode,false);
  await stripe.checkout.sessions.expire(session.id);
  report.sessionId = session.id;
  report.endpointId = endpoint.id;
  let event;
  for (let attempt=0;attempt<15;attempt++) {
    const events = await stripe.events.list({type:'checkout.session.expired',limit:20});
    event = events.data.find(item => item.data.object.id === session.id);
    if (event && event.pending_webhooks === 0) break;
    await new Promise(resolve => setTimeout(resolve,2000));
  }
  assert.ok(event,'Stripe expiry event was not observed.');
  report.eventId = event.id;
  report.pendingWebhooks = event.pending_webhooks;
  assert.equal(event.pending_webhooks,0,'Stripe delivery is still pending; inspect deployed endpoint.');
  report.passed = true;
  console.log(JSON.stringify(report,null,2));
} catch(error) {
  const code = /^[a-zA-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'unspecified';
  const parameter = /^[a-zA-Z0-9_[\].]{1,80}$/.test(error.param || '') ? error.param : 'unspecified';
  console.error(`Sandbox transport verification did not complete (code ${code}, parameter ${parameter}). Provider details withheld.`);
  process.exitCode=1;
} finally {
  if (session) {
    try {
      const current = await stripe.checkout.sessions.retrieve(session.id,{expand:['line_items.data.price.product']});
      if (current.status === 'open') await stripe.checkout.sessions.expire(session.id);
      const price = current.line_items?.data?.[0]?.price;
      const product = price?.product;
      // Inline Checkout catalog objects are already inactive and cannot be edited.
      if (price?.id && price.active) await stripe.prices.update(price.id,{active:false});
      if (product?.id && product.active) await stripe.products.update(product.id,{active:false});
      report.fixtureArchived = true;
    } catch { report.fixtureArchived=false;console.error('Sandbox QA fixture cleanup needs review.');process.exitCode=1; }
  }
  await mkdir('tests/artifacts',{recursive:true});
  await writeFile('tests/artifacts/stripe-transport-report.json',JSON.stringify(report,null,2));
}
