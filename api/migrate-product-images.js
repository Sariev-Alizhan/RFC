import { sb } from './_lib/supabase.js';

// One-shot migration: populate rfc_products.images array per product.
// This whole file is deleted right after one successful run.
const TOKEN = 'mig-imgs-7c4ab21e-2026-06-05';

const B = 'https://redflag.kz/img/products/';

// Per-product image lists. Empty list ⇒ keep current default fallback (SVG).
// Each list ordered: hero first, then alt views.
const MAP = {
  // ---------------- CAPS ----------------
  // RED collection cap = black washed (red flag pop on dark base)
  'red-cap':    [B+'cap-black-front.jpg', B+'cap-black-side.jpg', B+'cap-black-model.jpg'],
  // WHITE collection cap = navy / denim (clean look that pairs with white tee)
  'white-cap':  [B+'cap-navy-front.jpg', B+'cap-navy-side.jpg', B+'cap-denim-front.jpg', B+'cap-denim-side.jpg'],
  // ДРУГИЕ cap = camo (statement piece)
  'other-cap':  [B+'cap-camo-front.jpg', B+'cap-camo-side.jpg'],

  // ---------------- TEES ----------------
  // RED collection tee = big flag print (loud)
  'red-tee':    [B+'tee-pair-bigflag.jpg', B+'tee-real-front.jpg', B+'tee-real-back.jpg'],
  // WHITE collection tee = small flag (minimal)
  'white-tee':  [B+'tee-pair-smallflag.jpg', B+'tee-pair-bigflag.jpg'],
  // ДРУГИЕ tee = real-person shots
  'other-tee':  [B+'tee-real-front.jpg', B+'tee-real-back.jpg'],

  // ---------------- BOXERS ----------------
  // RED collection boxers = red colorway
  'red-boxers':   [B+'boxers-red.jpg', B+'boxers-black.jpg'],
  // WHITE collection boxers = black colorway (clean contrast)
  'white-boxers': [B+'boxers-black.jpg', B+'boxers-red.jpg'],
  // ДРУГИЕ boxers = both
  'other-boxers': [B+'boxers-black.jpg', B+'boxers-red.jpg'],
};

export default async function handler(req, res) {
  if (req.query.t !== TOKEN) return res.status(401).json({ error: 'unauthorized' });
  if (!sb) return res.status(500).json({ error: 'supabase not configured' });

  const result = [];
  for (const [slug, images] of Object.entries(MAP)) {
    const r = await sb.from('rfc_products')
      .update({ images, updated_at: new Date().toISOString() })
      .eq('slug', slug)
      .select('slug,images');
    result.push({ slug, images_set: images.length, error: r.error?.message || null, updated: r.data?.length || 0 });
  }
  return res.status(200).json({ updates: result });
}
