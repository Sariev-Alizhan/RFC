import { sb } from '../_lib/supabase.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPER_ADMINS = (process.env.TELEGRAM_ADMIN_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const WEBHOOK_SECRET = process.env.SUPABASE_WEBHOOK_SECRET;
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method, payload) {
  if (!BOT_TOKEN) return null;
  try {
    const r = await fetch(`${TG}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return r.json().catch(() => null);
  } catch (e) {
    console.error(`TG ${method} failed:`, e.message);
    return null;
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

function shortId(id) {
  if (!id) return '????';
  return String(id).replace(/-/g, '').slice(-6).toUpperCase();
}

function fmtPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return null;
  return '₸' + v.toLocaleString('ru-RU');
}

function parseItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const j = JSON.parse(raw); return Array.isArray(j) ? j : []; }
    catch { return []; }
  }
  return [];
}

function formatOrder(row) {
  const id = shortId(row.id);
  const lines = [];
  lines.push(`🔔 <b>Новый заказ · #${id}</b>`);
  lines.push('');
  if (row.name) lines.push(`👤 <b>${escHtml(row.name)}</b>`);
  if (row.phone) {
    const cleanPhone = String(row.phone).replace(/[^\d+]/g, '');
    lines.push(`📞 <a href="tel:${escHtml(cleanPhone)}">${escHtml(row.phone)}</a>`);
  }
  if (row.email) lines.push(`📧 ${escHtml(row.email)}`);
  lines.push('');
  const items = parseItems(row.items);
  if (items.length) {
    items.forEach((it, i) => {
      const name = it.name || it.title || it.product || 'товар';
      const size = it.size ? ` · ${escHtml(it.size)}` : '';
      const qty = it.qty || it.quantity || 1;
      const itemPrice = it.price ? fmtPrice(Number(it.price) * Number(qty || 1)) : null;
      const prefix = i === 0 ? '📦 ' : '   ';
      lines.push(`${prefix}${escHtml(name)}${size} ×${qty}${itemPrice ? ' — ' + itemPrice : ''}`);
    });
  }
  const totalStr = fmtPrice(row.total);
  if (totalStr) lines.push(`💰 <b>Итого: ${totalStr}</b>`);
  lines.push('');
  const dp = [];
  if (row.delivery) dp.push(escHtml(row.delivery));
  if (row.country)  dp.push(escHtml(row.country));
  if (row.city)     dp.push(escHtml(row.city));
  if (dp.length) lines.push(`🚚 ${dp.join(' · ')}`);
  if (row.address) lines.push(`📍 ${escHtml(row.address)}`);
  if (row.comment) lines.push(`💬 «${escHtml(row.comment)}»`);
  if (row.status && row.status !== 'Новый') {
    lines.push('');
    lines.push(`📌 Статус: <b>${escHtml(row.status)}</b>`);
  }
  return lines.join('\n');
}

async function getAllAdminChatIds() {
  const ids = new Set();
  SUPER_ADMINS.forEach(s => {
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) ids.add(n);
  });
  if (sb) {
    const { data, error } = await sb.from('tg_admins').select('telegram_user_id');
    if (error) console.error('tg_admins read failed:', error.message);
    else if (data) data.forEach(a => {
      const n = Number(a.telegram_user_id);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    });
  }
  return Array.from(ids);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'rfc-tg-notify-order', has_secret: !!WEBHOOK_SECRET });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!WEBHOOK_SECRET) {
    console.error('notify-order: SUPABASE_WEBHOOK_SECRET not set — rejecting request');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const token = String(auth).replace(/^Bearer\s+/i, '').trim();
  if (token !== WEBHOOK_SECRET) {
    console.warn('notify-order: invalid/missing auth header');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!BOT_TOKEN) return res.status(500).json({ error: 'Bot not configured' });

  const body = req.body || {};
  const eventType = body.type || body.event;
  const table = body.table;
  const record = body.record;

  if (eventType !== 'INSERT' || !record) {
    return res.status(200).json({ skipped: true, reason: 'not INSERT or no record', got: { eventType, hasRecord: !!record } });
  }
  if (table && table !== 'rfc_orders') {
    return res.status(200).json({ skipped: true, reason: 'wrong table', table });
  }

  let text;
  try { text = formatOrder(record); }
  catch (e) {
    console.error('formatOrder failed:', e.message);
    text = `🔔 <b>Новый заказ</b>\n\n<i>(не удалось отформатировать, заказ в Supabase сохранён)</i>\n\n<code>${escHtml(JSON.stringify(record).slice(0, 500))}</code>`;
  }

  // Phase 6C: «👁 Управлять» открывает детальный экран В TG (бот → routeCallback → showOrderDetail).
  // ord:<id> — формат callback совпадает с тем что использует webhook.js.
  const kb = [
    [
      { text: '👁 Управлять',  callback_data: `ord:${record.id}` },
      { text: '🔗 В админке',   url: 'https://redflag.kz/#admin' }
    ]
  ];

  const adminIds = await getAllAdminChatIds();
  if (!adminIds.length) {
    return res.status(200).json({ skipped: true, reason: 'no admins', record_id: record.id });
  }

  const results = [];
  for (const chatId of adminIds) {
    const r = await tg('sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: kb }
    });
    results.push({ chat_id: chatId, ok: !!r?.ok, error: r?.ok ? null : (r?.description || 'unknown') });
  }

  return res.status(200).json({ sent_to: results.length, record_id: record.id, results });
}
