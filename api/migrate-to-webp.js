import { sb } from './_lib/supabase.js';

// One-shot: rewrite rfc_products.images URLs .jpg → .webp.
// Deleted right after successful run.
const TOKEN = 'mig-webp-5e8b2d11-2026-06-06';

export default async function handler(req, res) {
  if (req.query.t !== TOKEN) return res.status(401).json({ error: 'unauthorized' });
  if (!sb) return res.status(500).json({ error: 'supabase not configured' });

  const sel = await sb.from('rfc_products').select('slug,images');
  if (sel.error) return res.status(500).json({ stage: 'select', error: sel.error.message });

  const updates = [];
  for (const row of sel.data) {
    const oldImgs = Array.isArray(row.images) ? row.images : [];
    if (!oldImgs.length) { updates.push({ slug: row.slug, skipped: 'no images' }); continue; }
    const newImgs = oldImgs.map(u => typeof u === 'string' ? u.replace(/\.jpg(\?|$)/gi, '.webp$1') : u);
    const changed = JSON.stringify(oldImgs) !== JSON.stringify(newImgs);
    if (!changed) { updates.push({ slug: row.slug, skipped: 'no change' }); continue; }
    const r = await sb.from('rfc_products')
      .update({ images: newImgs, updated_at: new Date().toISOString() })
      .eq('slug', row.slug).select('slug,images');
    updates.push({ slug: row.slug, error: r.error?.message || null, count: newImgs.length });
  }
  return res.status(200).json({ updates });
}
