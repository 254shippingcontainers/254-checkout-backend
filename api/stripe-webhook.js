import { stripeClient } from '../lib/stripe-checkout.js';

export const config = { api: { bodyParser: false } };
const relevant = new Set(['payment_intent.succeeded', 'payment_intent.amount_capturable_updated', 'payment_intent.payment_failed', 'payment_intent.canceled']);

export function makeHandler(getStripe = () => stripeClient({ requireCheckoutEnabled: false })) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).end();
    if (!process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: 'Webhook not configured.' });
    let stripe, event;
    try {
      stripe = getStripe();
      let raw;
      if (Buffer.isBuffer(req.body)) raw = req.body;
      else {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 1024 * 1024) throw new Error('Payload too large');
          chunks.push(Buffer.from(chunk));
        }
        raw = Buffer.concat(chunks);
      }
      event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    } catch {
      return res.status(400).json({ error: 'Invalid webhook signature or payload.' });
    }
    if (!relevant.has(event.type)) return res.status(200).json({ received: true });
    try {
      // Retrieve current state rather than trusting out-of-order event snapshots.
      // Stripe stores the order and customer details durably. This endpoint never
      // dispatches delivery or captures an authorization automatically.
      const intent = await stripe.paymentIntents.retrieve(event.data.object.id, { expand: ['latest_charge'] });
      if (intent.metadata?.application !== '254-container-checkout') return res.status(200).json({ received: true });
      if (Number(intent.metadata.quoted_total_cents) !== intent.amount) throw new Error('Order amount mismatch');
      const authentication = intent.latest_charge?.payment_method_details?.card?.three_d_secure;
      const paymentState = intent.status === 'succeeded' ? 'paid' : intent.status === 'requires_capture' ? 'authorized' : intent.status;
      const metadata = { order_payment_state: paymentState, authentication_result: authentication?.result || 'not_reported' };
      if (!intent.metadata.order_review_status) metadata.order_review_status = 'awaiting_mason_review';
      if (Object.entries(metadata).some(([key, value]) => intent.metadata[key] !== value)) {
        await stripe.paymentIntents.update(intent.id, { metadata });
      }
      return res.status(200).json({ received: true });
    } catch (error) {
      console.error('Stripe webhook reconciliation failed', { eventId: event.id, type: error.type || error.name });
      return res.status(500).json({ error: 'Event could not be processed. Retry required.' });
    }
  };
}
export default makeHandler();
