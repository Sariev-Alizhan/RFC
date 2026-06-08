import { sb } from '../_lib/supabase.js';
// TEMPORARY cleanup — будет восстановлен после удаления тестовых заказов
const TOKEN = 'cleanup-all-2026-06-08';
export default async function handler(req, res) {
  if (req.query.t !== TOKEN) return res.status(401).json({ error: 'unauthorized' });
  if (!sb) return res.status(500).json({ error: 'no sb' });
  // Удалить ВСЕ заказы (на этапе launch — они все тестовые)
  const o = await sb.from('rfc_orders').delete().neq('id', '__NEVER__');
  // Удалить тестовые subscriptions
  const s = await sb.from('rfc_subscribers').delete().or('email.ilike.%test%,email.ilike.%audit%,email.ilike.%launch%');
  // Удалить тестовые waitlist
  const w = await sb.from('rfc_waitlist').delete().or('email.ilike.%test%,email.ilike.%audit%,email.ilike.%launch%');
  return res.status(200).json({
    orders_error: o.error?.message || null,
    subs_error: s.error?.message || null,
    waitlist_error: w.error?.message || null,
    done: true
  });
}
