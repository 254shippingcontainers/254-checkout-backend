# 254 Shipping Containers — Secure Calculator Backend

This Vercel project calculates route-based delivery pricing on the server and
creates HelcimPay.js checkout sessions. The browser sends product selections,
not prices, so a customer cannot alter the checkout amount with browser tools.

## Confirmed business rules

- 20-foot cargo worthy: $1,900
- 20-foot one trip: $2,850
- 40-foot high cube cargo worthy: $2,550
- 40-foot high cube one trip: $4,150
- Light gray or dark gray one-trip color: +$300 per container
- First 30 route miles: free
- Beyond 30 route miles: $4.50 per one-way mile, per container
- Maximum automatic checkout distance: 400 route miles
- Sales tax: 6.75% unless the customer claims exemption
- Card processing fee: 3.5%
- Standard order: Helcim purchase
- Tax-exempt order: Helcim preauthorization pending certificate review

Route mileage is rounded up to the next whole mile before delivery pricing is
calculated.

## Deploy to Vercel

1. Merge this package into the existing Vercel project. **Keep the existing
   `public/images` folder and all 44 container photos.** A Vercel deployment
   made without those image files would break the calculator galleries.
2. Confirm that the existing image paths still begin with `/images/`, including
   `/images/logo.jpg`.
3. In **Vercel → Project → Settings → Environment Variables**, add:
   - `HELCIM_API_TOKEN` — secret Helcim API token.
   - `GOOGLE_MAPS_API_KEY` — secret key with the Google Routes API enabled.
   - `ALLOWED_ORIGINS` — optional comma-separated list of any additional live
     or preview website origins. The two production 254 domains are already
     allowed in code.
4. Restrict the Google key to the Routes API. Because the call is server-side,
   do not place the key in calculator HTML.
5. Redeploy after adding or changing environment variables.

The endpoints are:

- `POST /api/quote` — returns the server-calculated quote.
- `POST /api/create-checkout-v2` — recalculates the quote and initializes Helcim.

The existing `/api/create-checkout` file is intentionally left untouched during
rollout so the currently published calculator continues working. After the new
calculator is live and tested, the legacy endpoint can be retired.

Both endpoints accept:

```json
{
  "size": "20",
  "grade": "cw",
  "color": "beige",
  "qty": 1,
  "zip": "76457",
  "taxExempt": false
}
```

## Test before accepting payments

Run `npm test`, deploy using Helcim test credentials, and test:

- Every size, grade, and available color.
- ZIP codes inside and outside the free-delivery radius.
- Two or more containers to confirm delivery is charged per unit.
- A route over 400 miles.
- A regular purchase and a tax-exempt preauthorization.
- Cancelled and successful Helcim checkout events.
- The thank-you redirect.

## Important launch checks

- Confirm the fixed 6.75% sales-tax treatment with a Texas tax professional.
- Confirm the 3.5% card fee and debit-card handling with Helcim before launch.
- Helcim remains the payment system of record. A separate database/webhook can
  be added later for a complete internal order dashboard and automated alerts.
