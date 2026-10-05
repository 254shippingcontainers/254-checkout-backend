import Stripe from 'stripe';
import { QuoteError } from './pricing.js';

export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new QuoteError('STRIPE_NOT_CONFIGURED', 'Secure checkout is temporarily unavailable.', 503);
  if (process.env.VERCEL_ENV === 'production' && process.env.STRIPE_CHECKOUT_ENABLED !== 'true') {
    throw new QuoteError('STRIPE_NOT_ENABLED', 'Stripe checkout is not enabled yet.', 503);
  }
  if (process.env.VERCEL_ENV === 'preview' && !key.startsWith('sk_test_') && !key.startsWith('rk_test_')) {
    throw new QuoteError('STRIPE_MODE_MISMATCH', 'Test checkout requires a sandbox key.', 503);
  }
  return new Stripe(key, { maxNetworkRetries: 1, timeout: 10000 });
}

export function checkoutOrigin() {
  const value = process.env.STRIPE_SITE_URL ||
    (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}` : 'https://www.254shippingcontainers.com');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new QuoteError('INVALID_CHECKOUT_ORIGIN', 'Secure checkout is not configured correctly.', 503);
  }
  return url.origin;
}

export function sessionParameters(quote, orderReference, origin) {
  const selection = quote.selection;
  const size = selection.size === '20' ? "20-foot Standard" : "40-foot High Cube";
  const grade = selection.grade === 'cw' ? 'Cargo Worthy' : 'One Trip';
  const line = (name, amount, quantity = 1) => ({
    price_data: { currency: 'usd', unit_amount: amount, product_data: { name } }, quantity
  });
  const metadata = {
    application: '254-container-checkout', order_reference: orderReference,
    size: selection.size, grade: selection.grade, color: selection.color,
    quantity: String(selection.qty), delivery_zip: selection.zip,
    route_miles: String(quote.routeMiles), tax_exempt: String(selection.taxExempt),
    quoted_total_cents: String(quote.totalCents), delivery_review: 'required'
  };
  return {
    mode: 'payment', payment_method_types: ['card'],
    payment_method_options: { card: { request_three_d_secure: 'challenge' } },
    payment_intent_data: {
      capture_method: selection.taxExempt ? 'manual' : 'automatic', metadata,
      description: `${orderReference}: ${selection.qty} × ${size} ${grade}; delivery ZIP ${selection.zip}`
    },
    metadata, client_reference_id: orderReference,
    billing_address_collection: 'required',
    shipping_address_collection: { allowed_countries: ['US'] },
    phone_number_collection: { enabled: true },
    line_items: [
      line(`${size} ${grade} — ${selection.color}`, quote.unitPriceCents, selection.qty),
      ...(quote.deliveryCents ? [line(`Tilt-Bed Delivery to ${selection.zip}`, quote.deliveryCents)] : []),
      ...(quote.taxCents ? [line('Sales Tax (6.75%)', quote.taxCents)] : []),
      ...(quote.cardFeeCents ? [line('Card Processing Fee (3.5%)', quote.cardFeeCents)] : [])
    ],
    custom_text: { submit: { message:
      `Delivery is quoted for ZIP ${selection.zip}. Contact Mason before paying if your delivery ZIP differs. ` +
      (selection.taxExempt ? 'Your card will be authorized only. Tax exemption must be verified before the charge is captured.' : 'Mason will contact you to confirm delivery arrangements.')
    } },
    success_url: `${origin}/stripe-result.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/stripe-test.html?checkout=cancelled`,
    expires_at: Math.floor(Date.now() / 1000) + 3600
  };
}

export function paymentState(session) {
  const intent = session.payment_intent;
  if (!intent || typeof intent === 'string') return 'pending';
  if (intent.status === 'succeeded' && session.payment_status === 'paid') return 'paid';
  if (intent.status === 'requires_capture') return 'authorized';
  if (intent.status === 'canceled' || session.status === 'expired') return 'cancelled';
  return 'pending';
}

export function isOurSession(session) {
  return session.metadata?.application === '254-container-checkout' &&
    Number(session.metadata.quoted_total_cents) === session.amount_total;
}
