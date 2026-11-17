# Выпуск ФизЛаб 3D в Google Play

Проверено по официальным правилам 30 сентября 2026 года. Код интеграции не создаёт аккаунты Google Play / RevenueCat, магазинные товары и ключ подписи. До их настройки платёж недоступен; веб-версия не имитирует успешную покупку.

## Продукты и проверка доступа

Приложение устанавливается бесплатно. Шесть демонстрационных тем доступны без подписки. Для полного курса используются автоматически возобновляемые подписки Google Play через RevenueCat. Покупки цифрового образовательного контента внутри Play-приложения подпадают под [платёжную политику Google Play](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en). Не включайте плату за скачивание вместо подписки.

В Google Play Console создайте приложение с пакетом `app.fizlab.course`. Перед первой публикацией проверьте принадлежность и окончательность этого идентификатора. Создайте один subscription product `fizlab_pro` и активируйте два base plan:

| Base plan ID | Период | Тип |
| --- | --- | --- |
| `monthly` | `P1M` — месяц | Auto-renewing |
| `annual` | `P1Y` — год | Auto-renewing |

Цены и страны продаж задаются в Play Console. Приложение показывает локализованную цену от магазина и покупает именно показанный обычный base plan. В этой версии не поддержаны пробные периоды, introductory offers, рассрочка и prepaid-планы; случайное автоматическое применение таких предложений исключено. Годовая цена списывается целиком. Исходные цены для запуска нужно проверить на реальной аудитории; нельзя доказать «оптимальную» цену без данных о покупках и удержании. Для экономики учитывайте [комиссию Google Play для автоматически возобновляемых подписок](https://support.google.com/googleplay/android-developer/answer/112622?hl=en-GB) и отдельные условия RevenueCat, налоги, сервер и поддержку.

В RevenueCat:

1. Создайте Android Google Play app с тем же package ID, подключите service credentials по официальной инструкции RevenueCat. Секретный JSON не кладите в приложение или репозиторий.
2. Импортируйте `fizlab_pro:monthly` и `fizlab_pro:annual`, прикрепите оба продукта к entitlement `fizlab_pro`.
3. Создайте Current Offering. Его стандартный Monthly package (`$rc_monthly`) должен содержать `fizlab_pro:monthly`, Annual package (`$rc_annual`) — `fizlab_pro:annual`. Идентификаторы подписки и base plan должны совпадать с таблицей.
4. В Project settings → General задайте **Keep with original App User ID**, также для sandbox при включённом отдельном sandbox-настройке. Приложение требует входа перед покупкой, передаёт стабильный UUID пользователя, не создаёт анонимных покупателей. Это предотвращает передачу подписки другому аккаунту при восстановлении. Помогайте пользователям восстановить первоначальный аккаунт; поведение описано в [документации RevenueCat](https://www.revenuecat.com/docs/projects/restore-behavior).
5. Подключите Google RTDN / Pub/Sub к RevenueCat и отправьте тестовое уведомление. Проверьте получение в кабинете. В этом проекте оставьте **Track new purchases from server-to-server notifications** выключенным: идентичность первой покупки устанавливается SDK. Это отдельная настройка от обычных уведомлений о продлении, отмене и возврате. [Инструкция RTDN](https://www.revenuecat.com/docs/platform-resources/server-notifications/google-server-notifications).

Ключ `VITE_REVENUECAT_GOOGLE_API_KEY=goog_…` — публичный Android SDK key, попадает в мобильную сборку. `REVENUECAT_SECRET_API_KEY` — секрет только сервера. `REVENUECAT_ENTITLEMENT_ID=fizlab_pro` задаётся на сервере. Для отдельного тестового backend можно разрешить `REVENUECAT_ALLOW_SANDBOX=1`; на production это значение должно отсутствовать или быть выключено.

Клиент не выдаёт доступ по результату платёжного окна. После покупки и восстановления он запрашивает проверку своего аккаунта сервером. Сервер сверяет подписку с RevenueCat, где покупки проверяются через Google Play. При отмене, ожидании оплаты или ошибке нельзя присваивать доступ локально. Связь UUID и SDK сериализована с входом/выходом; [RevenueCat рекомендует configure с custom App User ID и logIn при смене аккаунта](https://www.revenuecat.com/docs/customers/identifying-customers).

## Сборка Android

Требуются Node.js 24+, JDK 21 и Android SDK 36. Проект использует Capacitor 8, `minSdkVersion=24`, `targetSdkVersion=36`. С 31 августа 2026 года новые обычные Android-приложения и обновления должны иметь [target API 36 или выше](https://developer.android.com/google/play/requirements/target-sdk?hl=en). Для новых релизов без исключения нужна [Google Play Billing Library 8 или выше](https://developer.android.com/google/play/billing/deprecation-faq?hl=en); проверьте фактически разрешённую транзитивную зависимость RevenueCat командой ниже.

Укажите постоянный production API и публичный SDK key в окружении процесса перед сборкой:

```powershell
$env:VITE_API_URL = 'https://YOUR-PRODUCTION-HOST/api'
$env:VITE_REVENUECAT_GOOGLE_API_KEY = 'goog_YOUR_PUBLIC_SDK_KEY'
$env:VITE_SUPPORT_EMAIL = 'support@YOUR-PRODUCTION-HOST'
$env:VITE_DEVELOPER_NAME = 'Имя или организация владельца приложения'
npm ci
npm run check:release
npm run build:android
```

Замените примеры настоящими значениями; временные туннели и `localhost` для production запрещены проверкой сборки. API, страница конфиденциальности и удаление аккаунта должны работать на постоянном HTTPS-домене. Сам backend разворачивается отдельно, как описано в `DEPLOY.md`.

Activity использует `singleTop`: [RevenueCat требует `standard` или `singleTop`](https://www.revenuecat.com/docs/getting-started/installation/capacitor), чтобы возвращение из банковского приложения не отменяло оплату.

Для локальной проверки из каталога `android`:

```powershell
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:dependencyInsight --dependency billingclient --configuration releaseRuntimeClasspath
```

Для подписанного AAB сохраните четыре значения в секретах CI либо в локальном `android/keystore.properties` (файл исключён из Git):

```properties
FIZLAB_UPLOAD_STORE_FILE=C:/private/fizlab-upload.jks
FIZLAB_UPLOAD_STORE_PASSWORD=YOUR_LOCAL_SECRET
FIZLAB_UPLOAD_KEY_ALIAS=fizlab-upload
FIZLAB_UPLOAD_KEY_PASSWORD=YOUR_LOCAL_SECRET
```

`FIZLAB_UPLOAD_STORE_FILE` может быть абсолютным путём или путём относительно `android`. При одинаковых именах переменные окружения имеют приоритет. Ключ загрузки создаёт и хранит владелец приложения; сохраните защищённую резервную копию и включите Play App Signing. Пароли не передавайте в командной строке и не публикуйте. При отсутствии полного набора параметров `bundleRelease` / `assembleRelease` останавливается с понятной ошибкой. Существующий ключ нельзя заменять произвольным новым ключом для уже опубликованного приложения.

```powershell
Set-Location android
.\gradlew.bat :app:bundleRelease
```

Результат: `android/app/build/outputs/bundle/release/app-release.aab`. Увеличивайте `versionCode` в `android/app/build.gradle` для каждой новой загрузки. Debug APK не является релизным AAB.

## Перед отправкой на проверку

Проверьте на Android-устройстве через Internal testing с аккаунтом лицензионного тестировщика Google Play: месячную/годовую покупку, отмену окна, отложенный платёж, подтверждение в другом приложении, восстановление после переустановки, выход/вход, попытку восстановления из другого аккаунта, окончание срока, отмену автопродления, возврат и отсутствие сети. Отмена автопродления должна сохранять оплаченный доступ до окончания периода; возврат/отзыв должны прекращать его по актуальному статусу магазина. Реальные деньги для этих проверок не нужны.

Проверьте регистрацию, доставку писем восстановления и подтверждения, истёкшие/повторно использованные коды из писем, смену пароля и удаление аккаунта с активной подпиской. Удаление аккаунта приложения само по себе не отменяет подписку Google Play; пользователь должен видеть способ отмены и последствия. Ссылка управления ведёт в [центр подписок Google Play](https://play.google.com/store/account/subscriptions?sku=fizlab_pro&package=app.fizlab.course).

Для карточки требуются название/описание, иконка, скриншоты, контакты разработчика, возрастная аудитория, контентный рейтинг и корректная Data safety с Google Play/RevenueCat и используемым почтовым сервисом. Политика конфиденциальности должна описывать фактические данные, обработчиков, сроки хранения и контакт владельца, а не содержать заглушки. Подготовьте тестовый доступ и инструкции для ревьюеров, если часть функций закрыта входом/подпиской.

Если приложение позволяет создать аккаунт, Google Play требует [удаление из приложения и общедоступную внешнюю ссылку для запроса удаления](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en). В проекте предусмотрены `/account/delete` и `/privacy`; их production URL необходимо указать в Play Console и проверить без установленного приложения.

Для personal developer account, созданного после 13 ноября 2023 года, перед заявкой на production нужен [closed test минимум с 12 участниками, непрерывно подключёнными 14 дней](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en). Выполнение этого условия не гарантирует одобрение: Google оценивает тестирование и готовность приложения.

Публикация требует доступа владельца к Play Console, завершённой верификации разработчика и платёжного профиля. Наличие исходников или успешная локальная сборка не означает публикацию в магазине.
