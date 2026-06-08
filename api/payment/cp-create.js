import { sb } from '../_lib/supabase.js';

// Создаёт заказ в БД со статусом 'pending' и возвращает данные для CP-виджета.
// Вызывается фронтом перед открытием виджета.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!sb) return res.status(500).json({ error: 'supabase not configured' });

  let body;
  try { body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}'); }
  catch { return res.status(400).json({ error: 'invalid json' }); }

  const { name, phone, email, country, city, address, comment, delivery, items, total } = body;

  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items required' });
  const totalNum = Number(total);
  if (!totalNum || totalNum <= 0) return res.status(400).json({ error: 'total required' });

  const id = 'RFC-' + String(Date.now()).slice(-6);

  const insert = await sb.from('rfc_orders').insert({
    id, name, phone, email: email || null,
    country: country || 'Казахстан', city: city || null, address: address || null,
    comment: comment || null, delivery: delivery || null,
    items, total: totalNum,
    status: 'Ожидает оплаты',
    payment_status: 'pending',
    payment_provider: 'cloudpayments',
  }).select().single();

  if (insert.error) return res.status(500).json({ error: 'db: ' + insert.error.message });

  return res.status(200).json({
    orderId: id,
    publicId: process.env.CLOUDPAYMENTS_PUBLIC_ID || '',
    amount: totalNum,
    currency: 'KZT',
    description: `Заказ ${id} · Red Flag Community`,
    accountId: phone,
    email: email || '',
  });
}
