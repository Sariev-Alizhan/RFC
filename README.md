# RFC — Red Flag Community

Интернет-магазин мерча. Один статический файл `index.html` (HTML/CSS/JS, фото вшиты внутрь).
Заказы уходят в **WhatsApp** и сохраняются в **облачную CRM** (Supabase). Хостинг — **Vercel**.

---

## 1. Перед публикацией — впиши свои данные

Открой `index.html`, в самом начале блока `<script>` найди `var SHOP = {...}` и замени:

```js
var SHOP={
  wa:"77000000000",            // ← твой WhatsApp: код страны + номер, без + и пробелов. Пример: 77011234567
  email:"hello@redflag.kz",    // ← почта магазина
  ig:"redflagseverywear",      // уже стоит
  city:"Астана", country:"Казахстан"
};
```

Без правильного `wa` кнопка «Оформить через WhatsApp» откроется на пустой номер.

---

## 2. GitHub — сохранить код

В папке с файлами (`index.html`, `README.md`, `supabase.sql`, `.gitignore`):

```bash
git init
git add .
git commit -m "RFC store"
git branch -M main
git remote add origin https://github.com/Sariev-Alizhan/RFC.git
git push -u origin main
```

> При `push` GitHub попросит логин/токен — вводишь сам. Если просит пароль, нужен Personal Access Token (GitHub → Settings → Developer settings → Tokens).

---

## 3. Vercel — выложить сайт (бесплатно)

1. Зайди на **vercel.com** → войти через GitHub.
2. **Add New → Project → Import** репозиторий `Sariev-Alizhan/RFC`.
3. Framework Preset: **Other** (ничего настраивать не надо, это статика).
4. **Deploy**. Через ~30 сек получишь ссылку вида `rfc.vercel.app`.

Дальше любой `git push` будет автоматически обновлять сайт.

---

## 4. Supabase — облачная CRM (заказы со всех устройств в одном месте)

1. На **supabase.com** → New project (запомни пароль БД, он не нужен для сайта).
2. **SQL Editor → New query** → вставь содержимое `supabase.sql` → **Run**.
3. **Authentication → Users → Add user** → создай админский email + пароль (этим входишь в CRM).
4. **Project Settings → API** → скопируй:
   - **Project URL**
   - **anon public** ключ (он публичный, его можно держать в коде)
5. В `index.html` найди блок и вставь оба значения:

```js
var SB_URL="https://xxxx.supabase.co";   // Project URL
var SB_KEY="eyJhbGci...";                 // anon public key
```

6. `git add . && git commit -m "supabase" && git push` → Vercel обновит сайт сам.

Готово: заказы клиентов падают в Supabase, в CRM ты видишь их с любого устройства после входа.

---

## Как открыть CRM

- Внизу сайта ссылка **«Админ · CRM»**, в меню — то же самое, или адрес `https-твой-сайт/#admin`.
- Если Supabase подключён — попросит email/пароль админа (из шага 4.3).
- Видно: имя, телефон, email, адрес, комментарий, товары, сумму. Кнопки **WhatsApp** и **Почта** пишут клиенту, статусы: Новый → Связались → Оплачен → Отправлен → Доставлен.

## Доставка
По Казахстану 1–2 дня · по миру от недели · самовывоз — Астана.

## Без Supabase
Если ключи Supabase не вписаны — сайт всё равно работает: заказы уходят в WhatsApp, CRM хранит их локально в браузере (без синхронизации между устройствами).

## Безопасность
- `anon` ключ — публичный, безопасен для клиентского кода.
- Заказы клиентов (телефон/адрес) читает только вошедший админ — настроено политиками в `supabase.sql`.
- Оплата внутри сайта не проводится: связь и оплата — через WhatsApp.
