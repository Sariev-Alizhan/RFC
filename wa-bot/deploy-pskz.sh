#!/bin/bash
# Обновление RFC-бота на сервере ps.kz (194.238.42.2, контейнер rfc-wa-bot).
# Запуск с ноута:  bash wa-bot/deploy-pskz.sh
# Сессия WhatsApp и данные живут в ~/rfc-wa-bot/data на сервере — их скрипт не трогает.
set -e
KEY="$HOME/.ssh/fibodent_deploy"
HOST="ubuntu@194.238.42.2"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "→ Заливаю код…"
rsync -az --exclude node_modules --exclude auth --exclude "*.log" --exclude qr.png \
  --exclude night-contacts.json --exclude lid-map.json --exclude .env \
  -e "ssh -i $KEY -o BatchMode=yes" "$DIR/" "$HOST":~/rfc-wa-bot/app/

echo "→ Пересобираю и перезапускаю контейнер…"
ssh -i "$KEY" -o BatchMode=yes "$HOST" '
  cd ~/rfc-wa-bot/app && docker build -q -t rfc-wa-bot . &&
  docker rm -f rfc-wa-bot >/dev/null 2>&1 || true
  docker run -d --name rfc-wa-bot --restart unless-stopped \
    --env-file ~/rfc-wa-bot/app/.env -e TZ=Asia/Almaty \
    -v ~/rfc-wa-bot/data/auth:/app/auth \
    -v ~/rfc-wa-bot/data/lid-map.json:/app/lid-map.json \
    -v ~/rfc-wa-bot/data/night-contacts.json:/app/night-contacts.json \
    -p 127.0.0.1:8099:8099 rfc-wa-bot >/dev/null
  sleep 10 && docker logs rfc-wa-bot 2>&1 | tail -6'

echo "✓ Готово. Логи: ssh -i $KEY $HOST 'docker logs -f rfc-wa-bot'"
# Если понадобится QR (перепривязка): ssh -i $KEY -L 8099:localhost:8099 $HOST
# и открой http://localhost:8099/?key=<QR_KEY из .env на сервере>
