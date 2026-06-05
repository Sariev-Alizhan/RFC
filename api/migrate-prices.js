import { sb } from './_lib/supabase.js';

// One-shot migration: cap → 15000, tee → 23000. Deleted right after run.
const TOKEN = 'mig-price-9d8e2f56-2026-06-05';

const PRICE_MAP = {
  cap: 15000,
  tee: 23000,
};

export default async function handler(req, res) {
  if (req.query.t !== TOKEN) return res.status(401).json({ error: 'unauthorized' });
  if (!sb) return res.status(500).json({ error: 'supabase not configured' });

  const result = [];
  for (const [type, price] of Object.entries(PRICE_MAP)) {
    const r = await sb.from('rfc_products')
      .update({ price, updated_at: new Date().toISOString() })
      .eq('type', type)
      .select('slug,type,price');
    result.push({ type, price, error: r.error?.message || null, updated: r.data || [] });
  }
  return res.status(200).json({ updates: result });
}
