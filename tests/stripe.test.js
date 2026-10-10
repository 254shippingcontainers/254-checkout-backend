import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { makeHandler as checkoutHandler } from '../api/create-stripe-checkout.js';
import { makeHandler as statusHandler } from '../api/stripe-checkout-status.js';
import { makeHandler as webhookHandler } from '../api/stripe-webhook.js';
import { sessionParameters, paymentState, stripeClient } from '../lib/stripe-checkout.js';
import { normalizeSelection, calculateQuote } from '../lib/pricing.js';

const selection = { size: '20', grade: 'cw', color: 'beige', qty: 1, zip: '76457', taxExempt: false };
function response() { return { headers: {}, statusCode: 200, setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},end(){return this;} }; }

test('all product and delivery line items sum exactly to server total; 3DS challenge requested', () => {
  const products = [
    { size: '20', grade: 'cw' },
    { size: '20', grade: '1trip' },
    { size: '20os', grade: '1trip' },
    { size: '40hc', grade: 'cw' },
    { size: '40hc', grade: '1trip' }
  ];
  for(const {size,grade} of products) for(const taxExempt of [false,true]) for(const qty of [1,3]) {
    const quote=calculateQuote(normalizeSelection({...selection,size,grade,taxExempt,qty}),85);
    const params=sessionParameters(quote,'254-test','https://preview.example.com');
    assert.equal(params.line_items.reduce((sum,l)=>sum+l.price_data.unit_amount*l.quantity,0),quote.totalCents);
    assert.equal(params.payment_method_options.card.request_three_d_secure,'challenge');
    assert.equal(params.payment_intent_data.capture_method,taxExempt?'manual':'automatic');
    assert.equal(params.metadata.delivery_zip,'76457');
  }
});

test('20-foot open-side pricing is $5,200 and limited to one-trip beige', () => {
  const openSide = normalizeSelection({...selection,size:'20os',grade:'1trip',color:'beige'});
  assert.equal(calculateQuote(openSide,0).unitPriceCents,520000);
  assert.throws(
    () => normalizeSelection({...selection,size:'20os',grade:'cw',color:'beige'}),
    /valid container size and grade/
  );
  assert.throws(
    () => normalizeSelection({...selection,size:'20os',grade:'1trip',color:'darkgray'}),
    /offered in beige only/
  );
  const params = sessionParameters(calculateQuote(openSide,0),'254-open-side','https://preview.example.com');
  assert.match(params.line_items[0].price_data.product_data.name,/Open Side \(2 Door Sets\)/);
});

test('checkout ignores browser amounts and metadata', async () => {
  let submitted;
  const handler=checkoutHandler(()=>({checkout:{sessions:{create:async params=>{submitted=params;return {url:'https://checkout.stripe.com/c/pay/cs_test_mock'};}}}}));
  const res=response();
  await handler({method:'POST',headers:{origin:'https://www.254shippingcontainers.com'},body:{...selection,amount:1,metadata:{quoted_total_cents:'1'}}},res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.quote.total,2430.70);
  assert.equal(Number(submitted.metadata.quoted_total_cents),243070);
});

test('invalid quantity and untrusted origins cannot create Stripe sessions', async () => {
  let calls=0;
  const handler=checkoutHandler(()=>({checkout:{sessions:{create:async()=>{calls++;}}}}));
  let res=response();
  await handler({method:'POST',headers:{origin:'https://evil.example'},body:selection},res);
  assert.equal(res.statusCode,403);
  res=response();
  await handler({method:'POST',headers:{},body:{...selection,qty:0}},res);
  assert.equal(res.statusCode,400);assert.equal(calls,0);
});

test('preview rejects live Stripe credentials', () => {
  const old={key:process.env.STRIPE_SECRET_KEY,env:process.env.VERCEL_ENV};
  try {process.env.VERCEL_ENV='preview';process.env.STRIPE_SECRET_KEY='sk_live_fake';assert.throws(()=>stripeClient(),/sandbox key/);}
  finally { for(const [name,value] of [['STRIPE_SECRET_KEY',old.key],['VERCEL_ENV',old.env]]) {if(value===undefined)delete process.env[name];else process.env[name]=value;} }
});

test('only verified succeeded payment is paid; authorization and failed authentication remain distinct', () => {
  assert.equal(paymentState({payment_status:'paid',payment_intent:{status:'succeeded'}}),'paid');
  assert.equal(paymentState({payment_status:'unpaid',payment_intent:{status:'requires_capture'}}),'authorized');
  assert.equal(paymentState({payment_status:'unpaid',payment_intent:{status:'requires_payment_method'}}),'pending');
  assert.equal(paymentState({payment_status:'unpaid',payment_intent:{status:'requires_action'}}),'pending');
});

test('return status rejects sessions from another application', async () => {
  const handler=statusHandler(()=>({checkout:{sessions:{retrieve:async()=>({metadata:{},amount_total:100})}}}));
  const res=response();await handler({method:'GET',query:{session_id:'cs_test_mock'}},res);
  assert.equal(res.statusCode,404);
});

test('webhook rejects unsigned data and handles duplicate/out-of-order events by reconciling current status', async () => {
  const secret='whsec_unit_test';process.env.STRIPE_WEBHOOK_SECRET=secret;
  const sdk=new Stripe('sk_test_fake');
  let metadata={application:'254-container-checkout',quoted_total_cents:'243070'};
  let updates=0;
  const client={webhooks:sdk.webhooks,paymentIntents:{retrieve:async()=>({id:'pi_test',status:'succeeded',amount:243070,metadata,latest_charge:{payment_method_details:{card:{three_d_secure:{result:'authenticated'}}}}}),update:async(id,params)=>{updates++;metadata={...metadata,...params.metadata};}}};
  const handler=webhookHandler(()=>client);
  const body=Buffer.from(JSON.stringify({id:'evt_test',type:'payment_intent.payment_failed',data:{object:{id:'pi_test'}}}));
  let res=response();await handler({method:'POST',body,headers:{}},res);assert.equal(res.statusCode,400);
  const signature=sdk.webhooks.generateTestHeaderString({payload:body.toString(),secret});
  for(let i=0;i<2;i++){res=response();await handler({method:'POST',body,headers:{'stripe-signature':signature}},res);assert.equal(res.statusCode,200);}
  assert.equal(updates,1);assert.equal(metadata.order_payment_state,'paid');assert.equal(metadata.authentication_result,'authenticated');
  delete process.env.STRIPE_WEBHOOK_SECRET;
});


test('production gates new checkout but can reconcile existing payments; live credentials required', () => {
  const names=['STRIPE_SECRET_KEY','STRIPE_CHECKOUT_ENABLED','VERCEL_ENV'];
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  try {
    process.env.VERCEL_ENV='production';process.env.STRIPE_SECRET_KEY='rk_live_fake';
    delete process.env.STRIPE_CHECKOUT_ENABLED;
    assert.throws(()=>stripeClient(),/not enabled/);
    assert.ok(stripeClient({requireCheckoutEnabled:false}));
    process.env.STRIPE_CHECKOUT_ENABLED='true';
    assert.ok(stripeClient());
    process.env.STRIPE_SECRET_KEY='sk_test_fake';
    assert.throws(()=>stripeClient({requireCheckoutEnabled:false}),/live key/);
    const quote=calculateQuote(normalizeSelection(selection),0);
    const params=sessionParameters(quote,'254-test','https://254-checkout-backend.vercel.app');
    assert.equal(params.success_url,'https://254-checkout-backend.vercel.app/stripe-result.html?session_id={CHECKOUT_SESSION_ID}');
    assert.equal(params.cancel_url,'https://www.254shippingcontainers.com/calculator.html?checkout=cancelled');
  } finally {for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}}
});
