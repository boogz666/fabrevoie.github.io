import {access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createNeonCommerceStorage, createSqliteCommerceStorage} from '../lib/commerce-storage.mjs';
import {InventoryError, PRODUCT_SKU, validSku} from '../lib/commerce-inventory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKU = PRODUCT_SKU;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USAGE = `Private FABREVOIE inventory and dispatch
  status --mode test|live [--cloud]
  audit --mode test|live [--cloud]
  holds --mode test|live [--cloud]
  adjust --mode test|live --delta INTEGER --reason SLUG --operation-id UUID [--cloud]
  ship --mode test|live --order REFERENCE --carrier NAME --tracking-number NUMBER
       [--tracking-url HTTPS_URL] --reason dispatch_confirmed --operation-id UUID [--cloud]
  return --mode test|live --order REFERENCE --reason return_received --operation-id UUID [--cloud]
  ready --mode test|live --order REFERENCE --reason payment_reviewed --operation-id UUID [--cloud]
  review --mode test|live --order REFERENCE --reason dispatch_review --operation-id UUID [--cloud]
  allocate --mode test|live --order REFERENCE --reason stock_resolved --operation-id UUID [--cloud]
  reconcile --mode test|live --order REFERENCE --operation-id UUID [--cloud]
Stock changes and shipment records do not charge, refund, buy postage or send messages.`;

export class InventoryCommandError extends Error {}

export function parseInventoryArguments(args) {
  if (!args.length || args.length === 1 && ['--help','-h'].includes(args[0])) return {help:true};
  const [command,...rest] = args;
  if (!['status','audit','holds','adjust','ship','return','ready','review','allocate','reconcile'].includes(command)) throw new InventoryCommandError(USAGE);
  const options = {command,cloud:false};
  const allowed = new Set(['mode','delta','reason','operation-id','order','carrier','tracking-number','tracking-url']);
  for (let index=0;index<rest.length;index++) {
    const argument=rest[index];
    if(argument==='--cloud') {if(options.cloud)throw new InventoryCommandError('Do not repeat --cloud.');options.cloud=true;continue;}
    if(!argument.startsWith('--')||!allowed.has(argument.slice(2))||index+1===rest.length||rest[index+1].startsWith('--')||Object.hasOwn(options,argument.slice(2)))throw new InventoryCommandError(USAGE);
    options[argument.slice(2)]=rest[++index];
  }
  if(!['test','live'].includes(options.mode))throw new InventoryCommandError('Choose --mode test or --mode live explicitly.');
  const commandOptions = {
    status:[],audit:[],holds:[],adjust:['delta','reason','operation-id'],
    ship:['order','carrier','tracking-number','tracking-url','reason','operation-id'],
    return:['order','reason','operation-id'],
    ready:['order','reason','operation-id'],review:['order','reason','operation-id'],
    allocate:['order','reason','operation-id'],reconcile:['order','operation-id'],
  };
  if(Object.keys(options).some(key=>!['command','cloud','mode',...commandOptions[command]].includes(key)))throw new InventoryCommandError('An option does not apply to this command.');
  if(['adjust','ship','return','ready','review','allocate','reconcile'].includes(command)) {
    if(!UUID.test(options['operation-id']||''))throw new InventoryCommandError('Supply a UUID --operation-id and reuse it when retrying the same change.');
    if(command!=='reconcile'&&!/^[a-z][a-z0-9_]{2,63}$/.test(options.reason||''))throw new InventoryCommandError('Use a short non-personal reason slug, such as initial_stock or return_received.');
  }
  if(command==='adjust') {
    if(!/^-?\d+$/.test(options.delta||'')||!Number.isSafeInteger(Number(options.delta))||Math.abs(Number(options.delta))>1000000)throw new InventoryCommandError('Stock adjustment must be an integer between -1000000 and 1000000.');
    options.delta=Number(options.delta);
  }
  if(['ship','return','ready','review','allocate','reconcile'].includes(command)&&!(/^[a-z0-9-]{6,80}$/i.test(options.order||'')))throw new InventoryCommandError('Supply a valid order reference or order ID.');
  if(command==='ship') {
    if(typeof options.carrier!=='string'||!options.carrier.trim()||options.carrier.length>80||/[\u0000-\u001f\u007f]/.test(options.carrier))throw new InventoryCommandError('A carrier name is required.');
    if(!/^[a-z0-9 ._/-]{1,100}$/i.test(options['tracking-number']||''))throw new InventoryCommandError('A valid tracking number is required.');
    if(options['tracking-url']) {
      let url;try {url=new URL(options['tracking-url']);}catch{}
      if(!url||url.protocol!=='https:'||url.username||url.password||options['tracking-url'].length>500)throw new InventoryCommandError('Tracking links must be HTTPS URLs without embedded credentials.');
    }
  }
  return options;
}

function publicOrderSummary(order) {
  return {reference:order.reference,mode:order.mode,paymentStatus:order.status,
    fulfillmentStatus:order.fulfillment_status || 'awaiting_dispatch',quantity:order.quantity,
    createdAt:new Date(order.created_at).toISOString()};
}

async function lookupOrder(storage, reference, mode, sku) {
  let order = UUID.test(reference) ? await storage.getOrder(reference) : null;
  if (!order) {
    const rows = await storage.listOrders({limit:10000});
    if(rows.length>=10000)throw new InventoryCommandError('Use the exact order ID for this large order history.');
    order=rows.find(item=>item.reference.toLowerCase()===reference.toLowerCase());
  }
  if(!order||order.mode!==mode||order.sku!==sku)throw new InventoryCommandError('Order not found in the selected mode and SKU. No change was made.');
  return order;
}

export async function runInventory({args=process.argv.slice(2),env=process.env,storage:injected,stripe:injectedStripe,log=console.log}={}) {
  const options=parseInventoryArguments(args);
  if(options.help){log(USAGE);return;}
  const dataDir=path.resolve(root,env.DATA_DIR||'data');
  const sku=env.COMMERCE_SKU||SKU;
  if(!validSku(sku))throw new InventoryCommandError('The inventory SKU is not configured correctly.');
  let storage=injected;
  if(!storage) {
    if(options.cloud&&!env.DATABASE_URL)throw new InventoryCommandError('Cloud inventory is not configured; no local fallback was used.');
    if(!options.cloud) {
      try {await access(path.join(dataDir,'commerce.sqlite'));}
      catch {throw new InventoryCommandError('No local commerce database exists. Start the local server or choose --cloud explicitly.');}
    }
    storage=options.cloud?await createNeonCommerceStorage(env.DATABASE_URL):await createSqliteCommerceStorage(dataDir);
  }
  try {
    const scope={mode:options.mode,sku};
    let result;
    if(options.command==='status') {
      const inventory=await storage.getInventory(scope);
      const orders=await storage.listOrders({limit:10000});
      if(orders.length>=10000)throw new InventoryCommandError('Order history exceeds this report limit; use a database report for complete totals.');
      const selected=orders.filter(order=>order.mode===options.mode&&order.sku===sku);
      result={source:options.cloud?'cloud':'local',inventory,orders:{
        total:selected.length,awaitingDispatch:selected.filter(order=>order.status==='paid'&&order.fulfillment_status==='awaiting_dispatch').length,
        shipped:selected.filter(order=>order.fulfillment_status==='shipped').length,
        returned:selected.filter(order=>order.fulfillment_status==='returned').length,
        needsReview:selected.filter(order=>order.fulfillment_status==='needs_review').length},
        note:'Available is the remaining online selling allocation. A paid order still requires merchant dispatch.'};
    } else if(options.command==='audit') {
      const entries=await storage.listInventoryAudit({...scope,limit:100});
      result={...scope,entries};
    } else if(options.command==='holds') {
      const orders=await storage.listHeldOrders({...scope,limit:100});
      result={...scope,holds:orders.map(publicOrderSummary),note:'Held units remain reserved until verified payment failure or Checkout expiry. Cancellation-page visits do not release stock.'};
    } else if(options.command==='adjust') {
      result={inventory:await storage.adjustInventory({...scope,delta:options.delta,reason:options.reason,operationId:options['operation-id']}),operationId:options['operation-id']};
    } else {
      const order=await lookupOrder(storage,options.order,options.mode,sku);
      let updated;
      if(options.command==='allocate') {
        updated=await storage.resolveAllocation({orderId:order.id,reason:options.reason,operationId:options['operation-id']});
      } else if(options.command==='reconcile') {
        const {keyMode,createStripeClient}=await import('../lib/commerce-config.mjs');
        if(keyMode(env.STRIPE_SECRET_KEY)!==options.mode)throw new InventoryCommandError('Stripe credentials must match the selected inventory mode.');
        const {reconcileStoredOrder}=await import('../lib/commerce.mjs');
        await reconcileStoredOrder({orderId:order.id,storage,stripe:injectedStripe||await createStripeClient(env),operationId:options['operation-id']});
        updated=await storage.getOrder(order.id);
      } else {
        updated=await storage.setFulfillment({orderId:order.id,status:{ship:'shipped',return:'returned',ready:'awaiting_dispatch',review:'needs_review'}[options.command],
          carrier:options.carrier,trackingNumber:options['tracking-number'],trackingUrl:options['tracking-url'],
          reason:options.reason,operationId:options['operation-id']});
      }
      result={order:publicOrderSummary(updated),operationId:options['operation-id'],
        note:{ship:'Dispatch recorded. No label was purchased or message sent.',return:'Return recorded. Stock and refunds were not changed automatically.',
          ready:'Paid, allocated order cleared for dispatch after review. Nothing was shipped or charged.',review:'Order flagged for merchant review. Stock and payments were not changed.',
          allocate:'Existing stock allocated to this paid order. No new payment was taken.',reconcile:'Stored order reconciled with Stripe. No payment, refund or message was created.'}[options.command]};
    }
    log(JSON.stringify(result,null,2));
    return result;
  } finally {if(!injected)await storage.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {await runInventory();}
  catch(error) {console.error(error instanceof InventoryCommandError||error instanceof InventoryError?error.message:'Inventory operation could not complete. Check the selected mode, stock, payment and fulfillment state; private provider details were not printed.');process.exitCode=1;}
}
