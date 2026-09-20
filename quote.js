import { buildQuote, publicQuote, sendQuoteError, setCors } from '../lib/pricing.js';

export default async function handler(req, res) {
  const originAllowed = setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(originAllowed ? 204 : 403).end();
  if (!originAllowed) return res.status(403).json({ error: 'Origin not allowed.', code: 'ORIGIN_NOT_ALLOWED' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  try {
    const quote = await buildQuote(req.body || {});
    return res.status(200).json({ quote: publicQuote(quote) });
  } catch (error) {
    return sendQuoteError(res, error);
  }
}
