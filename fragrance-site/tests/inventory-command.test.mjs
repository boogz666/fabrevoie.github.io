import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseInventoryArguments,runInventory} from '../scripts/inventory.mjs';

const operationId=randomUUID();
const order={id:randomUUID(),reference:'FBR-123456789ABC',mode:'test',sku:'ULTRAMACHO-100ML-IRIS',status:'paid',quantity:1,
  fulfillment_status:'awaiting_dispatch',created_at:1789171200000,customer:{email:'private@example.test'},token_hash:'private-token'};

test('inventory CLI requires an explicit mode, bounded adjustment and retry identity',()=>{
  for(const args of [['adjust','--delta','2'],['status','--mode','bad'],['adjust','--mode','test','--delta','1'],
    ['adjust','--mode','test','--delta','1e3','--reason','initial_stock','--operation-id',operationId],
    ['status','--mode','test','--delta','1']])assert.throws(()=>parseInventoryArguments(args));
  const parsed=parseInventoryArguments(['adjust','--cloud','--mode','test','--delta','-2','--reason','damaged_stock','--operation-id',operationId]);
  assert.equal(parsed.delta,-2);assert.equal(parsed['operation-id'],operationId);assert.equal(parsed.cloud,true);
});

test('shipment input refuses non-HTTPS tracking and embedded URL credentials',()=>{
  const base=['ship','--mode','test','--order',order.reference,'--carrier','Carrier','--tracking-number','TEST123','--reason','dispatch_confirmed','--operation-id',operationId];
  for(const url of ['javascript:alert(1)','http://example.test/track','https://private:password@example.test/'])assert.throws(()=>parseInventoryArguments([...base,'--tracking-url',url]));
  assert.equal(parseInventoryArguments([...base,'--tracking-url','https://carrier.example/TEST123']).command,'ship');
});

test('status and hold reports separate test/live, never expose customer or capability data',async()=>{
  const storage={getInventory:async scope=>({...scope,configured:true,capacity:4,held:1,committed:1,available:2}),
    listOrders:async()=>[order,{...order,id:randomUUID(),mode:'live'},{...order,id:randomUUID(),sku:'QA-OTHER'}],listHeldOrders:async()=>[order]};
  let output='';const log=text=>{output+=text;};
  const result=await runInventory({args:['status','--mode','test'],env:{},storage,log});
  assert.equal(result.orders.total,1);assert.equal(result.orders.awaitingDispatch,1);
  await runInventory({args:['holds','--mode','test'],env:{},storage,log});
  assert.doesNotMatch(output,/private@example|private-token|customer|token_hash/);
});

test('cloud operations never fall back to local storage and order mode must match',async()=>{
  await assert.rejects(runInventory({args:['status','--cloud','--mode','test'],env:{},log(){}}),/no local fallback/);
  let writes=0;const storage={getOrder:async()=>null,listOrders:async()=>[order],setFulfillment:async()=>{writes++;}};
  await assert.rejects(runInventory({args:['return','--mode','live','--order',order.reference,'--reason','return_received','--operation-id',operationId],env:{},storage,log(){}}),/selected mode/);
  assert.equal(writes,0);
});

test('stock adjustments preserve explicit reason and operation ID across retries',async()=>{
  const calls=[];const storage={adjustInventory:async input=>{calls.push(input);return {available:5};}};
  const args=['adjust','--mode','test','--delta','5','--reason','initial_stock','--operation-id',operationId];
  await runInventory({args,env:{},storage,log(){}});await runInventory({args,env:{},storage,log(){}});
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].sku,'ULTRAMACHO-100ML-IRIS');
  assert.equal(calls[0].operationId,operationId);
});

test('review and dispatch clearance preserve deliberate operator identity',async()=>{
  const calls=[];const storage={getOrder:async()=>order,setFulfillment:async input=>{calls.push(input);return {...order,fulfillment_status:input.status};}};
  for(const [command,status] of [['review','needs_review'],['ready','awaiting_dispatch']]){
    const result=await runInventory({args:[command,'--mode','test','--order',order.id,'--reason','payment_reviewed','--operation-id',operationId],env:{},storage,log(){}});
    assert.equal(result.order.fulfillmentStatus,status);
    assert.equal(calls.at(-1).operationId,operationId);
    assert.equal(calls.at(-1).orderId,order.id);
  }
});

test('reconciliation refuses mismatched Stripe mode before provider access',async()=>{
  const storage={getOrder:async()=>order};
  await assert.rejects(runInventory({args:['reconcile','--mode','test','--order',order.id,'--operation-id',operationId],
    env:{STRIPE_SECRET_KEY:'sk_live_fixture'},storage,stripe:{},log(){}}),/credentials must match/);
});
