import { randomUUID } from 'node:crypto';
import { buildQuote, publicQuote, sendQuoteError, setCors } from '../lib/pricing.js';
import { stripeClient, sessionParameters, checkoutOrigin } from '../lib/stripe-checkout.js';

export function makeHandler(getStripe = stripeClient) {
  return async (req, res) => {
    const allowed = setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(allowed ? 204 : 403).end();
    if (!allowed) return res.status(403).json({ error: 'Origin not allowed.' });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
    try {
      const stripe = getStripe();
      const quote = await buildQuote(req.body || {});
      const orderReference = `254-${randomUUID().toUpperCase()}`;
      const session = await stripe.checkout.sessions.create(
        sessionParameters(quote, orderReference, checkoutOrigin()),
        { idempotencyKey: orderReference }
      );
      const url = new URL(session.url);
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('Invalid Stripe URL');
      return res.status(200).json({ checkoutUrl: session.url, orderReference, quote: publicQuote(quote) });
    } catch (error) {
      if (error.name === 'QuoteError') return sendQuoteError(res, error);
      console.error('Stripe checkout failed', { type: error.type || error.name, code: error.code });
      return res.status(502).json({ error: 'We could not start secure checkout. Please try again or call Mason.', code: 'CHECKOUT_INITIALIZATION_FAILED' });
    }
  };
}
export default makeHandler();
