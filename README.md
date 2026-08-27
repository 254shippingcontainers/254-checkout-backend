# 254 Shipping Containers — Checkout Backend

This tiny backend does one job: it takes a dollar amount from your
website's delivery calculator and asks Helcim to create a secure
checkout session for that exact amount. Your Helcim API token stays
here, server-side — it never touches the browser.

## Deploy (free, ~5 minutes)

1. Go to https://vercel.com and sign up / log in (free plan is fine).
2. Click **Add New -> Project**.
3. Upload/import this whole `helcim-backend` folder (or push it to a
   GitHub repo first and import that repo — either works).
4. Before deploying, go to **Settings -> Environment Variables** and add:
   - Name: `HELCIM_API_TOKEN`
   - Value: *(your real Helcim API token — from Helcim dashboard ->
     Integrations -> API Access Configuration)*
5. Click **Deploy**.
6. Once deployed, Vercel gives you a URL like:
   `https://254-checkout-backend.vercel.app`
7. Your live endpoint is:
   `https://254-checkout-backend.vercel.app/api/create-checkout`

## Helcim setup (one-time)

In your Helcim dashboard, when you generate (or edit) your API token:
- Check the box that says it will be used for **HelcimPay.js Checkout**.
- Add both of these to the whitelisted checkout domains:
  - Your live GoDaddy website domain (e.g. `www.254shippingcontainers.com`)
  - Your Vercel URL (e.g. `254-checkout-backend.vercel.app`)

Without this whitelisting step, the payment modal will silently fail
to render in production.

## Connect it to the calculator

Open `shipping-calculator.html` and find this line near the top of
the `CONFIG` block in the `<script>` section:

```js
backendUrl: "https://YOUR-BACKEND-URL.vercel.app/api/create-checkout",
```

Replace it with your real Vercel URL from step 6 above.

## Testing

Helcim provides test card numbers for their sandbox/test API tokens
so you can confirm the whole flow before going live — see:
https://devdocs.helcim.com/docs/test-credit-card-numbers
