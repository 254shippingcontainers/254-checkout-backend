export const BUSINESS_RULES = Object.freeze({
  originZip: '76457',
  originAddress: '20979 Hwy 281, Hico, TX 76457',
  freeRadiusMiles: 30,
  ratePerMileCents: 450,
  maxAutoQuoteMiles: 400,
  salesTaxRate: 0.0675,
  cardFeeRate: 0.035,
  maxQuantity: 10,
  pricesCents: Object.freeze({
    '20': Object.freeze({ cw: 210000, '1trip': 310000 }),
    '20os': Object.freeze({ '1trip': 520000 }),
    '40hc': Object.freeze({ cw: 255000, '1trip': 415000 }),
    '40hcdd': Object.freeze({ '1trip': 480000 })
  }),
  premiumColorUpchargeCents: 20000,
  // Dallas depot: base price = Hico price minus $450, $4.50/mile from the depot, no free miles
  depot: Object.freeze({
    address: '3839 E Overton Rd, Dallas, TX 75216',
    discountCents: 45000,
    sizes: Object.freeze(['20', '20os', '40hc', '40hcdd'])
  })
});

const VALID_COLORS = new Set(['beige', 'lightgray', 'darkgray']);

export class QuoteError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'QuoteError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeSelection(input = {}) {
  const size = String(input.size || '').toLowerCase();
  const grade = String(input.grade || '').toLowerCase();
  let color = String(input.color || 'beige').toLowerCase();
  const zip = String(input.zip || '').trim();
  const qty = Number(input.qty);
  const taxExempt = input.taxExempt === true;
  if (!BUSINESS_RULES.pricesCents[size]?.[grade]) {
    throw new QuoteError('INVALID_PRODUCT', 'Please select a valid container size and grade.');
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > BUSINESS_RULES.maxQuantity) {
    throw new QuoteError('INVALID_QUANTITY', `Quantity must be between 1 and ${BUSINESS_RULES.maxQuantity}.`);
  }
  if (!/^\d{5}$/.test(zip)) {
    throw new QuoteError('INVALID_ZIP', 'Please enter a valid 5-digit ZIP code.');
  }
  if (grade !== '1trip') color = 'beige';
  if (!VALID_COLORS.has(color)) {
    throw new QuoteError('INVALID_COLOR', 'Please select a valid container color.');
  }
  if (size === '40hc' && color === 'lightgray') {
    throw new QuoteError('INVALID_COLOR', 'Light gray is not currently offered for 40-foot high-cube containers.');
  }
  if (size === '20os' && color !== 'beige') {
    throw new QuoteError('INVALID_COLOR', 'The 20-foot open-side container is currently offered in beige only.');
  }
  if (size === '40hcdd' && color !== 'beige') {
    throw new QuoteError('INVALID_COLOR', 'The 40-foot high-cube double-door container is currently offered in beige only.');
  }
  return { size, grade, color, qty, zip, taxExempt };
}

export async function getRouteMiles(zip, fetchImpl = fetch, originAddress = BUSINESS_RULES.originAddress) {
  if (originAddress === BUSINESS_RULES.originAddress && zip === BUSINESS_RULES.originZip) return 0;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new QuoteError('ROUTING_NOT_CONFIGURED', 'Delivery routing is temporarily unavailable.', 503);
  }
  const response = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration'
    },
    body: JSON.stringify({
      origin: { address: originAddress },
      destination: { address: `${zip}, USA` },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      computeAlternativeRoutes: false,
      routeModifiers: { avoidTolls: false, avoidHighways: false, avoidFerries: true },
      languageCode: 'en-US',
      units: 'IMPERIAL'
    })
  });
  const data = await response.json().catch(() => ({}));
  const distanceMeters = data?.routes?.[0]?.distanceMeters;
  if (!response.ok || !Number.isFinite(distanceMeters)) {
    throw new QuoteError('ROUTE_NOT_FOUND', 'We could not calculate a delivery route to that ZIP code.', 422);
  }
  return distanceMeters / 1609.344;
}

export function calculateQuote(selection, routeMiles, origin = 'hico') {
  if (!Number.isFinite(routeMiles) || routeMiles < 0) {
    throw new QuoteError('INVALID_DISTANCE', 'A valid route distance is required.');
  }
  const billedRouteMiles = Math.ceil(routeMiles);
  if (billedRouteMiles > BUSINESS_RULES.maxAutoQuoteMiles) {
    throw new QuoteError(
      'OUT_OF_RANGE',
      `That ZIP is beyond our ${BUSINESS_RULES.maxAutoQuoteMiles}-mile online checkout range. Please call for a custom quote.`,
      422
    );
  }
  let unitPriceCents = BUSINESS_RULES.pricesCents[selection.size][selection.grade];
  if (origin === 'depot') unitPriceCents -= BUSINESS_RULES.depot.discountCents;
  if (selection.grade === '1trip' && ['lightgray', 'darkgray'].includes(selection.color)) {
    unitPriceCents += BUSINESS_RULES.premiumColorUpchargeCents;
  }
  const freeMiles = origin === 'depot' ? 0 : BUSINESS_RULES.freeRadiusMiles;
  const billableMiles = Math.max(0, billedRouteMiles - freeMiles);
  const deliveryPerUnitCents = billableMiles * BUSINESS_RULES.ratePerMileCents;
  const containersCents = unitPriceCents * selection.qty;
  const deliveryCents = deliveryPerUnitCents * selection.qty;
  const subtotalCents = containersCents + deliveryCents;
  const taxCents = selection.taxExempt ? 0 : Math.round(subtotalCents * BUSINESS_RULES.salesTaxRate);
  const cardFeeCents = Math.round((subtotalCents + taxCents) * BUSINESS_RULES.cardFeeRate);
  const totalCents = subtotalCents + taxCents + cardFeeCents;
  return {
    selection,
    origin,
    routeMiles: billedRouteMiles,
    billableMiles,
    unitPriceCents,
    containersCents,
    deliveryPerUnitCents,
    deliveryCents,
    subtotalCents,
    taxCents,
    cardFeeCents,
    totalCents,
    paymentType: selection.taxExempt ? 'preauth' : 'purchase'
  };
}

export async function buildQuote(input, fetchImpl = fetch) {
  const selection = normalizeSelection(input);
  const hicoMiles = await getRouteMiles(selection.zip, fetchImpl);
  let hicoQuote = null;
  let hicoError = null;
  try {
    hicoQuote = calculateQuote(selection, hicoMiles, 'hico');
  } catch (error) {
    hicoError = error;
  }

  let depotQuote = null;
  if (BUSINESS_RULES.depot.sizes.includes(selection.size)) {
    try {
      const depotMiles = await getRouteMiles(selection.zip, fetchImpl, BUSINESS_RULES.depot.address);
      depotQuote = calculateQuote(selection, depotMiles, 'depot');
    } catch (error) {
      depotQuote = null; // if the depot lookup fails, fall back to the Hico price
    }
  }

  if (hicoQuote && depotQuote) {
    return depotQuote.totalCents < hicoQuote.totalCents ? depotQuote : hicoQuote;
  }
  if (depotQuote) return depotQuote;
  if (hicoQuote) return hicoQuote;
  throw hicoError;
}

export function publicQuote(quote) {
  const dollars = cents => Number((cents / 100).toFixed(2));
  return {
    selection: quote.selection,
    routeMiles: quote.routeMiles,
    billableMiles: quote.billableMiles,
    unitPrice: dollars(quote.unitPriceCents),
    containers: dollars(quote.containersCents),
    deliveryPerUnit: dollars(quote.deliveryPerUnitCents),
    delivery: dollars(quote.deliveryCents),
    subtotal: dollars(quote.subtotalCents),
    tax: dollars(quote.taxCents),
    cardFee: dollars(quote.cardFeeCents),
    total: dollars(quote.totalCents),
    paymentType: quote.paymentType
  };
}

export function setCors(req, res) {
  const defaults = [
    'https://254shippingcontainers.com',
    'https://www.254shippingcontainers.com'
  ];
  const configured = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const previewOrigin = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL
    ? [`https://${process.env.VERCEL_URL}`]
    : [];
  const allowed = new Set([...defaults, ...configured, ...previewOrigin]);
  const origin = req.headers?.origin;
  if (origin && allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  return !origin || allowed.has(origin);
}

export function sendQuoteError(res, error) {
  if (error instanceof QuoteError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error(error);
  return res.status(500).json({ error: 'We could not calculate this order. Please try again.', code: 'SERVER_ERROR' });
}
