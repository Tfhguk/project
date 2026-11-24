ROI SITE — PATCH СИНХРОНИЗАЦИИ ТОКЕНА ESP32

ЧТО ИСПРАВЛЕНО
- Генератор прошивки использует один values.token для roi_robot/config.h и
  server/local/robot-device.private.json.
- Добавлен sync-device-config.cjs. Он переносит этот токен в запись устройства
  существующего local/robot-private.json и обновляет запись в
  local/tracker-private.json.
- Скрипт сохраняет operatorToken, trackerToken, cloud/refreshToken, остальные
  устройства, настройки модели и калибровки, anchors и yaw_offset_deg.
- Скрипт не содержит пользовательских секретов и не перезаписывает целиком
  существующие private JSON-файлы.
- Добавлен отдельный тест синхронизации и включён новый скрипт в build и
  GitHub manifest.

КАК ПРИМЕНИТЬ
1. Сделай резервную копию своего проекта.
2. Распакуй содержимое этого архива в корень проекта с заменой одноимённых файлов.
3. В корне проекта выполни:
     npm run build
     npm run test:device-token-sync
     npm run test:github-manifest
4. После успешной сборки опубликуй проект обычным способом.

КАК ПОЛЬЗОВАТЬСЯ НОВОЙ ГЕНЕРАЦИЕЙ
1. В ROI открой старое окно «Прошивка ESP32» и создай/введи токен техники.
2. Скачай персональный ZIP. В нём config.h и private-фрагмент содержат один токен.
3. Найди на компьютере папку, где находится работающий robot-server.cjs и local.
4. Скопируй из ZIP файл server/sync-device-config.cjs в эту папку рядом с
   robot-server.cjs.
5. Скопируй server/local/robot-device.private.json в существующую папку local.
   Не заменяй local/robot-private.json и local/tracker-private.json.
6. Убедись, что в local/robot-private.json заданы собственные operatorToken и
   trackerToken, а не строки REPLACE_...
7. Открой CMD в папке с robot-server.cjs и выполни:
     node sync-device-config.cjs
8. После сообщения об успешной синхронизации прошей ESP32 файлом
   roi_robot/config.h из того же ZIP.

ВАЖНО
- Не публикуй ZIP, config.h, robot-device.private.json, robot-private.json,
  tracker-private.json и Wi-Fi пароль.
- Патч не включает движение и не меняет калибровки/защиты робота.
- Проверены синтаксис JavaScript и отдельный тест слияния private-конфигурации.
  Полный браузерный test_firmware не запускался в этой среде: пакет Playwright
  здесь не установлен. После npm install можно выполнить npm run test:firmware.
