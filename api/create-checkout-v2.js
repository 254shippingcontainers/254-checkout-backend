import { randomUUID } from 'node:crypto';
import { buildQuote, publicQuote, sendQuoteError, setCors } from '../lib/pricing.js';

export default async function handler(req, res) {
  const originAllowed = setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(originAllowed ? 204 : 403).end();
  if (!originAllowed) return res.status(403).json({ error: 'Origin not allowed.', code: 'ORIGIN_NOT_ALLOWED' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  try {
    if (!process.env.HELCIM_API_TOKEN) {
      return res.status(503).json({ error: 'Checkout is temporarily unavailable.', code: 'CHECKOUT_NOT_CONFIGURED' });
    }

    // The server independently calculates every amount. It never accepts a
    // browser-supplied price, tax, delivery fee, card fee, or total.
    const quote = await buildQuote(req.body || {});
    const orderReference = `254-${randomUUID().split('-')[0].toUpperCase()}`;
    const amount = Number((quote.totalCents / 100).toFixed(2));

    const helcimResponse = await fetch('https://api.helcim.com/v2/helcim-pay/initialize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-token': process.env.HELCIM_API_TOKEN
      },
      body: JSON.stringify({
        paymentType: quote.paymentType,
        amount,
        currency: 'USD',
        confirmationScreen: true
      })
    });

    const data = await helcimResponse.json().catch(() => ({}));
    if (!helcimResponse.ok || !data.checkoutToken) {
      console.error('Helcim initialization failed', {
        status: helcimResponse.status,
        orderReference,
        helcimErrors: data?.errors || data?.error || 'Unknown Helcim response'
      });
      return res.status(502).json({
        error: 'We could not start the secure checkout. Please try again or call us.',
        code: 'CHECKOUT_INITIALIZATION_FAILED'
      });
    }

    return res.status(200).json({
      checkoutToken: data.checkoutToken,
      orderReference,
      quote: publicQuote(quote)
    });
  } catch (error) {
    return sendQuoteError(res, error);
  }
}
