# Подключение платформ

Во всех случаях **Redirect URI** = `PUBLIC_BASE_URL/api/oauth/<platform>/callback` (точный адрес показан на странице «Аккаунты»).
Пароли соцсетей вы вводите только на сайте платформы.

## YouTube
1. https://console.cloud.google.com → создайте проект → **APIs & Services → Library** → включите **YouTube Data API v3**.
2. **OAuth consent screen**: тип *External*, добавьте свой Google-аккаунт в *Test users*, области `youtube.upload` и `youtube.readonly`.
3. **Важно:** нажмите **Publish app → In production**. В режиме *Testing* refresh-токен истекает через 7 дней. Для личного использования проверку Google проходить не обязательно — при входе будет предупреждение «приложение не проверено» → «Дополнительно → перейти».
4. **Credentials → Create OAuth client ID → Web application**, Authorized redirect URI: `https://ВАШ-АДРЕС/api/oauth/youtube/callback`.
5. Впишите `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` в `.env`, перезапустите, нажмите «Подключить» у YouTube и выберите нужный канал (для RU и DE — по отдельности; бренд-аккаунт выбирается на экране Google).
* Квота: 100 загрузок видео в сутки на проект. Своя обложка — только у канала, подтверждённого по телефону (youtube.com/verify).
* Shorts: вертикальное или квадратное видео до 3 минут — YouTube сам отнесёт его к Shorts.

## Instagram (Reels)
Требуется **профессиональный** аккаунт Instagram (Business или Creator; переключается в настройках приложения бесплатно). Страница Facebook не нужна.
1. https://developers.facebook.com → **Create app** → тип *Business* → добавьте продукт **Instagram → API setup with Instagram login**.
2. В разделе *Instagram business login* укажите Redirect URL `https://ВАШ-АДРЕС/api/oauth/instagram/callback`.
3. **App roles → Roles → Instagram testers**: добавьте свой Instagram-аккаунт и примите приглашение в Instagram (Настройки → Приложения и сайты → Приглашения тестировщика).
4. Скопируйте *Instagram app ID* и *Instagram app secret* в `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`.
5. В режиме разработки (без App Review) публикация работает для аккаунтов с ролью в приложении — для личного инструмента этого достаточно.
* Панель должна быть доступна из интернета по HTTPS: Instagram скачивает видео по временной подписанной ссылке `/api/media/...` (действует 6 часов).
* Лимит 100 публикаций за 24 часа. Метку «Оплачено партнёром» API не ставит — добавьте вручную.
* Токен живёт 60 дней и продлевается панелью автоматически при публикациях; если не публиковать > 60 дней — переподключите.

## TikTok
1. https://developers.tiktok.com → **Manage apps → Connect an app**. Заполните описание, иконку, ссылки на Terms/Privacy (можно страницы на вашем домене).
2. Добавьте продукты **Login Kit** и **Content Posting API**; в Content Posting включите **Direct Post**. Scopes: `user.info.basic`, `video.publish`, `video.upload`.
3. Redirect URI: `https://ВАШ-АДРЕС/api/oauth/tiktok/callback` (TikTok принимает только HTTPS).
4. Пока приложение не одобрено, используйте **Sandbox** и добавьте свой аккаунт в *Target users*.
5. `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` → `.env`.

**Честно об ограничениях TikTok:**
* Без аудита Direct Post все публикации **только приватные** («Только я»). Для публичной автопубликации подайте заявку на аудит (*Content Posting API → Direct Post → Apply for audit*). Аудит может не одобрить сугубо личный инструмент — это решение TikTok.
* Рабочий вариант без аудита: режим **«Отправить в черновики TikTok»** — видео приходит уведомлением в приложение, вы дописываете и публикуете одним нажатием. Статус в панели — «Требуется действие», а не «Опубликовано».
* Интерфейс соблюдает правила TikTok: видимость не выбрана по умолчанию, раскрытие рекламы, согласие с Music Usage Confirmation.
