import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { RequestError, clientKey, readJson } from './cloud-signups.mjs';
import { createNeonCommerceStorage } from './commerce-storage.mjs';
import {
  createStripeClient, INTEGRATION_IDENTIFIER, keyMode, PRODUCT_NAME,
  readCommerceConfiguration, siteOrigin, verifyCommerceReadiness, WEBHOOK_EVENTS,
} from './commerce-config.mjs';

const UNAVAILABLE = 'Purchases are temporarily unavailable. Please try again later.';
const TOKEN = /^[a-zA-Z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = value => createHash('sha256').update(value).digest('hex');
const objectId = value => typeof value === 'string' ? value : value?.id ?? null;
const privateToken = (id, secret) => createHmac('sha256', secret).update(`fabrevoie-order:v1:${id}`).digest('base64url');

function json(response, status, payload, headers = {}) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin', ...headers,
  });
  response.end(body);
}

function method(request, required) {
  if (request.method !== required) {
    request.resume?.();
    const error = new RequestError(405, 'This request method is not supported.');
    error.headers = { Allow: required };
    throw error;
  }
}

function sameOrigin(request, env) {
  const host = request.headers.host;
  if (typeof host !== 'string' || !host || /[\s/@\\?#]/u.test(host)) throw new RequestError(400, 'Invalid request host.');
  const origin = request.headers.origin;
  const parsed = siteOrigin(origin);
  const configured = siteOrigin(env.PUBLIC_SITE_URL);
  if (!configured) throw new Error('Commerce origin unavailable');
  const allowed = new Set([configured]);
  for (const domain of [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (domain) {
      const candidate = siteOrigin(`https://${domain}`);
      if (candidate) allowed.add(candidate);
    }
  }
  if (!parsed || origin !== parsed || !allowed.has(parsed) || new URL(parsed).host !== host.toLowerCase()
    || request.headers['sec-fetch-site'] === 'cross-site') {
    throw new RequestError(403, 'Please use the purchase controls on this website.');
  }
  return parsed;
}

function exactKeys(value, expected) {
  if (Object.keys(value).length !== expected.length || !expected.every(key => Object.hasOwn(value, key))) {
    throw new RequestError(400, 'Please check your request and try again.');
  }
}

function checkoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' && !url.port
      && !url.username && !url.password && url.pathname.startsWith('/c/pay/') ? value : null;
  } catch { return null; }
}

function publicOrder(order) {
  return {
    reference: order.reference, status: order.status, quantity: order.quantity,
    amountTotal: order.amount_total, currency: order.currency,
    dispatchNotice: order.dispatch_notice, mode: order.mode,
  };
}

export function checkoutParameters(order, token) {
  const snapshot = order.checkout_snapshot;
  const metadata = {
    fabrevoie_order_id: order.id, fabrevoie_mode: order.mode,
    fabrevoie_flow: INTEGRATION_IDENTIFIER,
  };
  return {
    mode: 'payment', integration_identifier: INTEGRATION_IDENTIFIER,
    line_items: [{ price: order.price_id, quantity: order.quantity }],
    client_reference_id: order.id, metadata,
    payment_intent_data: { metadata },
    success_url: `${snapshot.origin}/order.html#order=${token}`,
    cancel_url: `${snapshot.origin}/#fragrance`,
    expires_at: Math.floor(order.session_expires_at / 1000),
    automatic_tax: { enabled: true }, adaptive_pricing: { enabled: false },
    allow_promotion_codes: false,
    shipping_address_collection: { allowed_countries: snapshot.countries },
    shipping_options: snapshot.shippingRateIds.map(shipping_rate => ({ shipping_rate })),
    custom_text: { submit: { message: order.dispatch_notice } },
  };
}

/** Never read/re-serialize request.body: webhook verification needs exact bytes. */
export async function readWebhookBody(request) {
  const maximum = 1048576;
  const length = request.headers['content-length'];
  if (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) > maximum)) {
    request.resume?.();
    throw new RequestError(413, 'Webhook payload too large.');
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    let finished = false;
    const chunks = [];
    const timer = setTimeout(() => finish(new RequestError(408, 'Webhook request timed out.')), 5000);
    timer.unref?.();
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) { chunks.length = 0; request.resume?.(); reject(error); }
      else resolve(Buffer.concat(chunks));
    }
    request.on('data', chunk => {
      if (finished) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maximum) finish(new RequestError(413, 'Webhook payload too large.'));
      else chunks.push(bytes);
    });
    request.on('end', () => finish());
    request.on('error', () => finish(new RequestError(400, 'Webhook body could not be read.')));
    request.on('aborted', () => finish(new RequestError(400, 'Webhook request interrupted.')));
  });
}

function address(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(['line1', 'line2', 'city', 'state', 'postal_code', 'country']
    .map(key => [key, typeof value[key] === 'string' ? value[key].slice(0, 500) : null]));
}

function contact(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    name: typeof value.name === 'string' ? value.name.slice(0, 500) : null,
    email: typeof value.email === 'string' ? value.email.slice(0, 320) : null,
    phone: typeof value.phone === 'string' ? value.phone.slice(0, 100) : null,
    address: address(value.address),
  };
}

function verifySession(session, order) {
  const item = session.line_items?.data?.[0];
  const price = item?.price;
  if (session.id !== (order.stripe_session_id ?? session.id) || session.mode !== 'payment'
    || session.livemode !== (order.mode === 'live') || session.currency !== order.currency
    || session.client_reference_id !== order.id || session.metadata?.fabrevoie_order_id !== order.id
    || session.metadata?.fabrevoie_mode !== order.mode || session.metadata?.fabrevoie_flow !== INTEGRATION_IDENTIFIER
    || !session.automatic_tax?.enabled || session.line_items?.has_more
    || session.line_items?.data?.length !== 1 || item.quantity !== order.quantity
    || price?.id !== order.price_id || price.currency !== order.currency || price.unit_amount !== order.unit_amount
    || (session.total_details?.amount_discount ?? 0) !== 0) throw new Error('Checkout verification failed');
  const paid = session.payment_status === 'paid';
  const shipping = session.collected_information?.shipping_details ?? session.shipping_details;
  if (paid && (session.automatic_tax.status !== 'complete' || !Number.isSafeInteger(session.amount_total)
    || session.amount_total <= 0 || !objectId(session.payment_intent)
    || !order.checkout_snapshot.countries.includes(shipping?.address?.country))) {
    throw new Error('Paid checkout verification failed');
  }
  return {
    orderId: order.id, mode: order.mode, sessionId: session.id, expectedVersion: order.reconciliation_version,
    paymentIntentId: objectId(session.payment_intent), paymentConfirmed: paid,
    amountTotal: Number.isSafeInteger(session.amount_total) ? session.amount_total : null,
    taxAmount: Number.isSafeInteger(session.total_details?.amount_tax) ? session.total_details.amount_tax : null,
    shippingAmount: Number.isSafeInteger(session.total_details?.amount_shipping) ? session.total_details.amount_shipping : null,
    customer: contact(session.customer_details),
    shipping: shipping ? { name: typeof shipping.name === 'string' ? shipping.name.slice(0, 500) : null, address: address(shipping.address) } : null,
    refundedAmount: 0,
  };
}

async function refundsFor(stripe, paymentIntentId, order, amountTotal) {
  const refunds = [];
  let after;
  do {
    const page = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100, ...(after ? { starting_after: after } : {}) });
    for (const value of page.data) {
      if (objectId(value.payment_intent) !== paymentIntentId
        || !Number.isSafeInteger(value.amount) || value.amount <= 0 || value.currency !== order.currency
        || !['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(value.status)) throw new Error('Refund verification failed');
      refunds.push({ id: value.id, status: value.status, amount: value.amount, currency: value.currency });
    }
    if (!page.has_more) break;
    if (!page.data.length || refunds.length >= 1000) throw new Error('Refund reconciliation incomplete');
    after = page.data.at(-1).id;
  } while (true);
  const total = refunds.filter(item => item.status === 'succeeded').reduce((sum, item) => sum + item.amount, 0);
  if (!Number.isSafeInteger(total) || total > amountTotal) throw new Error('Refund amount verification failed');
  return { refunds, refundedAmount: total };
}

/** Shared Node/Vercel handlers; dependencies are injectable for isolated tests. */
export function createCommerceHandlers({ env = process.env, storage: injectedStorage, stripe: injectedStripe, logger = console } = {}) {
  let storagePromise;
  let stripePromise;
  let readyPromise;
  let readyUntil = 0;
  let readyKey;
  async function storage() {
    if (injectedStorage) return injectedStorage;
    if (!storagePromise) storagePromise = createNeonCommerceStorage(env.DATABASE_URL).catch(error => {
      storagePromise = undefined; throw error;
    });
    return storagePromise;
  }
  async function stripe() {
    if (injectedStripe) return injectedStripe;
    if (!stripePromise) stripePromise = createStripeClient(env).catch(error => {
      stripePromise = undefined; throw error;
    });
    return stripePromise;
  }
  async function readiness() {
    const config = readCommerceConfiguration(env, { hasStorage: Boolean(injectedStorage) });
    if (config.mode === 'disabled') throw new Error('Commerce disabled');
    const key = JSON.stringify(config);
    if (!readyPromise || Date.now() >= readyUntil || key !== readyKey) {
      readyKey = key;
      readyUntil = Date.now() + 30000;
      readyPromise = stripe().then(client => verifyCommerceReadiness(client, config)).catch(error => {
        readyPromise = undefined; throw error;
      });
    }
    return readyPromise;
  }
  async function rate(request, db, bucket, limit, windowMs) {
    const client = clientKey(request, env.RATE_LIMIT_SECRET, env);
    const key = createHmac('sha256', env.RATE_LIMIT_SECRET).update(`fabrevoie-commerce:${bucket}:${client}`).digest('hex');
    const retry = await db.consume(key, limit, windowMs);
    if (retry) {
      const error = new RequestError(429, 'Too many requests. Please try again shortly.');
      error.headers = { 'Retry-After': String(retry) };
      throw error;
    }
    return client;
  }
  function guarded(handler) {
    return async (request, response) => {
      try { await handler(request, response); }
      catch (error) {
        const expected = error instanceof RequestError;
        if (!expected) logger.error('Commerce request failed. No unverified order result was returned.');
        json(response, expected ? error.status : 503, { ok: false, message: expected ? error.message : UNAVAILABLE,
          ...(expected && error.code ? { code: error.code } : {}) }, expected ? error.headers ?? {} : {});
      }
    };
  }

  const commerce = guarded(async (request, response) => {
    method(request, 'GET');
    try {
      const config = await readiness();
      json(response, 200, { ok: true, available: true, mode: config.mode,
        product: { name: PRODUCT_NAME, unitAmount: config.unitAmount, currency: config.currency },
        quantityMax: config.quantityMax, dispatchNotice: config.dispatchNotice, shippingSummary: config.shippingSummary });
    } catch {
      json(response, 200, { ok: true, available: false, mode: 'disabled', quantityMax: 3, dispatchNotice: '' });
    }
  });

  const checkout = guarded(async (request, response) => {
    method(request, 'POST');
    const origin = sameOrigin(request, env);
    const body = await readJson(request);
    exactKeys(body, ['quantity', 'requestId']);
    if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 10
      || typeof body.requestId !== 'string' || !UUID.test(body.requestId)) throw new RequestError(400, 'Choose a valid quantity and try again.');
    const config = await readiness();
    if (body.quantity > config.quantityMax) throw new RequestError(400, 'This quantity is not available.');
    const db = await storage();
    const clientHash = await rate(request, db, 'checkout', 12, 900000);
    const requestHash = createHmac('sha256', env.ORDER_TOKEN_SECRET)
      .update(`fabrevoie-checkout:v1:${config.mode}:${origin}:${body.requestId.toLowerCase()}`).digest('hex');
    let order = await db.getByRequestHash(requestHash);
    if (!order) {
      const id = randomUUID();
      const now = Date.now();
      order = await db.createOrder({
        id, reference: `FBR-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`,
        request_hash: requestHash, token_hash: hash(privateToken(id, env.ORDER_TOKEN_SECRET)),
        client_hash: clientHash, mode: config.mode, price_id: config.priceId, unit_amount: config.unitAmount,
        currency: config.currency, quantity: body.quantity, dispatch_notice: config.dispatchNotice,
        checkout_snapshot: { origin, countries: config.countries, shippingRateIds: config.shippingRateIds,
          taxBehavior: config.taxBehavior, productTaxCode: config.productTaxCode },
        session_expires_at: Math.floor(now / 1000) * 1000 + 3600000, created_at: now, updated_at: now,
      });
    }
    if (order.quantity !== body.quantity || order.client_hash !== clientHash || order.mode !== config.mode
      || order.checkout_snapshot.origin !== origin || order.price_id !== config.priceId
      || order.dispatch_notice !== config.dispatchNotice
      || JSON.stringify(order.checkout_snapshot.countries) !== JSON.stringify(config.countries)
      || JSON.stringify(order.checkout_snapshot.shippingRateIds) !== JSON.stringify(config.shippingRateIds)) {
      const error = new RequestError(409, 'Start a new checkout for this selection.');
      error.code = 'CHECKOUT_RESTART_REQUIRED';
      throw error;
    }
    if (order.session_expires_at <= Date.now() || !['pending', 'processing'].includes(order.status)) {
      const error = new RequestError(409, 'This checkout has ended. Please start a new checkout.');
      error.code = 'CHECKOUT_RESTART_REQUIRED';
      throw error;
    }
    const savedUrl = checkoutUrl(order.checkout_url);
    if (savedUrl) { json(response, 200, { ok: true, url: savedUrl }); return; }
    // Stripe requires expires_at to be at least 30 minutes after creation.
    // Keep the original idempotent parameters; an old uncreated intent restarts.
    if (!order.stripe_session_id && order.session_expires_at - Date.now() < 31 * 60000) {
      const error = new RequestError(409, 'This checkout has ended. Please start a new checkout.');
      error.code = 'CHECKOUT_RESTART_REQUIRED';
      throw error;
    }
    const owner = randomUUID();
    if (!(await db.claimCreation(order.id, owner))) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 75));
        const existing = await db.getOrder(order.id);
        const url = checkoutUrl(existing?.checkout_url);
        if (url) { json(response, 200, { ok: true, url }); return; }
      }
      const error = new RequestError(409, 'Your checkout is being prepared. Please try again shortly.');
      error.headers = { 'Retry-After': '2' };
      error.code = 'CHECKOUT_IN_PROGRESS';
      throw error;
    }
    try {
      const token = privateToken(order.id, env.ORDER_TOKEN_SECRET);
      if (!timingSafeEqual(Buffer.from(hash(token)), Buffer.from(order.token_hash))) throw new Error('Order token unavailable');
      const client = await stripe();
      const session = await client.checkout.sessions.create(checkoutParameters(order, token),
        { idempotencyKey: `fabrevoie-checkout-${order.id}` });
      if (!/^cs_(?:test|live)_[a-zA-Z0-9]+$/.test(session.id) || session.livemode !== (order.mode === 'live')
        || !checkoutUrl(session.url)) throw new Error('Checkout redirect verification failed');
      await db.attachSession(order.id, owner, session);
      json(response, 200, { ok: true, url: session.url });
    } finally { await db.releaseCreation(order.id, owner); }
  });

  const orderStatus = guarded(async (request, response) => {
    method(request, 'POST');
    sameOrigin(request, env);
    const body = await readJson(request);
    exactKeys(body, ['token']);
    if (typeof body.token !== 'string' || !TOKEN.test(body.token)) throw new RequestError(400, 'A valid private order link is required.');
    const db = await storage();
    await rate(request, db, 'order-status', 120, 300000);
    const order = await db.getByTokenHash(hash(body.token));
    if (!order) throw new RequestError(404, 'This order link could not be found.');
    json(response, 200, { ok: true, order: publicOrder(order) });
  });

  const webhook = guarded(async (request, response) => {
    method(request, 'POST');
    const signature = request.headers['stripe-signature'];
    if (typeof signature !== 'string' || signature.length > 2048) throw new RequestError(400, 'Invalid webhook signature.');
    const mode = keyMode(env.STRIPE_SECRET_KEY);
    if (!mode || typeof env.STRIPE_WEBHOOK_SECRET !== 'string' || !/^whsec_[a-zA-Z0-9]{16,}$/.test(env.STRIPE_WEBHOOK_SECRET)) {
      throw new Error('Webhook configuration unavailable');
    }
    const raw = await readWebhookBody(request);
    const client = await stripe();
    let event;
    try { event = client.webhooks.constructEvent(raw, signature, env.STRIPE_WEBHOOK_SECRET); }
    catch { throw new RequestError(400, 'Invalid webhook signature.'); }
    if (!/^evt_[a-zA-Z0-9]+$/.test(event.id) || event.livemode !== (mode === 'live')
      || !Number.isSafeInteger(event.created) || event.created < 1 || !event.data?.object) throw new RequestError(400, 'Invalid webhook event.');
    const db = await storage();
    if (await db.hasEvent(event.id)) { json(response, 200, { ok: true }); return; }
    if (!WEBHOOK_EVENTS.has(event.type)) { await db.ignoreEvent(event); json(response, 200, { ok: true }); return; }
    const object = event.data.object;
    const refundEvent = !event.type.startsWith('checkout.session.');
    let sessionId;
    let order;
    if (!refundEvent) {
      sessionId = object.id;
      order = await db.getBySession(sessionId);
      if (!order && object.metadata?.fabrevoie_flow === INTEGRATION_IDENTIFIER) {
        if (!UUID.test(object.metadata.fabrevoie_order_id ?? '')) throw new Error('Order association missing');
        order = await db.getOrder(object.metadata.fabrevoie_order_id);
        if (!order) throw new Error('Order intent unavailable');
      }
    } else {
      const intent = objectId(object.payment_intent);
      if (intent) {
        order = await db.getByPaymentIntent(intent);
        if (!order) {
          const sessions = await client.checkout.sessions.list({ payment_intent: intent, limit: 2 });
          const ours = sessions.data.filter(item => item.metadata?.fabrevoie_flow === INTEGRATION_IDENTIFIER);
          if (ours.length === 1) {
            order = await db.getOrder(ours[0].metadata.fabrevoie_order_id);
            sessionId = ours[0].id;
            if (!order) throw new Error('Refund order intent unavailable');
          }
        }
        sessionId ??= order?.stripe_session_id;
      }
    }
    if (!order) { await db.ignoreEvent(event); json(response, 200, { ok: true }); return; }
    if (!sessionId || order.mode !== mode) throw new Error('Order event association failed');
    const session = await client.checkout.sessions.retrieve(sessionId, { expand: ['line_items.data.price'] });
    const update = verifySession(session, order);
    if (refundEvent) {
      if (!update.paymentConfirmed) throw new Error('Refund payment verification failed');
      Object.assign(update, await refundsFor(client, update.paymentIntentId, order, update.amountTotal));
      update.status = 'paid';
    } else if (update.paymentConfirmed) update.status = 'paid';
    else if (event.type === 'checkout.session.async_payment_failed') update.status = 'payment_failed';
    else if (event.type === 'checkout.session.expired' || session.status === 'expired') update.status = 'expired';
    else update.status = 'processing';
    await db.applyEvent(event, update);
    json(response, 200, { ok: true });
  });

  return { commerce, checkout, orderStatus, webhook };
}
