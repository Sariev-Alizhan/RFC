import { sb } from './_lib/supabase.js';
const TOKEN = 'cleanup-subs-2026-06-08';
export default async function handler(req, res) {
  if (req.query.t !== TOKEN) return res.status(401).json({ error: 'unauthorized' });
  if (!sb) return res.status(500).json({ error: 'no sb' });
  const a = await sb.from('rfc_subscribers').delete().or('email.ilike.%test%,email.ilike.%audit%,email.ilike.%launch%');
  const b = await sb.from('rfc_waitlist').delete().or('email.ilike.%test%,email.ilike.%audit%,email.ilike.%launch%');
  return res.status(200).json({ subs_error: a.error?.message || null, wl_error: b.error?.message || null });
}
