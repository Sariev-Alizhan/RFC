import { sb } from './_lib/supabase.js';

// Wait-list для Coming Soon товаров — клиент оставляет email
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!sb) return res.status(500).json({ error: 'supabase not configured' });

  let body;
  try { body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}'); }
  catch { return res.status(400).json({ error: 'invalid json' }); }

  const email = String(body.email || '').trim().toLowerCase();
  const productId = String(body.productId || '').slice(0, 60);
  const productName = String(body.productName || '').slice(0, 200);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'invalid email' });
  }
  if (!productId) return res.status(400).json({ error: 'productId required' });

  const r = await sb.from('rfc_waitlist').upsert(
    { email, product_id: productId, product_name: productName, created_at: new Date().toISOString() },
    { onConflict: 'email,product_id', ignoreDuplicates: false }
  );

  if (r.error) {
    console.error('[waitlist]', r.error.message);
    return res.status(500).json({ error: 'db: ' + r.error.message });
  }

  return res.status(200).json({ ok: true });
}
