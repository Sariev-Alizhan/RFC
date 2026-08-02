// === Данные магазина RFC (Red Flag Community) ===
// Синхронизировано с index.html → SHOP / TYPES / SIZES. Меняй здесь при обновлении цен/товаров.

export const SHOP = {
  brand: "RFC — Red Flag Community",
  wa: "77475749420",
  site: "redflag.kz",
  ig: "redflagseverywear",
  city: "Астана",
  country: "Казахстан",
  kaspiLink: "https://pay.kaspi.kz/pay/yszmgt89",
};

// Товары. key — для распознавания в тексте, price — в тенге (₸).
// selling:false = НЕ продаём сейчас (предзаказ/скоро) — бот такое не предлагает,
// а при вопросе говорит статус и направляет на менеджера. Синхронизировано с
// isSoon/isPreorder в index.html (hoodie=предзаказ, sweat/boxers=скоро).
export const PRODUCTS = [
  { key: "tee",     name: 'Футболка "RFC"',               price: 23000, sized: true,  selling: true,  match: ["футболк", "майк", "tee", "t-shirt", "шведк"] },
  { key: "cap",     name: 'Кепка "RFC Logo"',             price: 15000, sized: false, selling: true,  match: ["кепк", "cap", "бейсболк"] },
  { key: "hoodie",  name: 'Худи "Red Flag Community"',    price: 29000, sized: true,  selling: false, status: "открываем предзаказ", match: ["худи", "hoodie", "толстовк"] },
  { key: "sweat",   name: 'Свитшот "Red Flag Community"', price: 29000, sized: true,  selling: false, status: "открываем предзаказ", match: ["свитшот", "sweat", "кофт"] },
  { key: "boxers",  name: 'Трусы "Red Flag Community"',   price: 29000, sized: true,  selling: false, status: "появятся совсем скоро", match: ["трус", "боксер", "белье", "бельё", "boxers", "носк"] },
];
export const SELLING = PRODUCTS.filter((p) => p.selling);

// Ответ на интерес к товару, которого ещё нет в продаже
export function notSellingReply(p) {
  return `${p.name} — пока не в продаже, ${p.status} 🔜\nМогу соединить с менеджером — он расскажет детали и запишет вас одним из первых. Напишите *менеджер*.`;
}

export const SIZES = ["S", "M", "L", "XL", "XXL"];

export const fmt = (n) => n.toLocaleString("ru-RU").replace(/,/g, " ") + " ₸";

// Находит товар по свободному тексту пользователя
export function findProduct(text) {
  const t = (text || "").toLowerCase();
  return PRODUCTS.find((p) => p.match.some((m) => t.includes(m))) || null;
}

// === Готовые текстовые блоки (сценарная часть) ===

export const T = {
  welcome:
    `Здравствуйте 🚩 Это *${SHOP.brand}* — локальный streetwear-бренд из Казахстана.\n\n` +
    `Я на связи, помогу с выбором и всё подскажу. По оформлению — соединю с нашим менеджером, он подберёт под вас.\n\n` +
    `• *Каталог* — товары и цены\n` +
    `• *Размеры* — помогу подобрать\n` +
    `• *Доставка* · *Оплата*\n` +
    `• *Менеджер* — связать с живым человеком\n\n` +
    `Сайт: ${SHOP.site}`,

  catalog:
    `*Каталог ${SHOP.brand}* 🚩\n\n` +
    PRODUCTS.filter((p) => p.selling).map((p) => `• ${p.name} — *${fmt(p.price)}*`).join("\n") +
    `\n\nХуди и свитшот — открываем предзаказ, скоро 🔜\n` +
    `Все фото, цвета и коллекции — на сайте:\n${SHOP.site}\n\n` +
    `Понравилось что-то? Напишите *менеджер* — подберём размер и оформим.`,

  sizes:
    `*Размеры:* S, M, L, XL, XXL (кепка — универсальный).\n\n` +
    `Ориентир по росту:\n` +
    `S — 165–170 · M — 165–175 · L — 170–180 · XL — 175–185 · XXL — 180–185 см\n\n` +
    `Напишите свой рост и вес — помогу подобрать. Полная таблица на сайте: ${SHOP.site}`,

  delivery:
    `*Доставка:*\n` +
    `• По Казахстану — курьер, 1–2 дня\n` +
    `• Международная — от 7 дней\n` +
    `• Самовывоз — ${SHOP.city}, по согласованию\n\n` +
    `Трек-номер пришлём после отправки. Детали уточнит менеджер.`,

  payment:
    `*Оплата:* Kaspi после подтверждения заказа менеджером.\n` +
    `Kaspi: ${SHOP.kaspiLink}\n` +
    `Можно и переводом по номеру — реквизиты пришлёт менеджер.`,

  socials: `Instagram: instagram.com/${SHOP.ig}\nСайт: ${SHOP.site}`,

  human:
    `Соединяю с менеджером 🚩 Он ответит здесь в ближайшее время и всё оформит.\n` +
    `(Я пока не мешаю в этом чате.)`,

  orderToManager:
    `Отличный выбор 🚩 Передаю менеджеру — он подтвердит наличие, поможет с размером и оформит. Напишет вам здесь совсем скоро.`,

  fallbackNoAI:
    `Могу помочь с этим:\n` +
    `• *Каталог* · *Размеры* · *Доставка* · *Оплата*\n` +
    `А по покупке лучше напишите *менеджер* — соединю с живым человеком, он подберёт и оформит.`,
};
