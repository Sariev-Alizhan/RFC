// Уведомление менеджерам в Telegram о лиде из WhatsApp-бота (заказ / запрос менеджера).
// Вызывается WA-ботом с Bearer WA_BOT_SECRET. Секреты (токен бота, Supabase) — только здесь, в рантайме Vercel.
import { sb } from '../_lib/supabase.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPER_ADMINS = (process.env.TELEGRAM_ADMIN_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
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

async function getAllAdminChatIds() {
  const ids = new Set();
  SUPER_ADMINS.forEach(s => { const n = Number(s); if (Number.isFinite(n) && n > 0) ids.add(n); });
  if (sb) {
    const { data, error } = await sb.from('tg_admins').select('telegram_user_id');
    if (error) console.error('tg_admins read failed:', error.message);
    else if (data) data.forEach(a => { const n = Number(a.telegram_user_id); if (Number.isFinite(n) && n > 0) ids.add(n); });
  }
  return Array.from(ids);
}

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
  lines.push('⚡️ Бот поставлен на паузу в этом чате — ответь клиенту сам.');
  return { text: lines.join('\n'), phone };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'rfc-tg-notify-lead', configured: !!WA_BOT_SECRET && !!BOT_TOKEN });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!WA_BOT_SECRET) return res.status(500).json({ error: 'WA_BOT_SECRET not configured' });
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (auth !== WA_BOT_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (!BOT_TOKEN) return res.status(500).json({ error: 'Bot not configured' });

  const b = req.body || {};
  const { text, phone } = formatLead(b);

  const kb = phone
    ? [[{ text: '💬 Написать клиенту', url: `https://wa.me/${phone}` }]]
    : undefined;

  const adminIds = await getAllAdminChatIds();
  if (!adminIds.length) return res.status(200).json({ skipped: true, reason: 'no admins' });

  let sent = 0;
  for (const chatId of adminIds) {
    const r = await tg('sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(kb ? { reply_markup: { inline_keyboard: kb } } : {})
    });
    if (r?.ok) sent++;
  }
  return res.status(200).json({ sent, admins: adminIds.length });
}
