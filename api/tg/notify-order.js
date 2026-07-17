import { sb } from '../_lib/supabase.js';
import crypto from 'crypto';

// Постоянное по времени сравнение секретов (без утечки длины/префикса)
function safeEq(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPER_ADMINS = (process.env.TELEGRAM_ADMIN_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const WEBHOOK_SECRET = process.env.SUPABASE_WEBHOOK_SECRET;
const WA_BOT_SECRET = process.env.WA_BOT_SECRET;
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

// Лид из WhatsApp-бота (заказ / запрос менеджера)
function formatLead(b) {
  const phone = String(b.phone || '').replace(/[^\d]/g, '');
  const lines = [];
  if (b.kind === 'order') {
    lines.push('🛒 <b>Новый заказ из WhatsApp-бота</b>');
    lines.push('');
    if (b.name) lines.push(`👤 <b>${escHtml(b.name)}</b>`);
    if (b.product) lines.push(`📦 ${escHtml(b.product)}${b.size ? ' · размер ' + escHtml(b.size) : ''}`);
    if (b.total) lines.push(`💰 <b>${escHtml(b.total)}</b>`);
    if (b.city) lines.push(`🚚 ${escHtml(b.city)}`);
  } else {
    lines.push('🙋 <b>Клиент просит менеджера (WhatsApp)</b>');
    lines.push('');
    if (b.name) lines.push(`👤 ${escHtml(b.name)}`);
    if (b.text) lines.push(`💬 «${escHtml(String(b.text).slice(0, 300))}»`);
  }
  if (phone) lines.push(`📞 +${escHtml(phone)}`);
  lines.push('');
  lines.push('⚡️ Бот на паузе в этом чате — ответь клиенту сам.');
  return { text: lines.join('\n'), phone };
}

// Логирование сообщения WhatsApp в CRM (таблица wa_messages)
async function handleWaMsg(req, res) {
  if (!sb) return res.status(200).json({ skipped: true, reason: 'no supabase' });
  const b = req.body || {};
  const row = {
    jid: String(b.jid || '').slice(0, 120),
    phone: String(b.phone || '').replace(/[^\d]/g, '').slice(0, 20) || null,
    name: b.name ? String(b.name).slice(0, 120) : null,
    sender: ['customer', 'bot', 'manager'].includes(b.sender) ? b.sender : 'customer',
    text: b.text ? String(b.text).slice(0, 4000) : null,
  };
  if (!row.jid) return res.status(400).json({ error: 'jid required' });
  const { error } = await sb.from('wa_messages').insert(row);
  if (error) {
    console.error('wa_messages insert failed:', error.message);
    return res.status(200).json({ ok: false, reason: 'insert_failed' });
  }
  return res.status(200).json({ ok: true });
}

async function handleWaLead(req, res) {
  const b = req.body || {};
  const { text, phone } = formatLead(b);
  const kb = phone ? [[{ text: '💬 Написать клиенту', url: `https://wa.me/${phone}` }]] : undefined;
  const adminIds = await getAllAdminChatIds();
  if (!adminIds.length) return res.status(200).json({ skipped: true, reason: 'no admins' });
  let sent = 0;
  for (const chatId of adminIds) {
    const r = await tg('sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(kb ? { reply_markup: { inline_keyboard: kb } } : {})
    });
    if (r?.ok) sent++;
  }
  return res.status(200).json({ sent, admins: adminIds.length });
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

  // Ветки WA-бота с авторизацией WA_BOT_SECRET
  const rawAuth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const waKind = req.body?.kind;
  if (waKind === 'order' || waKind === 'handoff' || waKind === 'wa_msg') {
    if (!safeEq(rawAuth, WA_BOT_SECRET)) return res.status(401).json({ error: 'Unauthorized' });
    if (waKind === 'wa_msg') return handleWaMsg(req, res);
    if (!BOT_TOKEN) return res.status(500).json({ error: 'Bot not configured' });
    return handleWaLead(req, res);
  }

  if (!WEBHOOK_SECRET) {
    console.error('notify-order: SUPABASE_WEBHOOK_SECRET not set — rejecting request');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const token = String(auth).replace(/^Bearer\s+/i, '').trim();
  if (!safeEq(token, WEBHOOK_SECRET)) {
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
