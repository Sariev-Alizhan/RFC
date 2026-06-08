import { sb } from './_lib/supabase.js';
const TOKEN = 'cleanup-tests-2026-06-08';
export default async function handler(req, res) {
  if (req.query.t !== TOKEN) return res.status(401).json({ error: 'unauthorized' });
  if (!sb) return res.status(500).json({ error: 'no sb' });
  const sel = await sb.from('rfc_orders').select('id,name').or('name.ilike.%TEST%,name.ilike.%AUDIT%,name.ilike.%Айгерим Канатова%');
  if (sel.error) return res.status(500).json({ error: sel.error.message });
  const ids = (sel.data || []).map(r => r.id);
  if (!ids.length) return res.status(200).json({ removed: 0, ids: [] });
  const del = await sb.from('rfc_orders').delete().in('id', ids);
  return res.status(200).json({ removed: ids.length, ids, error: del.error?.message || null });
}
