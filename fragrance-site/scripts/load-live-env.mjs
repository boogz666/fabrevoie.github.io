// Explicit private operator preload: node --import ./scripts/load-live-env.mjs ...
// Vercel cannot export sensitive values; .env.local remains the sandbox profile.
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {keyMode} from '../lib/commerce-config.mjs';

const live=parseEnv(await readFile(new URL('../.env.stripe-live.local',import.meta.url),'utf8'));
if(keyMode(live.STRIPE_SECRET_KEY)!=='live'||!/^whsec_[a-zA-Z0-9]{16,}$/.test(live.STRIPE_WEBHOOK_SECRET||'')){
  throw new Error('A complete private live Stripe profile is required. No credentials were printed.');
}
for(const name of ['STRIPE_PRODUCT_ID','STRIPE_PRICE_ID']){
  if(process.env[name]&&process.env[name]!==live[name])throw new Error(`The supplied ${name} does not match the private live profile.`);
  if(live[name])process.env[name]=live[name];
}
process.env.STRIPE_SECRET_KEY=live.STRIPE_SECRET_KEY;
process.env.STRIPE_WEBHOOK_SECRET=live.STRIPE_WEBHOOK_SECRET;
if(!process.env.ORDER_TOKEN_SECRET){
  const retained=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));
  if(retained.ORDER_TOKEN_SECRET)process.env.ORDER_TOKEN_SECRET=retained.ORDER_TOKEN_SECRET;
}
// Never change commerce mode, database, inventory, tax or shipping configuration.
