import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler } from '../api/quote-comparison.js';

function response() {
  return {
    headers: {}, statusCode: 200,
    setHeader(key, value){ this.headers[key] = value; },
    status(code){ this.statusCode = code; return this; },
    json(body){ this.body = body; return this; },
    end(){ return this; }
  };
}

test('quote comparison accepts a full address and returns taxable and exempt totals from the cheaper origin', async () => {
  const previousKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  try {
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      const fromDallas = body.origin.address.includes('Dallas');
      return {
        ok: true,
        json: async () => ({ routes: [{ distanceMeters: fromDallas ? 160934.4 : 80467.2 }] })
      };
    };
    const handler = makeHandler(fetchImpl);
    const res = response();
    await handler({
      method: 'POST', headers: {},
      body: {
        size: '20', grade: 'cw', color: 'beige', qty: 1,
        destination: '123 Main Street, Stephenville, TX 76401'
      }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.taxable.origin, 'depot');
    assert.equal(res.body.taxExempt.origin, 'depot');
    assert.equal(res.body.taxable.total, 2320.21);
    assert.equal(res.body.taxExempt.total, 2173.5);
    assert.equal(res.body.taxable.cardFee, 78.46);
    assert.equal(res.body.taxExempt.cardFee, 73.5);
  } finally {
    if (previousKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previousKey;
  }
});

test('quote comparison rejects incomplete destinations', async () => {
  const handler = makeHandler(async () => { throw new Error('route lookup should not run'); });
  const res = response();
  await handler({
    method: 'POST', headers: {},
    body: { size: '20', grade: 'cw', color: 'beige', qty: 1, destination: 'Hico' }
  }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_DESTINATION');
});
