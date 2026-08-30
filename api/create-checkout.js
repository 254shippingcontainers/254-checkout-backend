// ============================================================
// 254 SHIPPING CONTAINERS — HELCIM CHECKOUT BACKEND
// ------------------------------------------------------------
// This is the ONLY server-side piece needed. It takes a dollar
// amount from your calculator, asks Helcim to create a secure
// checkout session for that exact amount, and hands back a
// "checkoutToken" that your webpage uses to open the payment
// modal. Your Helcim API token lives here (server-side) and is
// NEVER exposed to the browser.
//
// DEPLOY THIS ON VERCEL (free):
//   1. Create a free account at vercel.com
//   2. Create a new project, upload this "helcim-backend" folder
//      (this file must live at: api/create-checkout.js)
//   3. In the Vercel project's Settings -> Environment Variables,
//      add: HELCIM_API_TOKEN = <your real Helcim API token>
//   4. Deploy. Vercel gives you a URL like:
//        https://your-project-name.vercel.app
//   5. Your endpoint is:
//        https://your-project-name.vercel.app/api/create-checkout
//      Paste that into CONFIG.backendUrl in shipping-calculator.html
//
// ALSO REQUIRED IN HELCIM:
//   In your Helcim dashboard, when generating the API token,
//   check the box for "HelcimPay.js Checkout" use, and add your
//   live website domain (the GoDaddy site URL) plus your Vercel
//   URL to the whitelist of allowed checkout domains.
// ============================================================

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
    const { amount, description, paymentType } = req.body || {};

    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Only allow the two payment types this integration actually uses.
    // 'purchase' charges the card immediately.
    // 'preauth' holds the funds without charging — used for AG/Tax
    // Exempt orders, so the charge can be manually captured in the
    // Helcim dashboard once the exemption certificate is verified.
    const safePaymentType = (paymentType === 'preauth') ? 'preauth' : 'purchase';

    const helcimResponse = await fetch('https://api.helcim.com/v2/helcim-pay/initialize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-token': process.env.HELCIM_API_TOKEN
      },
      body: JSON.stringify({
        paymentType: safePaymentType,
        amount: numericAmount,
        currency: 'USD',
        confirmationScreen: true
        // "invoiceRequest" could be added here later if you want
        // Helcim to auto-generate an itemized invoice per order.
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
