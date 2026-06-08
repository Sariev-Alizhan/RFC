import { sb } from '../_lib/supabase.js';

// Создаёт заказ в rfc_orders (service-role, обходит RLS)
// + сразу пингует Telegram-бота (server-to-server, без webhook-зависимости)

const SITE = 'https://redflag.kz';

async function notifyTelegram(record) {
  try {
    const secret = process.env.SUPABASE_WEBHOOK_SECRET;
    const headers = { 'Content-Type': 'application/json' };
    if (secret) headers.Authorization = 'Bearer ' + secret;
    await fetch(SITE + '/api/tg/notify-order', {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'INSERT', table: 'rfc_orders', record })
    });
  } catch (e) {
    console.error('[orders/create] TG notify failed:', e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!sb) return res.status(500).json({ error: 'supabase not configured' });

  let body;
  try { body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}'); }
  catch { return res.status(400).json({ error: 'invalid json' }); }

  const { name, phone, email, country, city, address, comment, delivery, items, total, status, paymentMethod } = body;

  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items required' });
  const totalNum = Number(total);
  if (!totalNum || totalNum <= 0) return res.status(400).json({ error: 'total required' });

  const id = 'RFC-' + String(Date.now()).slice(-6);

  const insert = await sb.from('rfc_orders').insert({
    id,
    name: String(name).slice(0, 200),
    phone: String(phone).slice(0, 50),
    email: email ? String(email).slice(0, 200) : null,
    country: country || 'Казахстан',
    city: city ? String(city).slice(0, 100) : null,
    address: address ? String(address).slice(0, 500) : null,
    comment: comment ? String(comment).slice(0, 1000) : null,
    delivery: delivery ? String(delivery).slice(0, 200) : null,
    items,
    total: totalNum,
    status: status || (paymentMethod === 'kaspi' ? 'Ожидает Kaspi QR' : 'Новый'),
  }).select().single();

  if (insert.error) {
    console.error('[orders/create] insert failed:', insert.error.message);
    return res.status(500).json({ error: 'db: ' + insert.error.message });
  }

  // Параллельно пингуем Telegram-бота (не блокируем ответ клиенту)
  notifyTelegram(insert.data);

  return res.status(200).json({ ok: true, order: insert.data });
}
