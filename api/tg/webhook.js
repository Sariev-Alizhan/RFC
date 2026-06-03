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
//  STATUS MAPPING (orders)
// ════════════════════════════════════════════════════════════════════

const STATUS_BY_CODE = {
  n: 'Новый', c: 'Связались', p: 'Оплачен',
  s: 'Отправлен', d: 'Доставлен', x: 'Отменён'
};
const CODE_BY_STATUS = Object.fromEntries(
  Object.entries(STATUS_BY_CODE).map(([k, v]) => [v, k])
);
const STATUS_ICON = {
  Новый: '🔴', Связались: '🟡', Оплачен: '💳',
  Отправлен: '📤', Доставлен: '✅', Отменён: '⚫'
};
const STATUS_ORDER = ['Связались', 'Оплачен', 'Отправлен', 'Доставлен', 'Отменён'];

// ════════════════════════════════════════════════════════════════════
//  AI STUDIO CATALOG — Russian labels + English prompt fragments
// ════════════════════════════════════════════════════════════════════

const PRODUCT_TYPES = {
  cap:    { ru: '🧢 Кепка',    en: 'baseball cap' },
  tee:    { ru: '👕 Футболка', en: 'cotton t-shirt' },
  hoodie: { ru: '🟫 Худи',     en: 'heavyweight cotton hoodie' },
  sweat:  { ru: '🟦 Свитшот',  en: 'crewneck cotton sweatshirt' },
  socks:  { ru: '🧦 Носки',    en: 'cotton ankle socks' },
  none:   { ru: '⏭ Без товара', en: null }
};

const COLORS = {
  white: { ru: '⚪ Белая',  en: 'clean crisp white' },
  red:   { ru: '🔴 Красная', en: 'vibrant deep red' },
  other: { ru: '⚫ Тёмная',  en: 'charcoal black/navy' }
};

// English prompt fragment for "wearing/featuring" given type+color
function productPromptFragment(type, color) {
  if (!type || type === 'none') return null;
  const t = PRODUCT_TYPES[type]?.en;
  const c = COLORS[color]?.en;
  if (!t || !c) return null;
  if (type === 'cap')    return `wearing a ${c} ${t} with embroidered red flag patch on the front`;
  if (type === 'tee')    return `wearing a ${c} ${t} with subtle red flag chest print`;
  if (type === 'hoodie') return `wearing a ${c} ${t} with embroidered red flag detail`;
  if (type === 'sweat')  return `wearing a ${c} ${t} with embroidered red flag patch`;
  if (type === 'socks')  return `featuring ${c} ${t} with red flag detail at the ankle`;
  return null;
}

const STYLES = {
  cinematic: {
    ru: '🎬 Cinematic editorial',
    en: 'Cinematic editorial portrait, 35mm prime f/2.8, hard side directional light casting architectural shadows, brutalist concrete wall background, slight color desaturation, Kodak Portra 400 film grain, no smile, documentary quiet confidence mood, young Kazakh subject, three-quarter framing'
  },
  golden: {
    ru: '☀️ Golden hour homie',
    en: 'Golden hour editorial lookbook shot, warm sunset light, ALD Aimé Leon Dore homie aesthetic, casual confident posing on city steps, soft warm shadows, vintage Portra film aesthetic, environmental detail, lifestyle moment'
  },
  brutalist: {
    ru: '🏙 Astana brutalist',
    en: 'Wide environmental editorial shot, brutalist Soviet architecture in Astana Kazakhstan, monumental concrete structures, cold neutral palette, subject walking through plaza, 35mm wide-angle, documentary streetwear photography'
  },
  studio: {
    ru: '📸 Studio macro',
    en: 'Macro detail product shot, soft diffused window light, neutral light grey background, sharp focus on embroidered red flag patch and garment texture, premium streetwear product photography, shallow depth of field'
  }
};

const ASPECTS = {
  '4:5':  '📱 4:5 портрет',
  '1:1':  '⬛ 1:1 квадрат',
  '9:16': '📲 9:16 stories',
  '16:9': '🖥 16:9 wide'
};

// ════════════════════════════════════════════════════════════════════
//  TELEGRAM API
// ════════════════════════════════════════════════════════════════════

async function tg(method, payload) {
  if (!BOT_TOKEN) return null;
  try {
    const r = await fetch(`${TG}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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

const sendMsg = (chatId, text, kb, extra) =>
  tg('sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
    ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}),
    ...(extra || {})
  });

const editMsg = (chatId, messageId, text, kb) =>
  tg('editMessageText', {
    chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(kb ? { reply_markup: { inline_keyboard: kb } } : {})
  });

const sendPhoto = (chatId, photo, caption, replyTo) =>
  tg('sendPhoto', { chat_id: chatId, photo, caption,
    ...(replyTo ? { reply_to_message_id: replyTo } : {}) });

const sendAction = (chatId, action) => tg('sendChatAction', { chat_id: chatId, action });

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
  const { data } = await sb.from('tg_admins').select('id').eq('telegram_user_id', userId).maybeSingle();
  return !!data;
}

// ════════════════════════════════════════════════════════════════════
//  WIZARD STATE
// ════════════════════════════════════════════════════════════════════

async function getWizardState(userId) {
  if (!sb) return null;
  const { data } = await sb.from('tg_wizard_state').select('*').eq('telegram_user_id', userId).maybeSingle();
  return data || null;
}

async function setWizardState(userId, patch) {
  if (!sb) return;
  await sb.from('tg_wizard_state').upsert({
    telegram_user_id: Number(userId), ...patch, updated_at: new Date().toISOString()
  }, { onConflict: 'telegram_user_id' });
}

async function clearWizardState(userId) {
  if (!sb) return;
  await sb.from('tg_wizard_state').delete().eq('telegram_user_id', userId);
}

// ════════════════════════════════════════════════════════════════════
//  HELPERS
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
  const diff = Math.floor((today - date) / 86400000);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (diff === 0) return `сегодня ${hh}:${mm}`;
  if (diff === 1) return `вчера ${hh}:${mm}`;
  if (diff < 7) return `${diff}д назад`;
  return `${date.getDate()} ${months[date.getMonth()]}`;
}
function parseItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') { try { const j = JSON.parse(raw); return Array.isArray(j) ? j : []; } catch { return []; } }
  return [];
}

function formatOrderFull(row) {
  const status = row.status || 'Новый';
  const icon = STATUS_ICON[status] || '⚪';
  const lines = [];
  lines.push(`📦 <b>Заказ #${shortId(row.id)}</b> · ${icon} ${escHtml(status)}`);
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
    const { count } = await sb.from('rfc_orders').select('*', { count: 'exact', head: true }).eq('status', 'Новый');
    newCount = count || 0;
  }
  return [
    [{ text: newCount > 0 ? `📦 Заказы (${newCount} 🔴)` : '📦 Заказы', callback_data: 'orders' }],
    [{ text: '🎨 AI Студия', callback_data: 'ai' }, { text: '📊 Статистика', callback_data: 'stats' }],
    [{ text: '⚙️ Админы',     callback_data: 'admins' }, { text: 'ℹ️ Помощь', callback_data: 'help' }]
  ];
}

const backToMenuKb = () => [[{ text: '← Главное меню', callback_data: 'menu' }]];
const backToOrdersKb = () => [
  [{ text: '← К списку заказов', callback_data: 'orders' }, { text: '🏠 Меню', callback_data: 'menu' }]
];

function buildStatusKb(orderId, currentStatus, phone) {
  const kb = [];
  for (let i = 0; i < STATUS_ORDER.length; i += 2) {
    const row = [];
    for (let j = 0; j < 2 && i + j < STATUS_ORDER.length; j++) {
      const status = STATUS_ORDER[i + j];
      const code = CODE_BY_STATUS[status];
      const isCur = status === currentStatus;
      const icon = STATUS_ICON[status] || '⚪';
      row.push({ text: `${isCur ? '● ' : ''}${icon} ${status}`, callback_data: `set:${orderId}:${code}` });
    }
    kb.push(row);
  }
  if (phone) {
    const cp = String(phone).replace(/[^\d+]/g, '');
    const waN = cp.replace(/^\+/, '');
    if (waN.length >= 7) kb.push([{ text: '💬 WhatsApp клиенту', url: `https://wa.me/${waN}` }]);
  }
  kb.push([{ text: '🔄 Обновить', callback_data: `ord:${orderId}` }]);
  kb.push([{ text: '← К списку', callback_data: 'orders' }, { text: '🏠 Меню', callback_data: 'menu' }]);
  return kb;
}

const adminsMenuKb = (isSuper) => {
  const kb = [[{ text: '👀 Список админов', callback_data: 'admins:list' }]];
  if (isSuper) kb.push([{ text: '➕ Как добавить', callback_data: 'admins:howto' }]);
  kb.push([{ text: '← Главное меню', callback_data: 'menu' }]);
  return kb;
};

// ════════════════════════════════════════════════════════════════════
//  SCREEN: ORDERS LIST / DETAIL
// ════════════════════════════════════════════════════════════════════

async function showOrdersList(chatId, messageId) {
  if (!sb) return editMsg(chatId, messageId, '⚠️ Supabase не подключён', backToMenuKb());
  const { data, error } = await sb.from('rfc_orders')
    .select('id, created_at, name, total, status').order('created_at', { ascending: false }).limit(10);
  if (error) return editMsg(chatId, messageId, '❌ Ошибка чтения:\n' + escHtml(error.message), backToMenuKb());
  if (!data?.length) return editMsg(chatId, messageId,
    `📦 <b>Заказы</b>\n\n<i>Пока пусто.</i>`, backToMenuKb());

  const newCount = data.filter(o => o.status === 'Новый').length;
  const header = `📦 <b>Последние ${data.length} заказов</b>` +
    (newCount ? `\n🔴 Новых: ${newCount}` : '') +
    `\n\nЖми по строке → детальный экран + смена статуса.`;

  const kb = data.map(o => {
    const icon = STATUS_ICON[o.status] || '⚪';
    const sid = shortId(o.id);
    const name = (o.name || 'без имени').slice(0, 18);
    const total = fmtPrice(o.total);
    return [{ text: `${icon} #${sid} · ${name}${total ? ' · ' + total : ''}`, callback_data: `ord:${o.id}` }];
  });
  kb.push([{ text: '🔄 Обновить', callback_data: 'orders' }]);
  kb.push([{ text: '← Главное меню', callback_data: 'menu' }]);
  return editMsg(chatId, messageId, header, kb);
}

async function showOrderDetail(chatId, messageId, orderId) {
  if (!sb) return editMsg(chatId, messageId, '⚠️ Supabase не подключён', backToOrdersKb());
  const { data, error } = await sb.from('rfc_orders').select('*').eq('id', orderId).maybeSingle();
  if (error) return editMsg(chatId, messageId, '❌ Ошибка:\n' + escHtml(error.message), backToOrdersKb());
  if (!data) return editMsg(chatId, messageId,
    `❌ Заказ <code>${escHtml(String(orderId).slice(0,50))}</code> не найден.`, backToOrdersKb());
  const text = formatOrderFull(data);
  const kb = buildStatusKb(data.id, data.status || 'Новый', data.phone);
  return editMsg(chatId, messageId, text, kb);
}

async function setOrderStatus(orderId, newStatus) {
  if (!sb) return { ok: false, error: 'Supabase not configured' };
  const { error, data } = await sb.from('rfc_orders').update({ status: newStatus }).eq('id', orderId).select('id').maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Заказ не найден' };
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════
//  SCREEN: AI STUDIO WIZARD
// ════════════════════════════════════════════════════════════════════

async function showAiStep1(chatId, messageId, userId) {
  // Reset state on entry to wizard
  await setWizardState(userId, { type: null, color: null, style: null, aspect: '4:5', custom_text: null, awaiting_input: null });
  const text = `🎨 <b>AI Студия · шаг 1/3</b>\n\nКакую вещь снимаем?\nТовар будет автоматически вписан в промпт.`;
  const types = Object.entries(PRODUCT_TYPES);
  const kb = [];
  // 2 buttons per row
  for (let i = 0; i < types.length; i += 2) {
    const row = [];
    for (let j = 0; j < 2 && i + j < types.length; j++) {
      const [code, info] = types[i + j];
      row.push({ text: info.ru, callback_data: `ai:t:${code}` });
    }
    kb.push(row);
  }
  kb.push([{ text: '← Главное меню', callback_data: 'menu' }]);
  return editMsg(chatId, messageId, text, kb);
}

async function showAiStep2(chatId, messageId, userId) {
  const st = await getWizardState(userId);
  const type = st?.type;
  if (!type) return showAiStep1(chatId, messageId, userId);

  // 'none' пропускает шаг 2 (нет товара = нет цвета)
  if (type === 'none') {
    await setWizardState(userId, { color: null });
    return showAiStep3(chatId, messageId, userId);
  }

  const typeRu = PRODUCT_TYPES[type]?.ru || type;
  const text = `🎨 <b>AI Студия · шаг 2/3</b>\n\nВыбрано: ${typeRu}\n\nКакой цвет / коллекция?`;
  const kb = Object.entries(COLORS).map(([code, info]) => [
    { text: info.ru, callback_data: `ai:c:${code}` }
  ]);
  kb.push([{ text: '← Назад', callback_data: 'ai:start' }]);
  return editMsg(chatId, messageId, text, kb);
}

async function showAiStep3(chatId, messageId, userId) {
  const st = await getWizardState(userId);
  if (!st) return showAiStep1(chatId, messageId, userId);

  let subjectLine = '';
  if (st.type && st.type !== 'none') {
    const t = PRODUCT_TYPES[st.type]?.ru;
    const c = st.color ? COLORS[st.color]?.ru : '';
    subjectLine = `\nВыбрано: ${c} ${t}\n`;
  } else {
    subjectLine = '\nБез товара — генерим чистый стиль\n';
  }

  const text = `🎨 <b>AI Студия · шаг 3/3</b>${subjectLine}\nСтиль фото:`;
  const kb = Object.entries(STYLES).map(([code, s]) => [
    { text: s.ru, callback_data: `ai:s:${code}` }
  ]);
  kb.push([{ text: '✏️ Свой промпт', callback_data: 'ai:s:custom' }]);
  // Back to step 2 if there was a product, otherwise step 1
  kb.push([{ text: '← Назад', callback_data: st.type === 'none' ? 'ai:start' : `ai:t:${st.type}` }]);
  return editMsg(chatId, messageId, text, kb);
}

async function showAiConfirm(chatId, messageId, userId) {
  const st = await getWizardState(userId);
  if (!st || !st.style) return showAiStep3(chatId, messageId, userId);

  const finalPrompt = buildFinalPrompt(st);
  const previewPrompt = (finalPrompt || '').slice(0, 400);

  const typeLine = (st.type && st.type !== 'none')
    ? `${COLORS[st.color]?.ru || ''} ${PRODUCT_TYPES[st.type]?.ru || ''}`
    : '⏭ Без товара';
  const styleLine = STYLES[st.style]?.ru || (st.style === 'custom' ? '✏️ Свой промпт' : st.style);
  const aspectLine = ASPECTS[st.aspect || '4:5'] || st.aspect;

  const text =
    `🎨 <b>AI Студия · готов!</b>\n\n` +
    `<b>Товар:</b> ${typeLine}\n` +
    `<b>Стиль:</b> ${styleLine}\n` +
    `<b>Формат:</b> ${aspectLine}\n\n` +
    `<b>Превью промпта:</b>\n<code>${escHtml(previewPrompt)}${finalPrompt.length > 400 ? '…' : ''}</code>`;

  const kb = [
    [{ text: '▶ Сгенерировать', callback_data: 'ai:gen' }],
    [{ text: '📐 Сменить формат', callback_data: 'ai:asp' }],
    [{ text: '← Сменить стиль',   callback_data: 'ai:back:style' }],
    [{ text: '🏠 Главное меню',    callback_data: 'menu' }]
  ];
  return editMsg(chatId, messageId, text, kb);
}

async function showAiAspect(chatId, messageId, userId) {
  const st = await getWizardState(userId);
  const cur = st?.aspect || '4:5';
  const text = `🎨 <b>AI Студия · формат</b>\n\nТекущий: <b>${ASPECTS[cur] || cur}</b>\n\nВыбери:`;
  const kb = [];
  const entries = Object.entries(ASPECTS);
  for (let i = 0; i < entries.length; i += 2) {
    const row = [];
    for (let j = 0; j < 2 && i + j < entries.length; j++) {
      const [code, label] = entries[i + j];
      const isCur = code === cur;
      row.push({ text: `${isCur ? '● ' : ''}${label}`, callback_data: `ai:a:${code}` });
    }
    kb.push(row);
  }
  kb.push([{ text: '← Назад', callback_data: 'ai:confirm' }]);
  return editMsg(chatId, messageId, text, kb);
}

async function askForCustomPrompt(chatId, messageId, userId) {
  await setWizardState(userId, { style: 'custom', awaiting_input: 'prompt' });
  const text =
    `✏️ <b>Свой промпт</b>\n\n` +
    `Напиши промпт следующим сообщением (текстом, желательно на английском).\n\n` +
    `Товар и цвет (если выбраны) автоматически добавятся в конец промпта.\n\n` +
    `Пример:\n` +
    `<code>Cinematic streetwear editorial, young man, brutalist Astana, hard side light, 35mm</code>`;
  return editMsg(chatId, messageId, text, [
    [{ text: '← Отменить', callback_data: 'ai:start' }]
  ]);
}

function buildFinalPrompt(st) {
  let basePrompt = '';
  if (st.style === 'custom' && st.custom_text) {
    basePrompt = st.custom_text;
  } else if (STYLES[st.style]) {
    basePrompt = STYLES[st.style].en;
  } else {
    basePrompt = 'editorial portrait';
  }

  const productFrag = productPromptFragment(st.type, st.color);
  if (productFrag) {
    basePrompt = `${basePrompt}, subject ${productFrag}`;
  }
  return basePrompt;
}

async function executeWizardGeneration(chatId, messageId, userId) {
  const st = await getWizardState(userId);
  if (!st) {
    await editMsg(chatId, messageId, '⚠️ Состояние wizard\'а потеряно. Открой AI Студия заново.', backToMenuKb());
    return;
  }
  if (st.style === 'custom' && !st.custom_text) {
    await editMsg(chatId, messageId, '⚠️ Промпт не получен. Открой AI Студия заново.', backToMenuKb());
    await clearWizardState(userId);
    return;
  }

  const fullPrompt = buildFinalPrompt(st);
  const aspect = st.aspect || '4:5';

  // Replace the confirm message with "генерирую..."
  await editMsg(chatId, messageId,
    `🎨 <b>Генерирую…</b>\n\n<code>${escHtml(fullPrompt.slice(0, 300))}${fullPrompt.length > 300 ? '…' : ''}</code>\n\n<i>15–60 сек.</i>`,
    [[{ text: '🏠 Главное меню', callback_data: 'menu' }]]
  );

  // Insert pending row
  let rowId = null;
  if (sb) {
    const { data: row } = await sb.from('ai_generations').insert({
      prompt: fullPrompt, prompt_used: fullPrompt, model: MODEL, aspect,
      elements: [], status: 'submitting',
      telegram_chat_id: chatId, telegram_user_id: Number(userId),
      source: 'telegram'
    }).select('id').single();
    rowId = row?.id || null;
  }

  await sendAction(chatId, 'upload_photo');

  try {
    const jobSet = await higgsfield.subscribe(MODEL, {
      input: { prompt: fullPrompt, aspect_ratio: aspect, safety_tolerance: 2 },
      withPolling: true
    });

    if (jobSet.isCompleted) {
      const url = jobSet.jobs?.[0]?.results?.raw?.url;
      if (url) {
        if (sb && rowId) await sb.from('ai_generations').update({
          job_id: jobSet.id, status: 'completed', result_url: url
        }).eq('id', rowId);
        await sendPhoto(chatId, url, `🚩 ${(STYLES[st.style]?.ru || 'Свой стиль')} · ${ASPECTS[aspect]}`);
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
    if (name === 'NotEnoughCreditsError' || (name === 'AccountError' && /credit/i.test(msgErr)))
      reply = '💳 Кончились кредиты Higgsfield Cloud API.\nhttps://cloud.higgsfield.ai';
    else if (name === 'AuthenticationError') reply = '🔐 Higgsfield auth fail.';
    await sendMsg(chatId, reply);
    if (sb && rowId) await sb.from('ai_generations').update({
      status: 'error', error: `${name}: ${msgErr}`.slice(0, 500)
    }).eq('id', rowId);
  }

  // Clean up wizard state
  await clearWizardState(userId);
  await sendMsg(chatId, '✅ Готово. Можешь сгенерить ещё через /menu → 🎨 AI Студия.', await mainMenuKb());
}

// ════════════════════════════════════════════════════════════════════
//  OTHER SCREENS (menu, admins, etc.)
// ════════════════════════════════════════════════════════════════════

async function showMainMenu(chatId, messageId) {
  const text =
    `🚩 <b>RFC Admin Bot</b>\n\n` +
    `Главное меню. История заказов и генераций общая с админкой redflag.kz.`;
  const kb = await mainMenuKb();
  if (messageId) return editMsg(chatId, messageId, text, kb);
  return sendMsg(chatId, text, kb);
}

// Astana time (UTC+5) — RFC работает в Казахстане, "сегодня" должно считаться
// по местному времени, а не UTC. Vercel functions крутятся в UTC.
const ASTANA_OFFSET_MS = 5 * 3600 * 1000;

function startOfTodayAstana() {
  const nowUtc = new Date();
  const astana = new Date(nowUtc.getTime() + ASTANA_OFFSET_MS);
  astana.setUTCHours(0, 0, 0, 0);
  return new Date(astana.getTime() - ASTANA_OFFSET_MS);
}

async function showStats(chatId, messageId) {
  if (!sb) return editMsg(chatId, messageId, '⚠️ Supabase не подключён', backToMenuKb());

  const todayStart = startOfTodayAstana();
  const weekAgo  = new Date(todayStart.getTime() - 6 * 86400000);   // 7 дней включая сегодня
  const monthAgo = new Date(todayStart.getTime() - 29 * 86400000);  // 30 дней включая сегодня

  // ----- Orders -----
  const { data: ordersData, error: oErr } = await sb.from('rfc_orders')
    .select('id, status, total, created_at')
    .gte('created_at', monthAgo.toISOString());

  const { count: ordersTotalAll } = await sb.from('rfc_orders')
    .select('*', { count: 'exact', head: true });

  // ----- AI generations -----
  const { data: aiData, error: aErr } = await sb.from('ai_generations')
    .select('id, source, status, created_at')
    .gte('created_at', monthAgo.toISOString());

  const { count: aiTotalAll } = await sb.from('ai_generations')
    .select('*', { count: 'exact', head: true });

  // Helpers
  const inRange = (created_at, start) => new Date(created_at) >= start;
  const sumTotals = arr => arr.filter(o => o.status !== 'Отменён')
    .reduce((s, o) => s + (Number(o.total) || 0), 0);

  const orders = ordersData || [];
  const todayO = orders.filter(o => inRange(o.created_at, todayStart));
  const weekO  = orders.filter(o => inRange(o.created_at, weekAgo));
  const monthO = orders;

  const revToday = sumTotals(todayO);
  const revWeek  = sumTotals(weekO);
  const revMonth = sumTotals(monthO);

  // Текущий статусный профиль (на основе последних 30 дней — практично)
  const statusBuckets = {};
  monthO.forEach(o => { statusBuckets[o.status || 'Новый'] = (statusBuckets[o.status || 'Новый'] || 0) + 1; });

  const ai = aiData || [];
  const aiTodayTg  = ai.filter(g => inRange(g.created_at, todayStart) && g.source === 'telegram').length;
  const aiTodayWeb = ai.filter(g => inRange(g.created_at, todayStart) && g.source !== 'telegram').length;
  const aiWeek     = ai.filter(g => inRange(g.created_at, weekAgo)).length;
  const aiMonth    = ai.length;

  const fmtN = n => Number(n || 0).toLocaleString('ru-RU');
  const fmtP = n => '₸' + Number(n || 0).toLocaleString('ru-RU');

  const lines = [];
  lines.push(`📊 <b>Статистика RFC</b>`);
  lines.push(`<i>${fmtDate(new Date())} · Астана</i>`);
  lines.push('');

  // Errors banner if any
  if (oErr || aErr) {
    lines.push(`⚠️ <i>Ошибка чтения: ${escHtml((oErr?.message || aErr?.message || '').slice(0, 100))}</i>`);
    lines.push('');
  }

  lines.push(`📦 <b>Заказы</b>`);
  lines.push(`Сегодня: <b>${fmtN(todayO.length)}</b>`);
  lines.push(`Неделя:  <b>${fmtN(weekO.length)}</b>`);
  lines.push(`Месяц:   <b>${fmtN(monthO.length)}</b>`);
  if (Number.isFinite(ordersTotalAll)) lines.push(`Всего:   <b>${fmtN(ordersTotalAll)}</b>`);
  lines.push('');

  // Status breakdown (за месяц)
  if (Object.keys(statusBuckets).length > 0) {
    lines.push(`📌 <b>По статусам (за 30 дней)</b>`);
    // Сортируем в порядке lifecycle
    const order = ['Новый', 'Связались', 'Оплачен', 'Отправлен', 'Доставлен', 'Отменён'];
    order.forEach(status => {
      const cnt = statusBuckets[status] || 0;
      if (cnt > 0) {
        const ic = STATUS_ICON[status] || '⚪';
        lines.push(`   ${ic} ${status}: <b>${fmtN(cnt)}</b>`);
      }
    });
    lines.push('');
  }

  lines.push(`💰 <b>Выручка</b> <i>(без отменённых)</i>`);
  lines.push(`Сегодня: <b>${fmtP(revToday)}</b>`);
  lines.push(`Неделя:  <b>${fmtP(revWeek)}</b>`);
  lines.push(`Месяц:   <b>${fmtP(revMonth)}</b>`);
  lines.push('');

  lines.push(`🎨 <b>AI-генерации</b>`);
  const todayAiStr = aiTodayTg + aiTodayWeb > 0
    ? `${fmtN(aiTodayTg + aiTodayWeb)} (${fmtN(aiTodayTg)} 📱 + ${fmtN(aiTodayWeb)} 💻)`
    : '0';
  lines.push(`Сегодня: <b>${todayAiStr}</b>`);
  lines.push(`Неделя:  <b>${fmtN(aiWeek)}</b>`);
  lines.push(`Месяц:   <b>${fmtN(aiMonth)}</b>`);
  if (Number.isFinite(aiTotalAll)) lines.push(`Всего:   <b>${fmtN(aiTotalAll)}</b>`);
  lines.push('');

  lines.push(`💳 <b>Higgsfield Cloud</b>`);
  lines.push(`<a href="https://cloud.higgsfield.ai/">Баланс и пополнение →</a>`);

  const kb = [
    [{ text: '🔄 Обновить', callback_data: 'stats' }],
    [{ text: '📦 Заказы', callback_data: 'orders' }, { text: '🏠 Меню', callback_data: 'menu' }]
  ];
  return editMsg(chatId, messageId, lines.join('\n'), kb);
}

async function buildHelpText() {
  return (
    `ℹ️ <b>Помощь</b>\n\n` +
    `<b>Команды:</b>\n` +
    `<code>/start</code>, <code>/menu</code> — главное меню\n` +
    `<code>/help</code> — эта подсказка\n` +
    `<code>/myid</code> — твой Telegram ID\n` +
    `<code>/admin list/add/remove</code> — управление админами (super)\n\n` +
    `<b>Без команды:</b>\n` +
    `Пиши промпт текстом — сгенерю картинку напрямую через Higgsfield.\n` +
    `Или используй 🎨 AI Студия из меню для wizard'а с каталогом одежды.\n\n` +
    `<b>Автоматика:</b>\n` +
    `🔔 Новые заказы с redflag.kz приходят сюда автоматически.`
  );
}

async function showHelpMenu(chatId, messageId) {
  return editMsg(chatId, messageId, await buildHelpText(), backToMenuKb());
}

async function showAdminsMenu(chatId, messageId, userId) {
  const isSuper = await isSuperAdmin(userId);
  const text = `⚙️ <b>Управление админами</b>\n\n` +
    (isSuper ? `Ты <b>super-admin</b>. Можешь добавлять/удалять админов.`
             : `Ты <b>обычный админ</b>.`);
  return editMsg(chatId, messageId, text, adminsMenuKb(isSuper));
}

async function showAdminsList(chatId, messageId) {
  let text = '👀 <b>Список админов</b>\n\n<b>Super-admin:</b>\n';
  text += SUPER_ADMINS.length
    ? SUPER_ADMINS.map(id => `• <code>${id}</code>`).join('\n') + '\n'
    : '<i>пусто</i>\n';
  text += '\n<b>Обычные:</b>\n';
  if (!sb) text += '<i>Supabase не подключён</i>';
  else {
    const { data, error } = await sb.from('tg_admins').select('telegram_user_id, name, username').order('added_at');
    if (error) text += `<i>Ошибка: ${error.message}</i>`;
    else if (!data?.length) text += '<i>пусто. /admin add &lt;id&gt;</i>';
    else text += data.map(a => `• <code>${a.telegram_user_id}</code> · ${a.name || a.username || '—'}`).join('\n');
  }
  return editMsg(chatId, messageId, text, [[{ text: '← Назад', callback_data: 'admins' }]]);
}

async function showAdminsHowto(chatId, messageId) {
  const text =
    `➕ <b>Как добавить админа</b>\n\n` +
    `<code>/admin add 123456789</code>\n\nID узнают через <a href="https://t.me/userinfobot">@userinfobot</a>.\n\n` +
    `С именем: <code>/admin add 123456789 Алина</code>\n` +
    `Удалить: <code>/admin remove 123456789</code>`;
  return editMsg(chatId, messageId, text, [[{ text: '← Назад', callback_data: 'admins' }]]);
}

// ════════════════════════════════════════════════════════════════════
//  TEXT-COMMAND HANDLERS
// ════════════════════════════════════════════════════════════════════

async function handleAdminCommand(chatId, userId, text) {
  const parts = text.trim().split(/\s+/);
  const sub = parts[1] || '', target = parts[2] || '';
  const name = parts.slice(3).join(' ') || null;
  if (sub === 'list' || sub === '') return showAdminsList(chatId, null);
  if (!(await isSuperAdmin(userId))) return sendMsg(chatId, '🔒 Только super-admin.');
  if (!sb) return sendMsg(chatId, '⚠️ Supabase не настроен.');

  if (sub === 'add') {
    if (!/^\d+$/.test(target)) return sendMsg(chatId, 'Использование: <code>/admin add 123456789 [имя]</code>');
    const tid = parseInt(target, 10);
    const { error } = await sb.from('tg_admins').upsert({
      telegram_user_id: tid, name, added_by: Number(userId)
    }, { onConflict: 'telegram_user_id' });
    if (error) return sendMsg(chatId, '❌ ' + error.message);
    return sendMsg(chatId, `✅ Админ <code>${tid}</code>${name ? ' (' + name + ')' : ''} добавлен.`);
  }
  if (sub === 'remove' || sub === 'rm') {
    if (!/^\d+$/.test(target)) return sendMsg(chatId, 'Использование: <code>/admin remove 123456789</code>');
    const tid = parseInt(target, 10);
    if (SUPER_ADMINS.includes(target)) return sendMsg(chatId, '⚠️ Super-admin убирают через Vercel env.');
    const { error } = await sb.from('tg_admins').delete().eq('telegram_user_id', tid);
    if (error) return sendMsg(chatId, '❌ ' + error.message);
    return sendMsg(chatId, `✅ Админ <code>${tid}</code> удалён.`);
  }
  return sendMsg(chatId, 'Подкоманды: <code>list</code>, <code>add &lt;id&gt;</code>, <code>remove &lt;id&gt;</code>');
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
  if (data === 'stats')         return showStats(chatId, messageId);
  if (data === 'help')          return showHelpMenu(chatId, messageId);
  if (data === 'admins')        return showAdminsMenu(chatId, messageId, userId);
  if (data === 'admins:list')   return showAdminsList(chatId, messageId);
  if (data === 'admins:howto')  return showAdminsHowto(chatId, messageId);

  // ── AI Studio wizard ────────────────────────────────────────────
  if (data === 'ai')            return showAiStep1(chatId, messageId, userId);
  if (data === 'ai:start')      return showAiStep1(chatId, messageId, userId);
  if (data.startsWith('ai:t:')) {
    await setWizardState(userId, { type: data.slice(5), color: null, style: null, awaiting_input: null });
    return showAiStep2(chatId, messageId, userId);
  }
  if (data.startsWith('ai:c:')) {
    await setWizardState(userId, { color: data.slice(5), style: null, awaiting_input: null });
    return showAiStep3(chatId, messageId, userId);
  }
  if (data.startsWith('ai:s:')) {
    const style = data.slice(5);
    if (style === 'custom') return askForCustomPrompt(chatId, messageId, userId);
    await setWizardState(userId, { style, awaiting_input: null });
    return showAiConfirm(chatId, messageId, userId);
  }
  if (data === 'ai:back:style') return showAiStep3(chatId, messageId, userId);
  if (data === 'ai:confirm')    return showAiConfirm(chatId, messageId, userId);
  if (data === 'ai:asp')        return showAiAspect(chatId, messageId, userId);
  if (data.startsWith('ai:a:')) {
    await setWizardState(userId, { aspect: data.slice(5) });
    return showAiConfirm(chatId, messageId, userId);
  }
  if (data === 'ai:gen')        return executeWizardGeneration(chatId, messageId, userId);

  return editMsg(chatId, messageId, 'Неизвестная кнопка.', backToMenuKb());
}

// ════════════════════════════════════════════════════════════════════
//  GENERATION FALLBACK (свободный текст без wizard)
// ════════════════════════════════════════════════════════════════════

async function handleFreeGeneration(msg, updateId) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = (msg.text || '').trim();
  const messageId = msg.message_id;
  if (!text) return sendMsg(chatId, 'Пришли промпт текстом или /menu для меню.');
  if (text.length > 4000) return sendMsg(chatId, 'Слишком длинный промпт (макс 4000).');

  if (sb && updateId) {
    const { data: existing } = await sb.from('ai_generations').select('id, status, result_url').eq('telegram_update_id', updateId).maybeSingle();
    if (existing) {
      if (existing.status === 'completed' && existing.result_url)
        await sendPhoto(chatId, existing.result_url, '(дубликат)', messageId);
      return;
    }
  }
  if (!KEY_ID || !KEY_SECRET) return sendMsg(chatId, '⚠️ Higgsfield не настроен.');

  let rowId = null;
  if (sb) {
    const { data: row } = await sb.from('ai_generations').insert({
      prompt: text, prompt_used: text, model: MODEL, aspect: '4:5', elements: [], status: 'submitting',
      telegram_chat_id: chatId, telegram_user_id: userId ? Number(userId) : null,
      telegram_update_id: updateId, source: 'telegram'
    }).select('id').single();
    rowId = row?.id || null;
  }

  await sendAction(chatId, 'upload_photo');
  await sendMsg(chatId, '🎨 Генерирую… 15–60 сек');

  try {
    const jobSet = await higgsfield.subscribe(MODEL, {
      input: { prompt: text, aspect_ratio: '4:5', safety_tolerance: 2 }, withPolling: true
    });
    if (jobSet.isCompleted) {
      const url = jobSet.jobs?.[0]?.results?.raw?.url;
      if (url) {
        if (sb && rowId) await sb.from('ai_generations').update({ job_id: jobSet.id, status: 'completed', result_url: url }).eq('id', rowId);
        await sendPhoto(chatId, url, `🚩 ${text.slice(0, 900)}`, messageId);
      } else await sendMsg(chatId, 'Higgsfield завершил без URL.');
    } else if (jobSet.isFailed) {
      await sendMsg(chatId, '❌ Higgsfield: генерация не удалась');
      if (sb && rowId) await sb.from('ai_generations').update({ status: 'error', error: 'failed' }).eq('id', rowId);
    } else if (jobSet.isNsfw) {
      await sendMsg(chatId, '❌ NSFW. Перефразируй.');
      if (sb && rowId) await sb.from('ai_generations').update({ status: 'error', error: 'nsfw' }).eq('id', rowId);
    }
  } catch (e) {
    const name = e?.name || '';
    const msgErr = e?.message || String(e);
    let reply = `❌ ${msgErr.slice(0, 300)}`;
    if (name === 'NotEnoughCreditsError' || (name === 'AccountError' && /credit/i.test(msgErr)))
      reply = '💳 Кончились кредиты Higgsfield Cloud API.\nhttps://cloud.higgsfield.ai';
    else if (name === 'AuthenticationError') reply = '🔐 Higgsfield auth fail.';
    await sendMsg(chatId, reply);
    if (sb && rowId) await sb.from('ai_generations').update({ status: 'error', error: `${name}: ${msgErr}`.slice(0, 500) }).eq('id', rowId);
  }
}

// Wizard-driven generation completion: пользователь прислал custom prompt в режиме awaiting_input='prompt'
async function completeWizardWithCustomPrompt(chatId, userId, text, updateId) {
  await setWizardState(userId, { custom_text: text.slice(0, 2000), awaiting_input: null });
  await sendMsg(chatId, '✅ Промпт принят. Показываю превью…');
  // Send a fresh confirm message (no messageId since this isn't from a button click)
  const st = await getWizardState(userId);
  const finalPrompt = buildFinalPrompt(st);
  const typeLine = (st.type && st.type !== 'none')
    ? `${COLORS[st.color]?.ru || ''} ${PRODUCT_TYPES[st.type]?.ru || ''}` : '⏭ Без товара';
  const previewText =
    `🎨 <b>AI Студия · готов!</b>\n\n` +
    `<b>Товар:</b> ${typeLine}\n` +
    `<b>Стиль:</b> ✏️ Свой промпт\n` +
    `<b>Формат:</b> ${ASPECTS[st.aspect || '4:5']}\n\n` +
    `<b>Превью промпта:</b>\n<code>${escHtml(finalPrompt.slice(0, 400))}${finalPrompt.length > 400 ? '…' : ''}</code>`;
  const kb = [
    [{ text: '▶ Сгенерировать', callback_data: 'ai:gen' }],
    [{ text: '📐 Сменить формат', callback_data: 'ai:asp' }],
    [{ text: '✏️ Переписать промпт', callback_data: 'ai:s:custom' }],
    [{ text: '🏠 Главное меню', callback_data: 'menu' }]
  ];
  return sendMsg(chatId, previewText, kb);
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

    if (!(await isAdmin(userId))) {
      await ackCallback(cb.id, '🔒 Доступ закрыт', true);
      return res.status(200).send('OK');
    }

    // Status change — special ack
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
      await ackCallback(cb.id, result.ok ? `✅ Статус → ${newStatus}` : `❌ ${result.error || 'Ошибка'}`, !result.ok);
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
    await sendMsg(chatId, `Твой ID: <code>${userId}</code>\n\nПопроси super-admin:\n<code>/admin add ${userId}</code>`);
    return res.status(200).send('OK');
  }

  if (!(await isAdmin(userId))) {
    await sendMsg(chatId, `🔒 <b>Доступ закрыт</b>\n\nТвой ID: <code>${userId}</code>\nПопроси super-admin: <code>/admin add ${userId}</code>`);
    return res.status(200).send('OK');
  }

  // Команды
  if (text === '/start' || text === '/menu') {
    await clearWizardState(userId);  // на старт меню — чистим wizard
    await showMainMenu(chatId);
    return res.status(200).send('OK');
  }
  if (text === '/help') {
    await sendMsg(chatId, await buildHelpText(), await mainMenuKb());
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

  // Wizard awaiting custom prompt?
  const wstate = await getWizardState(userId);
  if (wstate?.awaiting_input === 'prompt') {
    await completeWizardWithCustomPrompt(chatId, userId, text, updateId);
    return res.status(200).send('OK');
  }

  // Свободный текст → старый flow (генерация напрямую)
  await handleFreeGeneration(msg, updateId);
  return res.status(200).send('OK');
}
