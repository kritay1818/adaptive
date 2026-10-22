# מסירה למממש — ADActive Pet

## מה נמסר

מקור Electron מקומי לחיית ADActive, שורת שיחה RTL מינימלית, חלון היסטוריה נפרד וחיבור WordPress מוגבל ומאושר. כל קוד האפליקציה, הבדיקות והחיה כלולים; אין credentials מקומיים, שיחות משתמש או בינארי Windows עדכני. יעד GitHub שהמשתמש אישר: **PRIVATE** `netanelpro0123-a11y/ADActive-Pet`; יצירת המאגר/אימות gh/כל פעולות Git באחריות הסוכן הראשי, ולא בוצעו בהכנת המקור.

## מפת קוד ונכסים

- `src/main.cjs`, `preload.cjs`, `security.cjs`: חלונות native, מגש, IPC מוגבל והרשאות לפי חלון/frame/URL.
- `src/core.cjs`, `message-actions.cjs`: פרויקטים, היסטוריה עם IDs, העתקה, ייצוא דרך native picker וצירוף הודעות כהקשר לבקשה הבאה — **לא העלאת קובץ**.
- `src/provider.cjs`, `provider-adapters.cjs`, `tool-adapters.cjs`: OpenAI, Anthropic, Gemini, Moonshot בינלאומי ו־Qwen Singapore; גילוי מודלים, אימות קצר בתשלום אפשרי לאחר קליק מפורש, שיחה ופרוטוקולי tool continuation מקוריים. אין fallback שקט; בחירת מודל מרשימה אינה הוכחת תמיכה בכלים.
- `src/wordpress.cjs`, `wp-agent.cjs`: HTTPS REST מבסיס התקנת האתר באמצעות `index.php?rest_route=...`; pages/posts list/read/prepare-create/prepare-update, capabilities, media/settings לקריאה בלבד. פירוט: [WP-EXECUTION.md](WP-EXECUTION.md), [PROVIDERS.md](PROVIDERS.md).
- `src/ui/`: renderer מקומי, חלונות pet/model/wordpress/history. **נכסי החיה נדרשים ונכללים**: `pet.svg`, `brand-logo.svg`, `tray.png`, `icon.ico`; גם `pet.html`, `pet.css`, `pet.js`, `src/pet-layout.cjs`. `scripts/render-brand.cjs` מרנדר SVG מקומי לראיות בתיקיית artifacts, אינו תלוי בשירות תמונות.
- `tests/fixtures/`: קוד MOCK ציבורי ו־setup legacy מבודד; חייב להיכלל. `artifacts/` היא פלט בדיקות מקומי מוחרג ולא מקור runtime; צילומים אינם הוכחת live API.

## התקנה, בדיקה ו־Windows

```sh
npm ci
npm test
npm run test:ui
npm run check
npm start
# build מקומי מהמקור, לא הוכחת הרצה ב־Windows:
npm run build:win
```

Node.js 24+; ההרצה המקומית שנבדקה השתמשה ב־Node `v25.1.0`, npm `11.6.2` ובתלויות שכבר הותקנו. `npm ci` לא הורץ מחדש במסירה. לבדיקות Electron נדרשת סביבת desktop ו־safeStorage זמין; `TMPDIR` צריך להצביע לתיקיית scratch פרטית וניתנת לכתיבה. לאחר clone יש ליצור `artifacts/` לפלט צילומים (`mkdir -p artifacts`), כי התיקייה מוחרגת מהמאגר. אין להשתמש ב־userData של המשתמש לבדיקות.

`build:win` הוא `electron-builder --win portable --x64`, כולל `src/**/*` ו־package.json ב־ASAR ומשתמש ב־`src/ui/icon.ico`. לא הורץ build במסירה זו. **אין למסור את dist הקיים כגרסה נוכחית**. build חדש דורש בדיקת מקור ASAR, checksum והרצה אמיתית ב־Windows, כולל tray, הצפנה, חלונות וסקיילינג; cross-build ב־macOS אינו אימות runtime.

## ארכיטקטורת אבטחה — לשמר

- רשת וסודות ב־main בלבד; sandbox/contextIsolation/webSecurity, ללא Node ב־renderer, ללא shell/HTTP כללי. שמירת credentials ב־safeStorage; אין fallback טקסט גלוי אם הצפנת OS אינה זמינה.
- WordPress: HTTPS/443 בלבד, public IPv4 מאומת ומוצמד ל־socket; דחיית כל redirect, deadline ומגבלת גוף. username/Application Password נפרדים ממפתח מודל ואינם נשלחים למודל.
- אישור כתיבה בבעלות main, payload מדויק ובלתי ניתן להחלפה, קשור לפרויקט/אתר/משאב/snapshot, חד־פעמי ופג לאחר 5 דקות. יצירה לטיוטה בלבד; עדכון שומר status. POST יחיד ואז GET למזהה המדויק והשוואת raw title/content/status. דחייה = אפס POST.
- unknown חוסם כתיבות לפרויקט גם לאחר restart; אין retry אוטומטי. pending reviews בזיכרון בלבד. אין עדיין UI נתמך לשחרור unknown; לבדוק ידנית את האתר לפני שחזור מבוקר.
- היסטוריה/הקשר נשמרים **JSON לא מוצפן** ב־userData ונשלחים לספק הנבחר בבקשה מפורשת. תוכן אתר/צירופים נתונים לא מהימנים, לא הוראות; ההגנה אינה מבטיחה חסינות מלאה מהזרקת prompt. לא לצרף userData למסירה גם אם credentials מוצפנים.

## מצב acceptance מדויק במסירה

- `npm test`: **92 passed, 0 failed**, ללא skipped.
- `npm run check`: **נכשל**, 12 קבצים עם חריגות Prettier: `src/core.cjs`, `main.cjs`, `message-actions.cjs`, `preload.cjs`, `src/ui/app.css`, `history.html`, `index.html`, `renderer.js`, `tests/chat-response-ui.cjs`, `chat-window-ui.cjs`, `message-actions.test.cjs`, `wp-agent-ui.cjs`. לא הורץ formatter כותב או npx; אין להציג את check כירוק.
- ה־history UI שהיה pending: `tests/chat-response-ui.cjs` תוקן בשתי נקודות race של פתיחת native window: ממתינים לאירוע `window` ול־URL לפני locator, גם אחרי restart. כעת **PASS** ל־compact64, טעינה/תשובה/שגיאות/empty/restart, היסטוריה נפרדת וגלילה, העתקה, ייצוא picker ב־fixture, צירוף/הסרה/צריכה רק בהצלחה ובידוד פרויקטים/IPC. אין שינוי production לצורך תיקון ה־race.
- `npm run test:ui`: **לא ירוק מלא**. ארבעת התרחישים הראשונים עברו (chat-response, model-window, command-bar, wordpress), ואז `tests/electron-ui.cjs:120` timeout: תרחיש legacy setup מחפש תשובה inline ב־index למרות מעבר ההיסטוריה לחלון נפרד. יש ליישר את fixture מול subscription `stateChanged` של ה־renderer ולא להחזיר שיחות inline בפרודקשן או להסיר coverage. החסימה נשארה גלויה למסירה.
- שאר התרחישים הורצו בנפרד ועברו: `pet-ui.cjs`, `providers-ui.cjs`, `model-discovery-ui.cjs`, `wp-agent-ui.cjs`. WP E2E MOCK: list → read → review → deny 0 POST / approve 1 POST + exact GET; narrow review, sender/project guards.
- צילומים שנוצרו מקומית כוללים `artifacts/history-actions-MOCK.png`, `compact-reply-MOCK.png`, `wp-agent-review-MOCK.png`, `wp-agent-review-narrow-MOCK.png`, `wp-agent-verified-MOCK.png`. צילום ההיסטוריה נבדק חזותית: כפתורי פעולות גלויים; תשובה ארוכה ממשיכה בתוך אזור גלילה, לא מתרחבת בשורת הפקודה. אין לכלול את כל artifacts באופן גורף במאגר.
- command-bar: גאומטריה/API native נבדקו; physical OS drag/edge מוגבל עקב AX/CG permissions. בדיקת pet pointer אינה הוכחת physical native edge. Windows, ריבוי צגים פיזיים ונגישות מלאה עדיין לא אומתו.
- **לא בוצעו בקשות live provider/WP, inference בתשלום או כתיבות אתר חיות במסירה.** הצלחות הן MOCK מוזרק ומסומן ב־Electron מבודד, לא הוכחת הרשאות של אתר אמיתי. האפליקציה הפעילה של המשתמש לא הופעלה מחדש.

## היקף ומגבלות

אין שליטה מלאה ב־WordPress, עורך Elementor, plugins/themes/filesystem, uploads, מחיקה, פרסום חדש, שינוי משתמשים/settings, payments/DNS או כלי מחשב. HTML/Gutenberg אינרטי מוגבל. snapshot לפני POST אינו נעילת עריכה אטומית. live staging acceptance דורש אישור חדש לשינוי אחד בטיוטה חדשה וקריאה חוזרת למזהה שלה; לא להשתמש ב־credentials של המשתמש לבדיקות אוטומטיות.

## מסירת מקור וסקירת סודות

ה־`.gitignore` מחריג node_modules/dist/artifacts, env, credentials/secrets, runtime logs/cache/userData ושיחות פרטיות; אינו מחריג tests או נכסי pet. [SOURCE-FILES.txt](SOURCE-FILES.txt) הוא allowlist מפורש מומלץ ל־staging (קובץ אחד בשורה). אין להשתמש ב־`git add .` ואין להוסיף dist או artifacts בכוח.

סריקה היוריסטית מקומית של **מועמדי מקור בלבד** בדקה tokens מוכרים, private keys, URL credentials ו־secret literals. לא אותרו חשדות ל־credentials אמיתיים; שלוש התאמות ב־`tests/wordpress.test.cjs` הן fixtures ציבוריים/קלט דחיית URL (שורות 29, 136, 214). לא נקראו production userData ולא הודפסו ערכי סודות. זו אינה הוכחה שאין כל סוד אפשרי: הסוכן הראשי צריך לסקור את רשימת staging וה־diff לפני commit. קובצי runtime, לוגים וצילומים לא נכללו בסריקה ולא אושרו לפרסום.
