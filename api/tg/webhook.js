import { higgsfield, config } from '@higgsfield/client/v2';
import { sb } from '../_lib/supabase.js';

const KEY_ID = process.env.HIGGSFIELD_KEY_ID;
const KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPER_ADMINS = (process.env.TELEGRAM_ADMIN_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const MODEL = 'flux-pro/kontext/max/text-to-image';
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

if (KEY_ID && KEY_SECRET) {
  config({ credentials: `${KEY_ID}:${KEY_SECRET}` });
}

// ════════════════════════════════════════════════════════════════════
//  STATUS MAPPING — 1-char codes ⇄ Russian labels
// ════════════════════════════════════════════════════════════════════

const STATUS_BY_CODE = {
  n: 'Новый',
  c: 'Связались',
  p: 'Оплачен',
  s: 'Отправлен',
  d: 'Доставлен',
  x: 'Отменён'
};
const CODE_BY_STATUS = Object.fromEntries(
  Object.entries(STATUS_BY_CODE).map(([k, v]) => [v, k])
);
const STATUS_ICON = {
  Новый:     '🔴',
  Связались: '🟡',
  Оплачен:   '💳',
  Отправлен: '📤',
  Доставлен: '✅',
  Отменён:   '⚫'
};
const STATUS_ORDER = ['Связались', 'Оплачен', 'Отправлен', 'Доставлен', 'Отменён'];

// ════════════════════════════════════════════════════════════════════
//  TELEGRAM BOT API HELPERS
// ════════════════════════════════════════════════════════════════════

async function tg(method, payload) {
  if (!BOT_TOKEN) return null;
  try {
    const r = await fetch(`${TG}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await r.json().catch(() => null);
    if (json && json.ok === false) {
      console.error(`[TG ${method}] NOT OK:`, JSON.stringify(json).slice(0, 500),
        '| payload keys:', Object.keys(payload).join(','));
    }
    return json;
  } catch (e) {
    console.error(`[TG ${method}] threw:`, e.message);
    return null;
  }
}

const sendMsg = (chatId, text, kb) =>
  tg('sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(kb ? { reply_markup: { inline_keyboard: kb } } : {})
  });

const editMsg = (chatId, messageId, text, kb) =>
  tg('editMessageText', {
    chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(kb ? { reply_markup: { inline_keyboard: kb } } : {})
  });

const sendPhoto = (chatId, photo, caption, replyTo) =>
  tg('sendPhoto', {
    chat_id: chatId, photo, caption,
    ...(replyTo ? { reply_to_message_id: replyTo } : {})
  });

const sendAction = (chatId, action) =>
  tg('sendChatAction', { chat_id: chatId, action });

const ackCallback = (cbId, text, alert) =>
  tg('answerCallbackQuery', { callback_query_id: cbId, text, show_alert: !!alert });

// ════════════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════════════

async function isSuperAdmin(userId) {
  return SUPER_ADMINS.includes(String(userId || ''));
}

async function isAdmin(userId) {
  const id = String(userId || '');
  if (!id) return false;
  if (SUPER_ADMINS.includes(id)) return true;
  if (!sb) return false;
  const { data } = await sb.from('tg_admins')
    .select('id')
    .eq('telegram_user_id', userId)
    .maybeSingle();
  return !!data;
}

// ════════════════════════════════════════════════════════════════════
//  FORMATTING HELPERS
// ════════════════════════════════════════════════════════════════════

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

function fmtDate(s) {
  const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const diffDays = Math.floor((today - date) / 86400000);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (diffDays === 0) return `сегодня ${hh}:${mm}`;
  if (diffDays === 1) return `вчера ${hh}:${mm}`;
  if (diffDays < 7) return `${diffDays}д назад`;
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

function parseItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const j = JSON.parse(raw); return Array.isArray(j) ? j : []; }
    catch { return []; }
  }
  return [];
}

function formatOrderFull(row) {
  const status = row.status || 'Новый';
  const icon = STATUS_ICON[status] || '⚪';
  const sid = shortId(row.id);
  const lines = [];

  lines.push(`📦 <b>Заказ #${sid}</b> · ${icon} ${escHtml(status)}`);
  if (row.created_at) lines.push(`<i>${fmtDate(row.created_at)}</i>`);
  lines.push('');

  if (row.name) lines.push(`👤 <b>${escHtml(row.name)}</b>`);
  if (row.phone) {
    const cp = String(row.phone).replace(/[^\d+]/g, '');
    lines.push(`📞 <a href="tel:${escHtml(cp)}">${escHtml(row.phone)}</a>`);
  }
  if (row.email) lines.push(`📧 ${escHtml(row.email)}`);
  lines.push('');

  const items = parseItems(row.items);
  if (items.length) {
    items.forEach((it, i) => {
      const name = it.name || it.title || it.product || 'товар';
      const size = it.size ? ` · ${escHtml(it.size)}` : '';
      const qty = it.qty || it.quantity || 1;
      const ip = it.price ? fmtPrice(Number(it.price) * Number(qty || 1)) : null;
      const pf = i === 0 ? '🛍 ' : '   ';
      lines.push(`${pf}${escHtml(name)}${size} ×${qty}${ip ? ' — ' + ip : ''}`);
    });
  }

  const ts = fmtPrice(row.total);
  if (ts) lines.push(`💰 <b>Итого: ${ts}</b>`);
  lines.push('');

  const dp = [];
  if (row.delivery) dp.push(escHtml(row.delivery));
  if (row.country)  dp.push(escHtml(row.country));
  if (row.city)     dp.push(escHtml(row.city));
  if (dp.length) lines.push(`🚚 ${dp.join(' · ')}`);
  if (row.address) lines.push(`📍 ${escHtml(row.address)}`);
  if (row.comment) lines.push(`💬 «${escHtml(row.comment)}»`);

  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════
//  KEYBOARDS
// ════════════════════════════════════════════════════════════════════

async function mainMenuKb() {
  let newCount = 0;
  if (sb) {
    const { count } = await sb.from('rfc_orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Новый');
    newCount = count || 0;
  }
  return [
    [{ text: newCount > 0 ? `📦 Заказы (${newCount} 🔴)` : '📦 Заказы', callback_data: 'orders' }],
    [
      { text: '🎨 AI Студия', callback_data: 'ai' },
      { text: '📊 Стата 🚧',  callback_data: 'stats' }
    ],
    [
      { text: '⚙️ Админы',     callback_data: 'admins' },
      { text: 'ℹ️ Помощь',      callback_data: 'help' }
    ]
  ];
}

const backToMenuKb = () => [
  [{ text: '← Главное меню', callback_data: 'menu' }]
];

const backToOrdersKb = () => [
  [{ text: '← К списку заказов', callback_data: 'orders' }, { text: '🏠 Меню', callback_data: 'menu' }]
];

function buildStatusKb(orderId, currentStatus, phone) {
  const kb = [];
  // 2 buttons per row, current status marked with ●
  for (let i = 0; i < STATUS_ORDER.length; i += 2) {
    const row = [];
    for (let j = 0; j < 2 && i + j < STATUS_ORDER.length; j++) {
      const status = STATUS_ORDER[i + j];
      const code = CODE_BY_STATUS[status];
      const isCurrent = status === currentStatus;
      const icon = STATUS_ICON[status] || '⚪';
      row.push({
        text: `${isCurrent ? '● ' : ''}${icon} ${status}`,
        callback_data: `set:${orderId}:${code}`
      });
    }
    kb.push(row);
  }
  // WhatsApp / phone deeplinks
  if (phone) {
    const cp = String(phone).replace(/[^\d+]/g, '');
    const waNumber = cp.replace(/^\+/, '');
    kb.push([
      { text: '💬 WhatsApp', url: `https://wa.me/${waNumber}` },
      { text: '📞 Позвонить', url: `tel:${cp}` }
    ]);
  }
  kb.push([{ text: '🔄 Обновить', callback_data: `ord:${orderId}` }]);
  kb.push([
    { text: '← К списку', callback_data: 'orders' },
    { text: '🏠 Меню',    callback_data: 'menu' }
  ]);
  return kb;
}

const adminsMenuKb = (isSuper) => {
  const kb = [
    [{ text: '👀 Список админов', callback_data: 'admins:list' }]
  ];
  if (isSuper) kb.push([{ text: '➕ Как добавить', callback_data: 'admins:howto' }]);
  kb.push([{ text: '← Главное меню', callback_data: 'menu' }]);
  return kb;
};

// ════════════════════════════════════════════════════════════════════
//  SCREEN: ORDERS LIST
// ════════════════════════════════════════════════════════════════════

async function showOrdersList(chatId, messageId) {
  if (!sb) return editMsg(chatId, messageId, '⚠️ Supabase не подключён', backToMenuKb());

  const { data, error } = await sb.from('rfc_orders')
    .select('id, created_at, name, total, status')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) return editMsg(chatId, messageId, '❌ Ошибка чтения:\n' + escHtml(error.message), backToMenuKb());
  if (!data || data.length === 0) {
    return editMsg(chatId, messageId,
      `📦 <b>Заказы</b>\n\n<i>Пока пусто.</i>\nКогда придёт первый заказ — он появится здесь и в Telegram-уведомлении.`,
      backToMenuKb());
  }

  const newCount = data.filter(o => o.status === 'Новый').length;
  const header =
    `📦 <b>Последние ${data.length} заказов</b>` +
    (newCount ? `\n🔴 Новых требуют внимания: ${newCount}` : '') +
    `\n\nЖми по строке → откроется детальный экран с возможностью смены статуса.`;

  const kb = data.map(o => {
    const icon = STATUS_ICON[o.status] || '⚪';
    const sid = shortId(o.id);
    const name = (o.name || 'без имени').slice(0, 18);
    const total = fmtPrice(o.total);
    const totalStr = total ? ` · ${total}` : '';
    return [{
      text: `${icon} #${sid} · ${name}${totalStr}`,
      callback_data: `ord:${o.id}`
    }];
  });
  kb.push([{ text: '🔄 Обновить', callback_data: 'orders' }]);
  kb.push([{ text: '← Главное меню', callback_data: 'menu' }]);

  return editMsg(chatId, messageId, header, kb);
}

// ════════════════════════════════════════════════════════════════════
//  SCREEN: ORDER DETAIL
// ════════════════════════════════════════════════════════════════════

async function showOrderDetail(chatId, messageId, orderId) {
  console.log('[showOrderDetail] start', { orderId, hasSb: !!sb, chatId, messageId });
  if (!sb) return editMsg(chatId, messageId, '⚠️ Supabase не подключён', backToOrdersKb());

  const { data, error } = await sb.from('rfc_orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();

  console.log('[showOrderDetail] supabase result', {
    found: !!data, error: error?.message,
    id: data?.id, status: data?.status
  });

  if (error) {
    return editMsg(chatId, messageId,
      '❌ Ошибка:\n' + escHtml(error.message), backToOrdersKb());
  }
  if (!data) {
    return editMsg(chatId, messageId,
      `❌ Заказ <code>${escHtml(String(orderId).slice(0, 50))}</code> не найден.\n\nВозможно был удалён.`,
      backToOrdersKb());
  }

  const text = formatOrderFull(data);
  const kb = buildStatusKb(data.id, data.status || 'Новый', data.phone);
  console.log('[showOrderDetail] sending editMsg', { textLen: text.length, kbRows: kb.length });
  const r = await editMsg(chatId, messageId, text, kb);
  console.log('[showOrderDetail] editMsg result', { ok: r?.ok, desc: r?.description });
  return r;
}

// ════════════════════════════════════════════════════════════════════
//  ACTION: SET ORDER STATUS
// ════════════════════════════════════════════════════════════════════

async function setOrderStatus(orderId, newStatus) {
  if (!sb) return { ok: false, error: 'Supabase not configured' };
  const { error, data } = await sb.from('rfc_orders')
    .update({ status: newStatus })
    .eq('id', orderId)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data)  return { ok: false, error: 'Заказ не найден' };
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════
//  OTHER SCREENS
// ════════════════════════════════════════════════════════════════════

async function showMainMenu(chatId, messageId) {
  const text =
    `🚩 <b>RFC Admin Bot</b>\n\n` +
    `Выбери раздел кнопкой ниже. История заказов и генераций общая — между ботом и админкой redflag.kz.\n\n` +
    `<i>Заказы в реальном времени, смена статусов, история ↔ всё работает синхронно с веб-CRM.</i>`;
  const kb = await mainMenuKb();
  if (messageId) return editMsg(chatId, messageId, text, kb);
  return sendMsg(chatId, text, kb);
}

async function showAiMenu(chatId, messageId) {
  const text =
    `🎨 <b>AI Студия</b>\n\n` +
    `<b>Простой режим (работает):</b>\nПросто пришли в чат английский промпт — сгенерю картинку через Higgsfield.\n\n` +
    `<b>Полный режим с каталогом одежды</b> — фаза 6D.\n\n` +
    `Пример промпта:\n<code>Cinematic streetwear editorial, young Kazakh man in black tee, brutalist concrete wall in Astana, hard side light, 35mm</code>`;
  return editMsg(chatId, messageId, text, backToMenuKb());
}

async function showStatsStub(chatId, messageId) {
  return editMsg(chatId, messageId,
    `📊 <b>Статистика</b>\n\n🚧 Скоро (фаза 6E)\n\nПланируется: заказов за день/неделю, общая сумма, AI-генераций по источникам, баланс Higgsfield Cloud.`,
    backToMenuKb());
}

async function buildHelpText() {
  return (
    `ℹ️ <b>Помощь</b>\n\n` +
    `<b>Текстовые команды:</b>\n` +
    `<code>/start</code> или <code>/menu</code> — главное меню\n` +
    `<code>/help</code> — эта подсказка\n` +
    `<code>/myid</code> — твой Telegram ID\n` +
    `<code>/admin list</code> — список админов\n` +
    `<code>/admin add &lt;id&gt; [имя]</code> — добавить (super)\n` +
    `<code>/admin remove &lt;id&gt;</code> — убрать (super)\n\n` +
    `<b>Без команды:</b>\n` +
    `Пиши промпт текстом — сгенерю картинку через Higgsfield.\n\n` +
    `<b>Автоматика:</b>\n` +
    `🔔 Новые заказы с redflag.kz приходят сюда автоматически с кнопкой «Управлять».`
  );
}

async function showHelpMenu(chatId, messageId) {
  return editMsg(chatId, messageId, await buildHelpText(), backToMenuKb());
}

async function showAdminsMenu(chatId, messageId, userId) {
  const isSuper = await isSuperAdmin(userId);
  const text =
    `⚙️ <b>Управление админами</b>\n\n` +
    (isSuper
      ? `Ты <b>super-admin</b> — через Vercel env <code>TELEGRAM_ADMIN_IDS</code>.\n\nМожешь добавлять и удалять обычных админов из таблицы Supabase.`
      : `Ты <b>обычный админ</b> — управление списком только у super-admin.`);
  return editMsg(chatId, messageId, text, adminsMenuKb(isSuper));
}

async function showAdminsList(chatId, messageId) {
  let text = '👀 <b>Список админов</b>\n\n<b>Super-admin (Vercel env):</b>\n';
  text += SUPER_ADMINS.length
    ? SUPER_ADMINS.map(id => `• <code>${id}</code>`).join('\n') + '\n'
    : '<i>пусто — выставь TELEGRAM_ADMIN_IDS в Vercel</i>\n';
  text += '\n<b>Обычные админы (Supabase):</b>\n';
  if (!sb) text += '<i>Supabase не подключён</i>';
  else {
    const { data, error } = await sb.from('tg_admins')
      .select('telegram_user_id, name, username, added_at')
      .order('added_at', { ascending: true });
    if (error)       text += `<i>Ошибка: ${error.message}</i>`;
    else if (!data?.length) text += '<i>пусто. Добавь через /admin add &lt;id&gt;</i>';
    else text += data.map(a => `• <code>${a.telegram_user_id}</code> · ${a.name || a.username || '—'}`).join('\n');
  }
  return editMsg(chatId, messageId, text, [[{ text: '← Назад', callback_data: 'admins' }]]);
}

async function showAdminsHowto(chatId, messageId) {
  const text =
    `➕ <b>Как добавить админа</b>\n\n` +
    `<code>/admin add 123456789</code>\n\n` +
    `где <code>123456789</code> — Telegram user ID нового админа.\nID узнают через <a href="https://t.me/userinfobot">@userinfobot</a>.\n\n` +
    `С именем: <code>/admin add 123456789 Алина</code>\n` +
    `Удалить: <code>/admin remove 123456789</code>`;
  return editMsg(chatId, messageId, text, [[{ text: '← Назад', callback_data: 'admins' }]]);
}

// ════════════════════════════════════════════════════════════════════
//  TEXT-COMMAND HANDLERS
// ════════════════════════════════════════════════════════════════════

async function handleAdminCommand(chatId, userId, text) {
  const parts = text.trim().split(/\s+/);
  const sub = parts[1] || '';
  const target = parts[2] || '';
  const name = parts.slice(3).join(' ') || null;

  if (sub === 'list' || sub === '') return showAdminsList(chatId, null);
  if (!(await isSuperAdmin(userId))) return sendMsg(chatId, '🔒 Только super-admin может добавлять/удалять.');
  if (!sb) return sendMsg(chatId, '⚠️ Supabase не настроен.');

  if (sub === 'add') {
    if (!/^\d+$/.test(target)) return sendMsg(chatId, 'Использование:\n<code>/admin add 123456789 [имя]</code>');
    const tid = parseInt(target, 10);
    const { error } = await sb.from('tg_admins').upsert({
      telegram_user_id: tid, name, added_by: Number(userId)
    }, { onConflict: 'telegram_user_id' });
    if (error) return sendMsg(chatId, '❌ Ошибка: ' + error.message);
    return sendMsg(chatId, `✅ Админ <code>${tid}</code>${name ? ' (' + name + ')' : ''} добавлен.`);
  }

  if (sub === 'remove' || sub === 'rm') {
    if (!/^\d+$/.test(target)) return sendMsg(chatId, 'Использование:\n<code>/admin remove 123456789</code>');
    const tid = parseInt(target, 10);
    if (SUPER_ADMINS.includes(target)) return sendMsg(chatId, '⚠️ Это super-admin, его убирают только через Vercel env vars.');
    const { error } = await sb.from('tg_admins').delete().eq('telegram_user_id', tid);
    if (error) return sendMsg(chatId, '❌ Ошибка: ' + error.message);
    return sendMsg(chatId, `✅ Админ <code>${tid}</code> удалён.`);
  }
  return sendMsg(chatId, 'Подкоманды:\n<code>list</code> · <code>add &lt;id&gt; [имя]</code> · <code>remove &lt;id&gt;</code>');
}

// ════════════════════════════════════════════════════════════════════
//  CALLBACK ROUTER
// ════════════════════════════════════════════════════════════════════

async function routeCallback(cb) {
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const userId = cb.from.id;
  const data = cb.data || '';

  if (data === 'menu')          return showMainMenu(chatId, messageId);
  if (data === 'orders')        return showOrdersList(chatId, messageId);
  if (data.startsWith('ord:'))  return showOrderDetail(chatId, messageId, data.slice(4));
  if (data === 'stats')         return showStatsStub(chatId, messageId);
  if (data === 'ai')            return showAiMenu(chatId, messageId);
  if (data === 'help')          return showHelpMenu(chatId, messageId);
  if (data === 'admins')        return showAdminsMenu(chatId, messageId, userId);
  if (data === 'admins:list')   return showAdminsList(chatId, messageId);
  if (data === 'admins:howto')  return showAdminsHowto(chatId, messageId);

  return editMsg(chatId, messageId, 'Неизвестная кнопка.', backToMenuKb());
}

// ════════════════════════════════════════════════════════════════════
//  GENERATION FALLBACK (from Phase 5 — обычный текст → картинка)
// ════════════════════════════════════════════════════════════════════

async function handleGeneration(msg, updateId) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = (msg.text || '').trim();
  const messageId = msg.message_id;

  if (!text)         return sendMsg(chatId, 'Пришли промпт текстом или /menu для меню.');
  if (text.length > 4000) return sendMsg(chatId, 'Слишком длинный промпт (макс 4000).');

  if (sb && updateId) {
    const { data: existing } = await sb.from('ai_generations')
      .select('id, status, result_url')
      .eq('telegram_update_id', updateId)
      .maybeSingle();
    if (existing) {
      if (existing.status === 'completed' && existing.result_url) {
        await sendPhoto(chatId, existing.result_url, '(дубликат)', messageId);
      }
      return;
    }
  }

  if (!KEY_ID || !KEY_SECRET) return sendMsg(chatId, '⚠️ Higgsfield не настроен в Vercel.');

  let rowId = null;
  if (sb) {
    const { data: row } = await sb.from('ai_generations').insert({
      prompt: text, prompt_used: text, model: MODEL, aspect: '4:5',
      elements: [], status: 'submitting',
      telegram_chat_id: chatId,
      telegram_user_id: userId ? Number(userId) : null,
      telegram_update_id: updateId,
      source: 'telegram'
    }).select('id').single();
    rowId = row?.id || null;
  }

  await sendAction(chatId, 'upload_photo');
  await sendMsg(chatId, '🎨 Генерирую… 15–60 сек');

  try {
    const jobSet = await higgsfield.subscribe(MODEL, {
      input: { prompt: text, aspect_ratio: '4:5', safety_tolerance: 2 },
      withPolling: true
    });
    if (jobSet.isCompleted) {
      const url = jobSet.jobs?.[0]?.results?.raw?.url;
      if (url) {
        if (sb && rowId) await sb.from('ai_generations').update({
          job_id: jobSet.id, status: 'completed', result_url: url
        }).eq('id', rowId);
        await sendPhoto(chatId, url, `🚩 ${text.slice(0, 900)}`, messageId);
      } else await sendMsg(chatId, 'Higgsfield завершил без URL. Попробуй ещё раз.');
    } else if (jobSet.isFailed) {
      await sendMsg(chatId, '❌ Higgsfield: генерация не удалась');
      if (sb && rowId) await sb.from('ai_generations').update({ status: 'error', error: 'failed' }).eq('id', rowId);
    } else if (jobSet.isNsfw) {
      await sendMsg(chatId, '❌ NSFW. Перефразируй промпт нейтральнее.');
      if (sb && rowId) await sb.from('ai_generations').update({ status: 'error', error: 'nsfw' }).eq('id', rowId);
    }
  } catch (e) {
    const name = e?.name || '';
    const msgErr = e?.message || String(e);
    let reply = `❌ ${msgErr.slice(0, 300)}`;
    if (name === 'NotEnoughCreditsError' || (name === 'AccountError' && /credit/i.test(msgErr))) {
      reply = '💳 Кончились кредиты Higgsfield Cloud API.\nhttps://cloud.higgsfield.ai';
    } else if (name === 'AuthenticationError') reply = '🔐 Higgsfield auth fail.';
    await sendMsg(chatId, reply);
    if (sb && rowId) await sb.from('ai_generations').update({
      status: 'error', error: `${name}: ${msgErr}`.slice(0, 500)
    }).eq('id', rowId);
  }
}

// ════════════════════════════════════════════════════════════════════
//  MAIN HANDLER
// ════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');
  if (!BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not configured');
    return res.status(200).send('OK');
  }

  const update = req.body || {};

  // ── CALLBACK QUERY ────────────────────────────────────────────────
  if (update.callback_query) {
    const cb = update.callback_query;
    const userId = cb.from?.id;
    const chatId = cb.message?.chat?.id;
    const messageId = cb.message?.message_id;
    const cbData = cb.data || '';

    console.log('[callback] received', { data: cbData, userId, chatId, messageId });

    if (!(await isAdmin(userId))) {
      await ackCallback(cb.id, '🔒 Доступ закрыт', true);
      return res.status(200).send('OK');
    }

    // SPECIAL: status change — ack with toast then refresh detail view
    if (cbData.startsWith('set:')) {
      const rest = cbData.slice(4);
      const colon = rest.lastIndexOf(':');
      const orderId = rest.slice(0, colon);
      const code = rest.slice(colon + 1);
      const newStatus = STATUS_BY_CODE[code];
      if (!newStatus) {
        await ackCallback(cb.id, '❌ Неизвестный статус', true);
        return res.status(200).send('OK');
      }
      const result = await setOrderStatus(orderId, newStatus);
      await ackCallback(cb.id,
        result.ok ? `✅ Статус → ${newStatus}` : `❌ ${result.error || 'Ошибка'}`,
        !result.ok
      );
      if (result.ok) {
        try { await showOrderDetail(chatId, messageId, orderId); }
        catch (e) { console.error('refresh detail after set failed:', e.message); }
      }
      return res.status(200).send('OK');
    }

    await ackCallback(cb.id);
    try { await routeCallback(cb); }
    catch (e) { console.error('routeCallback failed:', e.message); }
    return res.status(200).send('OK');
  }

  // ── TEXT MESSAGE ──────────────────────────────────────────────────
  const msg = update.message;
  if (!msg) return res.status(200).send('OK');

  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const text = (msg.text || '').trim();
  const updateId = update.update_id;
  if (!chatId) return res.status(200).send('OK');

  if (text === '/myid') {
    await sendMsg(chatId,
      `Твой Telegram ID:\n<code>${userId}</code>\n\nЕсли ты не админ — попроси super-admin:\n<code>/admin add ${userId}</code>`);
    return res.status(200).send('OK');
  }

  if (!(await isAdmin(userId))) {
    await sendMsg(chatId,
      `🔒 <b>Доступ закрыт</b>\n\nЭтот бот только для админов RFC.\n\nТвой ID: <code>${userId}</code>\n\nЧтобы получить доступ — попроси super-admin:\n<code>/admin add ${userId}</code>`);
    return res.status(200).send('OK');
  }

  if (text === '/start' || text === '/menu') {
    await showMainMenu(chatId);
    return res.status(200).send('OK');
  }
  if (text === '/help') {
    const txt = await buildHelpText();
    const kb = await mainMenuKb();
    await sendMsg(chatId, txt, kb);
    return res.status(200).send('OK');
  }
  if (text.startsWith('/admin')) {
    await handleAdminCommand(chatId, userId, text);
    return res.status(200).send('OK');
  }
  if (text.startsWith('/')) {
    await sendMsg(chatId, 'Неизвестная команда. /help для подсказки.');
    return res.status(200).send('OK');
  }

  await handleGeneration(msg, updateId);
  return res.status(200).send('OK');
}
