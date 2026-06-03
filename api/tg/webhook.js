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
    return r.json().catch(() => null);
  } catch (e) {
    console.error(`TG ${method} failed:`, e.message);
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
//  AUTH — super_admin (env) OR обычный admin (tg_admins table)
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
//  INLINE KEYBOARDS
// ════════════════════════════════════════════════════════════════════

const mainMenuKb = () => [
  [{ text: '📦 Заказы 🚧', callback_data: 'orders' }],
  [
    { text: '🎨 AI Студия',    callback_data: 'ai' },
    { text: '📊 Стата 🚧',     callback_data: 'stats' }
  ],
  [
    { text: '⚙️ Админы',        callback_data: 'admins' },
    { text: 'ℹ️ Помощь',         callback_data: 'help' }
  ]
];

const backToMenuKb = () => [
  [{ text: '← Главное меню', callback_data: 'menu' }]
];

const adminsMenuKb = (isSuper) => {
  const kb = [
    [{ text: '👀 Список админов', callback_data: 'admins:list' }]
  ];
  if (isSuper) {
    kb.push([{ text: '➕ Как добавить', callback_data: 'admins:howto' }]);
  }
  kb.push([{ text: '← Главное меню', callback_data: 'menu' }]);
  return kb;
};

// ════════════════════════════════════════════════════════════════════
//  SCREEN RENDERERS
// ════════════════════════════════════════════════════════════════════

async function showMainMenu(chatId, messageId) {
  const text =
    `🚩 <b>RFC Admin Bot</b>\n\n` +
    `Выбери раздел кнопкой ниже. История генераций и заказов общая — между ботом и админкой redflag.kz.\n\n` +
    `<i>В фазе 6A работает: меню, управление админами, и текст→картинка (как раньше).\nЗаказы в реальном времени — фаза 6B/6C.</i>`;
  if (messageId) return editMsg(chatId, messageId, text, mainMenuKb());
  return sendMsg(chatId, text, mainMenuKb());
}

async function showStub(chatId, messageId, slug) {
  const titles = { orders: '📦 Заказы', stats: '📊 Статистика' };
  const text =
    `${titles[slug] || slug}\n\n` +
    `🚧 <b>Скоро</b>\n\n` +
    `Эта секция строится в следующих фазах:\n` +
    `• <b>6B</b> — пуш-уведомления о новых заказах\n` +
    `• <b>6C</b> — просмотр + кнопки статусов\n` +
    `• <b>6E</b> — дневная/недельная статистика`;
  return editMsg(chatId, messageId, text, backToMenuKb());
}

async function showAiMenu(chatId, messageId) {
  const text =
    `🎨 <b>AI Студия</b>\n\n` +
    `<b>Простой режим (работает):</b>\nПросто пришли в чат английский промпт — сгенерю картинку через Higgsfield.\n\n` +
    `<b>Полный режим с каталогом одежды</b> — фаза 6D.\n\n` +
    `Пример промпта:\n<code>Cinematic streetwear editorial, young Kazakh man in black tee, brutalist concrete wall in Astana, hard side light, 35mm</code>`;
  return editMsg(chatId, messageId, text, backToMenuKb());
}

async function showHelpMenu(chatId, messageId) {
  const text = await buildHelpText();
  return editMsg(chatId, messageId, text, backToMenuKb());
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
    `Пиши промпт текстом — я сгенерю картинку.`
  );
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
  let text = '👀 <b>Список админов</b>\n\n';
  text += '<b>Super-admin (через Vercel env):</b>\n';
  if (SUPER_ADMINS.length === 0) {
    text += '<i>пусто — выставь TELEGRAM_ADMIN_IDS в Vercel</i>\n';
  } else {
    text += SUPER_ADMINS.map(id => `• <code>${id}</code>`).join('\n') + '\n';
  }
  text += '\n<b>Обычные админы (Supabase tg_admins):</b>\n';
  if (!sb) {
    text += '<i>Supabase не подключён</i>';
  } else {
    const { data, error } = await sb.from('tg_admins')
      .select('telegram_user_id, name, username, added_at')
      .order('added_at', { ascending: true });
    if (error) {
      text += `<i>Ошибка: ${error.message}</i>`;
    } else if (!data || data.length === 0) {
      text += '<i>пусто. Добавь через /admin add &lt;id&gt;</i>';
    } else {
      text += data.map(a => {
        const name = a.name || a.username || '—';
        return `• <code>${a.telegram_user_id}</code> · ${name}`;
      }).join('\n');
    }
  }
  return editMsg(chatId, messageId, text, [
    [{ text: '← Назад', callback_data: 'admins' }]
  ]);
}

async function showAdminsHowto(chatId, messageId) {
  const text =
    `➕ <b>Как добавить админа</b>\n\n` +
    `Текстовая команда (только super-admin):\n\n` +
    `<code>/admin add 123456789</code>\n\n` +
    `где <code>123456789</code> — Telegram user ID нового админа.\n\n` +
    `Его узнают через <a href="https://t.me/userinfobot">@userinfobot</a> (нажать Start, бот пришлёт ID).\n\n` +
    `Опционально с именем:\n` +
    `<code>/admin add 123456789 Алина</code>\n\n` +
    `Удалить:\n` +
    `<code>/admin remove 123456789</code>`;
  return editMsg(chatId, messageId, text, [
    [{ text: '← Назад', callback_data: 'admins' }]
  ]);
}

// ════════════════════════════════════════════════════════════════════
//  TEXT-COMMAND HANDLERS  (/admin add/remove/list)
// ════════════════════════════════════════════════════════════════════

async function handleAdminCommand(chatId, userId, text) {
  const parts = text.trim().split(/\s+/);
  const sub = parts[1] || '';
  const target = parts[2] || '';
  const name = parts.slice(3).join(' ') || null;

  if (sub === 'list' || sub === '') {
    return showAdminsList(chatId, null);
  }

  if (!(await isSuperAdmin(userId))) {
    return sendMsg(chatId, '🔒 Только super-admin может добавлять/удалять.');
  }

  if (!sb) {
    return sendMsg(chatId, '⚠️ Supabase не настроен.');
  }

  if (sub === 'add') {
    if (!/^\d+$/.test(target)) {
      return sendMsg(chatId, 'Использование:\n<code>/admin add 123456789 [имя]</code>');
    }
    const tid = parseInt(target, 10);
    const { error } = await sb.from('tg_admins').upsert({
      telegram_user_id: tid,
      name: name,
      added_by: Number(userId)
    }, { onConflict: 'telegram_user_id' });
    if (error) return sendMsg(chatId, '❌ Ошибка: ' + error.message);
    return sendMsg(chatId, `✅ Админ <code>${tid}</code>${name ? ' (' + name + ')' : ''} добавлен.`);
  }

  if (sub === 'remove' || sub === 'rm') {
    if (!/^\d+$/.test(target)) {
      return sendMsg(chatId, 'Использование:\n<code>/admin remove 123456789</code>');
    }
    const tid = parseInt(target, 10);
    if (SUPER_ADMINS.includes(target)) {
      return sendMsg(chatId, '⚠️ Это super-admin, его убирают только через Vercel env vars.');
    }
    const { error } = await sb.from('tg_admins').delete().eq('telegram_user_id', tid);
    if (error) return sendMsg(chatId, '❌ Ошибка: ' + error.message);
    return sendMsg(chatId, `✅ Админ <code>${tid}</code> удалён.`);
  }

  return sendMsg(chatId, 'Подкоманды:\n<code>list</code> · <code>add &lt;id&gt; [имя]</code> · <code>remove &lt;id&gt;</code>');
}

// ════════════════════════════════════════════════════════════════════
//  CALLBACK ROUTER  (когда жмут inline-кнопку)
// ════════════════════════════════════════════════════════════════════

async function routeCallback(cb) {
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const userId = cb.from.id;
  const data = cb.data || '';

  if (data === 'menu')           return showMainMenu(chatId, messageId);
  if (data === 'orders')         return showStub(chatId, messageId, 'orders');
  if (data === 'stats')          return showStub(chatId, messageId, 'stats');
  if (data === 'ai')             return showAiMenu(chatId, messageId);
  if (data === 'help')           return showHelpMenu(chatId, messageId);
  if (data === 'admins')         return showAdminsMenu(chatId, messageId, userId);
  if (data === 'admins:list')    return showAdminsList(chatId, messageId);
  if (data === 'admins:howto')   return showAdminsHowto(chatId, messageId);

  return editMsg(chatId, messageId, 'Неизвестная кнопка.', backToMenuKb());
}

// ════════════════════════════════════════════════════════════════════
//  GENERATION (текст → картинка, fallback из Фазы 5)
// ════════════════════════════════════════════════════════════════════

async function handleGeneration(msg, updateId) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = (msg.text || '').trim();
  const messageId = msg.message_id;

  if (!text) {
    await sendMsg(chatId, 'Пришли промпт текстом или /menu для меню.');
    return;
  }

  if (text.length > 4000) {
    await sendMsg(chatId, 'Слишком длинный промпт (макс 4000).');
    return;
  }

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

  if (!KEY_ID || !KEY_SECRET) {
    await sendMsg(chatId, '⚠️ Higgsfield не настроен в Vercel.');
    return;
  }

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
        if (sb && rowId) {
          await sb.from('ai_generations').update({
            job_id: jobSet.id, status: 'completed', result_url: url
          }).eq('id', rowId);
        }
        await sendPhoto(chatId, url, `🚩 ${text.slice(0, 900)}`, messageId);
      } else {
        await sendMsg(chatId, 'Higgsfield завершил без URL. Попробуй ещё раз.');
      }
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
      reply = '💳 Кончились кредиты Higgsfield Cloud API.\nПополни на https://cloud.higgsfield.ai';
    } else if (name === 'AuthenticationError') {
      reply = '🔐 Higgsfield auth fail — проверь KEY_ID/SECRET в Vercel.';
    }
    await sendMsg(chatId, reply);
    if (sb && rowId) {
      await sb.from('ai_generations').update({
        status: 'error', error: `${name}: ${msgErr}`.slice(0, 500)
      }).eq('id', rowId);
    }
  }
}

// ════════════════════════════════════════════════════════════════════
//  MAIN HANDLER — точка входа из Telegram webhook
// ════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');
  if (!BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not configured');
    return res.status(200).send('OK');
  }

  const update = req.body || {};

  // ── 1. CALLBACK QUERY (нажата inline-кнопка) ────────────────────
  if (update.callback_query) {
    const cb = update.callback_query;
    const userId = cb.from?.id;

    if (!(await isAdmin(userId))) {
      await ackCallback(cb.id, '🔒 Доступ закрыт', true);
      return res.status(200).send('OK');
    }

    await ackCallback(cb.id);
    try {
      await routeCallback(cb);
    } catch (e) {
      console.error('routeCallback failed:', e.message);
    }
    return res.status(200).send('OK');
  }

  // ── 2. TEXT MESSAGE ──────────────────────────────────────────────
  const msg = update.message;
  if (!msg) return res.status(200).send('OK');

  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const text = (msg.text || '').trim();
  const updateId = update.update_id;

  if (!chatId) return res.status(200).send('OK');

  // /myid доступна всем — чтобы человек узнал свой ID до того как стал админом
  if (text === '/myid') {
    await sendMsg(chatId,
      `Твой Telegram ID:\n<code>${userId}</code>\n\n` +
      `Если ты не админ — попроси super-admin выполнить:\n` +
      `<code>/admin add ${userId}</code>`);
    return res.status(200).send('OK');
  }

  // Auth gate
  if (!(await isAdmin(userId))) {
    await sendMsg(chatId,
      `🔒 <b>Доступ закрыт</b>\n\n` +
      `Этот бот только для админов RFC.\n\n` +
      `Твой ID: <code>${userId}</code>\n\n` +
      `Чтобы получить доступ — попроси super-admin RFC выполнить:\n` +
      `<code>/admin add ${userId}</code>`);
    return res.status(200).send('OK');
  }

  // Команды
  if (text === '/start' || text === '/menu') {
    await showMainMenu(chatId);
    return res.status(200).send('OK');
  }
  if (text === '/help') {
    const txt = await buildHelpText();
    await sendMsg(chatId, txt, mainMenuKb());
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

  // Plain text → генерация (fallback из Фазы 5, работает как раньше)
  await handleGeneration(msg, updateId);
  return res.status(200).send('OK');
}
