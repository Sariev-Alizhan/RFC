# Перенос бота на сервер (24/7)

Сейчас бот живёт на ноуте под pm2. Минус: ноут выключился/разрядился → бот офлайн
(ночной автоответ не работает, ответы из CRM копятся в очереди до включения).
Ниже два варианта переноса. После переноса **обязательно** останови бота на ноуте
(см. последний раздел) — иначе два бота будут отвечать клиентам дважды.

## Что понадобится (env-переменные)

Значения возьми из `wa-bot/.env` на ноуте (файл не в git):

| Переменная | Что это |
|---|---|
| `CLAUDE_API_KEY` | ключ Anthropic для AI-ответов |
| `CLAUDE_MODEL` | `claude-haiku-4-5-20251001` |
| `WA_BOT_SECRET` | общий секрет с сервером redflag.kz |
| `NOTIFY_URL` | `https://redflag.kz/api/tg/notify-order` (можно не задавать — это дефолт) |
| `ORDER_URL` | `https://redflag.kz/api/orders/create` (дефолт) |
| `WA_SKIP_HISTORY` | `1` — НЕ импортировать историю чатов при перепривязке (история уже в CRM, без флага будут дубли) |
| `QR_KEY` | любой случайный пароль — на сервере страница QR будет требовать `?key=<QR_KEY>` в адресе (иначе pairing-QR открыт всем и аккаунт могут увести) |

## Вариант A — Railway (проще, ~$5/мес)

1. railway.app → New Project → **Deploy from GitHub repo** → выбери репозиторий `RFC`.
2. В настройках сервиса: **Root Directory** = `wa-bot` (Railway сам найдёт Dockerfile).
3. **Variables** → добавь переменные из таблицы выше (включая `WA_SKIP_HISTORY=1`).
4. **Volume**: Add Volume → mount path `/app/auth` (это сессия WhatsApp — чтобы не сканировать QR после каждого рестарта).
5. **Settings → Networking → Generate Domain** — получишь URL вида `xxx.up.railway.app`.
6. Открой `https://xxx.up.railway.app/?key=<твой QR_KEY>` — там живой QR. Отсканируй телефоном с номера 77475749420 (WhatsApp → Связанные устройства → Привязка устройства).
7. В логах Railway появится «✅ Подключено!» — готово.

## Вариант B — VPS (любой Ubuntu, полный контроль)

```bash
# на сервере
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs
git clone https://github.com/Sariev-Alizhan/RFC.git && cd RFC/wa-bot
npm ci --omit=dev
# перенеси .env с ноута:  scp wa-bot/.env user@server:~/RFC/wa-bot/.env
# добавь в .env строку:   WA_SKIP_HISTORY=1
# (опционально) перенеси сессию, чтобы не сканировать QR заново:
#   scp -r wa-bot/auth user@server:~/RFC/wa-bot/auth
sudo npm i -g pm2
pm2 start index.js --name rfc-wa && pm2 save && pm2 startup   # автозапуск после ребута
pm2 logs rfc-wa   # если QR нужен: ssh -L 8099:localhost:8099 user@server → http://localhost:8099
```

## После переноса — остановить бота на ноуте

```bash
pm2 delete rfc-wa rfc-keepawake && pm2 save
```

И удали LaunchAgent автозапуска (иначе поднимется после перезагрузки):

```bash
launchctl unload ~/Library/LaunchAgents/com.rfc.pm2.plist
rm ~/Library/LaunchAgents/com.rfc.pm2.plist
```

## Проверка, что всё работает

1. Напиши боту с другого номера — должен ответить.
2. Ответь из CRM (redflag.kz/#admin → WhatsApp) — сообщение должно дойти.
3. В логах сервера: «📤 Ответ из CRM отправлен».
