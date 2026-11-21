import { calculateQuote, getRouteMiles, normalizeSelection, publicQuote, sendQuoteError, setCors, BUSINESS_RULES, QuoteError } from '../lib/pricing.js';

function normalizeDestination(input = {}) {
  const destination = String(input.destination || input.zip || '').trim();
  const states = { TX: 'TX', TEXAS: 'TX', OK: 'OK', OKLAHOMA: 'OK', LA: 'LA', LOUISIANA: 'LA', NM: 'NM', 'NEW MEXICO': 'NM' };
  const state = states[String(input.state || 'TX').trim().toUpperCase()];
  if (!state) {
    throw new QuoteError('INVALID_STATE', 'Choose Texas, Oklahoma, Louisiana, or New Mexico.');
  }
  if (/^\d{5}$/.test(destination)) return destination;
  if (/^[A-Za-z][A-Za-z .'-]{1,60}$/.test(destination)) {
    return `${destination}, ${state}`;
  }
  if (/^[A-Za-z][A-Za-z .'-]{1,60},\s*(?:TX|Texas|OK|Oklahoma|LA|Louisiana|NM|New Mexico)$/i.test(destination)) {
    return destination;
  }
  if (destination.length < 8 || destination.length > 180 || !/[A-Za-z]/.test(destination) || !/\d/.test(destination)) {
    throw new QuoteError('INVALID_DESTINATION', 'Enter a city, 5-digit ZIP code, or full delivery address.');
  }
  if (/[<>\r\n]/.test(destination)) {
    throw new QuoteError('INVALID_DESTINATION', 'Enter a valid delivery address.');
  }
  return destination;
}

async function quoteForOrigin(selection, destination, origin, fetchImpl) {
  const originAddress = origin === 'depot' ? BUSINESS_RULES.depot.address : BUSINESS_RULES.originAddress;
  const miles = await getRouteMiles(destination, fetchImpl, originAddress);
  return {
    taxable: calculateQuote({ ...selection, taxExempt: false }, miles, origin),
    taxExempt: calculateQuote({ ...selection, taxExempt: true }, miles, origin)
  };
}

export function makeHandler(fetchImpl = fetch) {
  return async (req, res) => {
    const allowed = setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(allowed ? 204 : 403).end();
    if (!allowed) return res.status(403).json({ error: 'Origin not allowed.' });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

    try {
      const destination = normalizeDestination(req.body || {});
      const zipMatch = destination.match(/\b\d{5}\b/);
      const validated = normalizeSelection({
        ...(req.body || {}),
        zip: zipMatch?.[0] || '00000',
        taxExempt: false
      });
      const selection = { ...validated, zip: zipMatch?.[0] || destination };
      const candidates = [];
      const routeErrors = [];

      try {
        candidates.push(await quoteForOrigin(selection, destination, 'hico', fetchImpl));
      } catch (error) {
        routeErrors.push(error);
      }

      if (BUSINESS_RULES.depot.sizes.includes(selection.size)) {
        try {
          candidates.push(await quoteForOrigin(selection, destination, 'depot', fetchImpl));
        } catch (error) {
          routeErrors.push(error);
        }
      }

      if (!candidates.length) {
        const serviceError = routeErrors.find(error => error.code !== 'OUT_OF_RANGE');
        if (serviceError) throw serviceError;
        throw new QuoteError('OUT_OF_RANGE', 'That destination is beyond the online quote range. Please call for a custom quote.', 422);
      }

      const best = candidates.reduce((current, candidate) =>
        candidate.taxable.totalCents < current.taxable.totalCents ? candidate : current
      );

      return res.status(200).json({
        destination,
        taxable: publicQuote(best.taxable),
        taxExempt: publicQuote(best.taxExempt)
      });
    } catch (error) {
      return sendQuoteError(res, error);
    }
  };
}

export default makeHandler();
