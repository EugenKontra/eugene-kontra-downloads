# Развёртывание, обновление, резервное копирование

## Вариант A — Oracle Cloud Always Free (0 €, работает без вашего компьютера)
1. Зарегистрируйтесь на https://www.oracle.com/cloud/free/ (карта нужна только для проверки; не переходите на Pay As You Go, если не хотите платных ресурсов).
2. Создайте ВМ: образ Ubuntu 24.04, форма **VM.Standard.A1.Flex** (например 2 OCPU / 12 ГБ), диск 100–200 ГБ. Если «Out of capacity» — попробуйте другой Availability Domain или позже.
3. На ВМ:
   ```bash
   sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
   git clone https://github.com/<вы>/eugene-kontra-downloads.git && cd eugene-kontra-downloads/creator-publish-hub
   cp .env.example .env && nano .env      # заполнить
   ```
4. **HTTPS через Cloudflare Tunnel** (бесплатно, нужен домен в Cloudflare): Zero Trust → Networks → Tunnels → Create → Cloudflared → скопируйте токен в `CLOUDFLARE_TUNNEL_TOKEN`; Public hostname `hub.ваш-домен` → Service `http://web:3000`. В `.env`: `PUBLIC_BASE_URL=https://hub.ваш-домен`.
   В Cloudflare для этого хоста отключите кэширование (Cache Rule: Bypass) — видео и API не должны кэшироваться.
5. Запуск: `docker compose --profile tunnel up -d --build`. Проверка: `https://hub.ваш-домен/api/health`.

## Вариант B — домашний ПК / мини-ПК / NAS
То же самое (Docker + Tunnel). Публикации идут, только пока устройство включено.

## Ограничения бесплатной инфраструктуры
* Загрузка из браузера идёт частями по 8 МБ (лимит Cloudflare на запрос — 100 МБ), возобновляется после обрыва.
* Хранение видео — на диске ВМ (до 200 ГБ). Удаляйте опубликованные файлы в редакторе публикации.
* Исходящий трафик Oracle — 10 ТБ/мес, Cloudflare Tunnel — без оплаты за трафик.
* Один экземпляр воркера (очередь рассчитана на это); параллельно до 2 задач (`WORKER_CONCURRENCY`).
* Квоты платформ (см. README) от инфраструктуры не зависят.

## Обновление
```bash
cd eugene-kontra-downloads && git pull
cd creator-publish-hub && docker compose --profile tunnel up -d --build
```
Миграции базы применяются автоматически при старте. Незавершённые задачи продолжаются после перезапуска (YouTube — с того же байта).

## Резервное копирование
```bash
docker compose exec web npx tsx scripts/backup.ts /data/backups   # согласованная копия SQLite «на лету»
docker compose cp web:/data/backups ./backups
```
Храните отдельно **`.env`** (особенно `ENCRYPTION_KEY` — без него сохранённые токены не расшифровать; в худшем случае просто переподключите аккаунты). Видеофайлы (`/data/videos`) в копию не входят — это ваши исходники.
Восстановление: остановите контейнеры, положите файл копии как `/data/hub.db`, запустите.
