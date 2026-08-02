import { sb, verifyAuth } from '../_lib/supabase.js';
import crypto from 'crypto';

// Гарантируем существование bucket (service role, без SQL). Идемпотентно.
const _bucketReady = {};
async function ensureBucket(id, isPublic) {
  if (!sb) return;
  if (_bucketReady[id]) return;
  try {
    const { error } = await sb.storage.createBucket(id, { public: isPublic });
    if (error && !/exist/i.test(error.message || '')) console.error(`bucket ${id}:`, error.message);
  } catch (e) { console.error(`bucket ${id}:`, e.message); }
  _bucketReady[id] = true;
}
const OUTBOX_BUCKET = 'wa-outbox';
const MEDIA_BUCKET = 'wa-media';

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

// Валидное время сообщения (ISO) или undefined → БД поставит now()
function validTs(ts) {
  if (ts == null) return undefined;
  let d;
  if (typeof ts === 'number') d = new Date(ts < 1e12 ? ts * 1000 : ts); // сек или мс
  else d = new Date(ts);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toRow(m) {
  const jid = String(m.jid || '').slice(0, 120);
  if (!jid) return null;
  const row = {
    jid,
    phone: String(m.phone || '').replace(/[^\d]/g, '').slice(0, 20) || null,
    name: m.name ? String(m.name).slice(0, 120) : null,
    sender: ['customer', 'bot', 'manager'].includes(m.sender) ? m.sender : 'customer',
    text: m.text ? String(m.text).slice(0, 4000) : null,
  };
  const ts = validTs(m.ts);
  if (ts) row.created_at = ts;
  return row;
}

// Логирование сообщения(ий) WhatsApp в CRM (таблица wa_messages).
// Поддерживает одиночное { jid, ... } и батч { batch: [ {jid,...}, ... ] } (для истории).
async function handleWaMsg(req, res) {
  if (!sb) return res.status(200).json({ skipped: true, reason: 'no supabase' });
  const b = req.body || {};
  let rows;
  if (Array.isArray(b.batch)) {
    rows = b.batch.map(toRow).filter(Boolean).slice(0, 2000);
    if (!rows.length) return res.status(200).json({ ok: true, inserted: 0 });
  } else {
    const r = toRow(b);
    if (!r) return res.status(400).json({ error: 'jid required' });
    rows = [r];
  }
  const { error } = await sb.from('wa_messages').insert(rows);
  if (error) {
    console.error('wa_messages insert failed:', error.message);
    return res.status(200).json({ ok: false, reason: 'insert_failed' });
  }
  return res.status(200).json({ ok: true, inserted: rows.length });
}

// Приём медиа от бота: грузим в Storage (wa-media) и пишем сообщение со ссылкой.
// Медиа от клиента: грузим в Storage (публичный bucket) и пишем сообщение.
// Без DDL: ссылку кладём прямо в text с маркером [img]/[video]/[audio]/[file].
const MEDIA_MARK = { image: '[img] ', video: '[video] ', audio: '[audio] ', document: '[file] ' };
async function handleWaMedia(req, res) {
  if (!sb) return res.status(200).json({ skipped: true, reason: 'no supabase' });
  const b = req.body || {};
  const row = toRow(b);
  if (!row) return res.status(400).json({ error: 'jid required' });
  const type = ['image', 'video', 'audio', 'document'].includes(b.media_type) ? b.media_type : 'image';
  let media_url = null;
  try {
    if (b.mediaBase64) {
      const buf = Buffer.from(String(b.mediaBase64), 'base64');
      if (buf.length && buf.length < 15 * 1024 * 1024) {
        await ensureBucket(MEDIA_BUCKET, true);
        const ext = String(b.ext || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
        const dir = (row.phone || 'x').slice(0, 20);
        const path = `${dir}/${crypto.randomUUID()}.${ext}`;
        const up = await sb.storage.from(MEDIA_BUCKET).upload(path, buf, {
          contentType: b.mimetype || 'application/octet-stream', upsert: false,
        });
        if (up.error) console.error('wa-media upload failed:', up.error.message);
        else media_url = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
      }
    }
  } catch (e) { console.error('wa media error:', e.message); }
  // text = "[img] <url>" + опционально подпись с новой строки
  const caption = row.text ? String(row.text) : '';
  row.text = media_url ? ((MEDIA_MARK[type] || '[file] ') + media_url + (caption ? '\n' + caption : '')) : (caption || MEDIA_MARK[type].trim());
  const { error } = await sb.from('wa_messages').insert(row);
  if (error) {
    console.error('wa_media insert failed:', error.message);
    return res.status(200).json({ ok: false, reason: 'insert_failed' });
  }
  return res.status(200).json({ ok: true, media_url });
}

// Постановка ответа менеджера в очередь (из CRM). Авторизация — сессия Supabase (JWT).
async function handleWaSend(req, res) {
  if (!sb) return res.status(200).json({ skipped: true, reason: 'no supabase' });
  const auth = await verifyAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized', detail: auth.error });
  const b = req.body || {};
  const jid = String(b.jid || '').slice(0, 120);
  const text = String(b.text || '').slice(0, 4000).trim();
  if (!jid || !text) return res.status(400).json({ error: 'jid and text required' });
  try {
    await ensureBucket(OUTBOX_BUCKET, false);
    const name = `${Date.now()}-${crypto.randomUUID()}.json`;
    const up = await sb.storage.from(OUTBOX_BUCKET).upload(name, Buffer.from(JSON.stringify({ jid, text })), {
      contentType: 'application/json', upsert: false,
    });
    if (up.error) { console.error('wa_send upload failed:', up.error.message); return res.status(200).json({ ok: false }); }
    return res.status(200).json({ ok: true, id: name });
  } catch (e) { console.error('wa_send error:', e.message); return res.status(200).json({ ok: false }); }
}

// Бот забирает очередь исходящих из Storage (FIFO по имени = timestamp).
async function handleWaPoll(req, res) {
  if (!sb) return res.status(200).json({ items: [] });
  try {
    await ensureBucket(OUTBOX_BUCKET, false);
    const { data, error } = await sb.storage.from(OUTBOX_BUCKET).list('', { limit: 20, sortBy: { column: 'name', order: 'asc' } });
    if (error) { console.error('wa_poll list failed:', error.message); return res.status(200).json({ items: [] }); }
    const items = [];
    for (const obj of (data || [])) {
      if (!obj.name.endsWith('.json')) continue;
      const dl = await sb.storage.from(OUTBOX_BUCKET).download(obj.name);
      if (dl.error || !dl.data) continue;
      try { const j = JSON.parse(await dl.data.text()); items.push({ id: obj.name, jid: j.jid, text: j.text }); }
      catch { await sb.storage.from(OUTBOX_BUCKET).remove([obj.name]); } // битый — убираем
    }
    return res.status(200).json({ items });
  } catch (e) { console.error('wa_poll error:', e.message); return res.status(200).json({ items: [] }); }
}

// Бот отчитался об отправке → удаляем объект из очереди.
async function handleWaSent(req, res) {
  if (!sb) return res.status(200).json({ ok: true });
  const b = req.body || {};
  const id = String(b.id || '');
  if (!id) return res.status(400).json({ error: 'id required' });
  try { await sb.storage.from(OUTBOX_BUCKET).remove([id]); } catch (e) { console.error('wa_sent remove:', e.message); }
  return res.status(200).json({ ok: true });
}

// Уведомление менеджерам о новом входящем сообщении клиента (WhatsApp).
function formatIncoming(b) {
  const phone = String(b.phone || '').replace(/[^\d]/g, '');
  const lines = ['💬 <b>Новое сообщение в WhatsApp</b>', ''];
  if (b.name) lines.push(`👤 ${escHtml(b.name)}`);
  if (phone) lines.push(`📞 +${escHtml(phone)}`);
  if (b.text) { lines.push(''); lines.push(`«${escHtml(String(b.text).slice(0, 400))}»`); }
  return { text: lines.join('\n'), phone };
}

async function handleWaIncoming(req, res) {
  const { text, phone } = formatIncoming(req.body || {});
  const kb = phone ? [[{ text: '💬 Ответить в WhatsApp', url: `https://wa.me/${phone}` }]] : undefined;
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
  // Ответ из CRM: авторизация сессией Supabase (JWT менеджера), не секретом бота
  if (waKind === 'wa_send') return handleWaSend(req, res);
  const WA_KINDS = ['order', 'handoff', 'wa_msg', 'wa_media', 'wa_poll', 'wa_sent', 'wa_incoming'];
  if (WA_KINDS.includes(waKind)) {
    if (!safeEq(rawAuth, WA_BOT_SECRET)) return res.status(401).json({ error: 'Unauthorized' });
    if (waKind === 'wa_msg')   return handleWaMsg(req, res);
    if (waKind === 'wa_media') return handleWaMedia(req, res);
    if (waKind === 'wa_poll')  return handleWaPoll(req, res);
    if (waKind === 'wa_sent')  return handleWaSent(req, res);
    if (!BOT_TOKEN) return res.status(500).json({ error: 'Bot not configured' });
    if (waKind === 'wa_incoming') return handleWaIncoming(req, res);
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
