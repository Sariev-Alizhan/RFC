import { sb, verifyAuth } from '../_lib/supabase.js';

export default async function handler(req, res) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized: ' + auth.error });

  if (!sb) return res.status(500).json({ error: 'Supabase not configured' });

  let limit = parseInt(req.query?.limit, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > 50) limit = 50;

  const { data, error } = await sb
    .from('ai_generations')
    .select('id, created_at, prompt, model, aspect, elements, status, result_url, error')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ items: data || [] });
}
