// ============================================================
// 254 SHIPPING CONTAINERS — HELCIM CHECKOUT BACKEND
// ------------------------------------------------------------
// This is the ONLY server-side piece needed. It takes a dollar
// amount from your calculator, asks Helcim to create a secure
// checkout session for that exact amount, and hands back a
// "checkoutToken" that your webpage uses to open the payment
// modal. Your Helcim API token lives here (server-side) and is
// NEVER exposed to the browser.

export default async function handler(req, res) {
  // Allow your website to call this endpoint.
  // For tighter security once everything is working, replace '*'
  // with your actual site URL, e.g. 'https://www.254shippingcontainers.com'
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, description } = req.body || {};

    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const helcimResponse = await fetch('https://api.helcim.com/v2/helcim-pay/initialize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-token': process.env.HELCIM_API_TOKEN
      },
      body: JSON.stringify({
        paymentType: 'purchase',
        amount: numericAmount,
        currency: 'USD',
        confirmationScreen: true
      })
    });

    const data = await helcimResponse.json();

    if (!helcimResponse.ok) {
      return res.status(helcimResponse.status).json({
        error: 'Helcim checkout initialization failed',
        details: data
      });
    }

    return res.status(200).json({ checkoutToken: data.checkoutToken });
  } catch (err) {
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
}
