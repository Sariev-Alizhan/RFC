import { sb } from './_lib/supabase.js';

export default async function handler(req, res) {
  const secret = process.env.SUPABASE_WEBHOOK_SECRET;
  if (!secret || req.query.s !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!sb) return res.status(500).json({ error: 'supabase not configured' });

  const before = await sb.from('rfc_products').select('slug,type,name').eq('type', 'socks');
  if (before.error) return res.status(500).json({ stage: 'select', error: before.error.message });

  const updates = [];
  for (const row of before.data) {
    const newSlug = row.slug.replace(/-socks$/, '-boxers');
    const r = await sb.from('rfc_products').update({
      type: 'boxers',
      slug: newSlug,
      name: 'Трусы "Red Flag Community"',
      description: 'Боксеры с эластичной резинкой и фирменной надписью Red Flag Community. Хлопок, мягкая посадка, базовый стиль на каждый день.'
    }).eq('slug', row.slug).select('slug,type,name');
    updates.push({ from: row.slug, result: r.error ? { error: r.error.message } : r.data });
  }

  return res.status(200).json({ before: before.data, updates });
}
