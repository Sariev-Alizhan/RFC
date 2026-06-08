import { sb } from './_lib/supabase.js';

// Подписка на newsletter — сохраняет email в rfc_subscribers
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!sb) return res.status(500).json({ error: 'supabase not configured' });

  let body;
  try { body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}'); }
  catch { return res.status(400).json({ error: 'invalid json' }); }

  const email = String(body.email || '').trim().toLowerCase();
  const source = String(body.source || 'footer').slice(0, 40);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'invalid email' });
  }

  const r = await sb.from('rfc_subscribers').upsert(
    { email, source, created_at: new Date().toISOString() },
    { onConflict: 'email', ignoreDuplicates: false }
  ).select().single();

  if (r.error) {
    console.error('[subscribe]', r.error.message);
    return res.status(500).json({ error: 'db: ' + r.error.message });
  }

  return res.status(200).json({ ok: true });
}
