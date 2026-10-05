import { stripeClient, paymentState, isOurSession } from '../lib/stripe-checkout.js';

export function makeHandler(getStripe = stripeClient) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
    const id = req.query?.session_id;
    if (typeof id !== 'string' || !/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(id)) return res.status(400).json({ error: 'Invalid checkout reference.' });
    try {
      const session = await getStripe().checkout.sessions.retrieve(id, { expand: ['payment_intent'] });
      if (!isOurSession(session)) return res.status(404).json({ error: 'Checkout not found.' });
      return res.status(200).json({
        status: paymentState(session), orderReference: session.client_reference_id,
        total: session.amount_total / 100, taxExempt: session.metadata.tax_exempt === 'true',
        testMode: !session.livemode, deliveryReviewRequired: true
      });
    } catch {
      return res.status(503).json({ error: 'We could not verify checkout yet. Please contact Mason before retrying payment.' });
    }
  };
}
export default makeHandler();
