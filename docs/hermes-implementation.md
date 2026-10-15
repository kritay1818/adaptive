# Hermes ACP — מימוש וגבולות האימות

## הפעלה

בחלונית החיבור (אייקון המפתח), בחרו **חיבור דרך Hermes במחשב הזה** (ברירת המחדל בהתקנה חדשה) או **חיבור עם מפתח API**. מסלול המפתח הוא OpenAI בלבד, שיחה ללא כלים, לא מנוי ChatGPT.

המשתמש הרגיל רואה מצב קצר וכפתור חיבור. כשאין אישור שמור: **נדרשת הגדרה חד־פעמית של איש המחשבים**. כל פרטי ההתקנה והאזהרות נמצאים תחת **הגדרות לאיש המחשבים**, סגור כברירת מחדל. זו הפרדה חזותית, לא הרשאת מנהל OS.

זיהוי Hermes הוא הצעת נתיב בלבד: בדיקת metadata של שמות קבצים מדויקים במיקומי התקנה רגילים וב־PATH מוחלט (עד 128 ערכים). בלי shell, סריקה רקורסיבית, הרצת הקובץ, קריאת config/secrets או בחירת פרופיל פעיל. מדלגים על PATH יחסי/ריק, shell launchers וקבצים/תיקיות world-writable ב־POSIX. התוצאה אינה הוכחת מקור מהימן או audit; איש המחשבים חייב לבדוק אותה. קובץ ההפעלה ותיקיית העבודה נבחרים באמצעות חלונות בחירה של מערכת ההפעלה, לא הקלדת נתיב. שם הפרופיל נכתב במפורש, ללא בחירת הפרופיל האישי אוטומטית.

ל־Hermes נדרשים executable מקומי מוחלט, שם פרופיל מפורש באותיות קטנות ותיקיית עבודה מוחלטת. אין shell, ארגומנטים חופשיים, `--yolo`, `--accept-hooks`, או קריאת credentials ב־Pet. קובצי `.cmd/.bat/.ps1` אינם נתמכים; Windows native עדיין לא אומת.

יש להכין ולבדוק פרופיל ייעודי ב־Hermes בעצמכם: `approvals.mode: manual`, כלים מצומצמים, hooks/plugins ו־allowlists שנבדקו. תיבת האישור היא **הצהרת המשתמש שבדק את המדיניות**, לא בדיקת config אוטומטית ולא sandbox. הפרופיל יכול לבצע פעולות ללא בקשת אישור, לרבות כלים שאינם כפופים לסריקת פקודות מסוכנות. אם לא ניתן לאשר מדיניות זו, אין לחבר את הפרופיל. תיקיית העבודה אינה מגבלת גישה למערכת הקבצים. נתונים/זיכרון/skills עשויים להיות משותפים בין sessions באותו פרופיל.

החיבור מריץ `hermes -p PROFILE acp --check`, ואז תהליך־בן `hermes -p PROFILE acp`, `initialize` בפרוטוקול 1 ו־`authenticate` עם מזהה שפרסם השרת. MCP מוגדר־גלובלית מדולג באמצעות marker רשמי; זה אינו חסימת כלים. סביבת הילד היא allowlist ללא משתני סודות/פרופיל/YOLO מהאפליקציה. Hermes עצמו מנהל את ההזדהות בפרופיל שנבחר.

אם אין auth מפורסם, המשתמש מתבקש לפנות לאיש המחשבים. בפרטים הטכניים מופיעה הנחיה להפעיל **בעצמכם בטרמינל** `hermes -p PROFILE acp --setup`. אין OAuth חדש ב־Pet, אין העתקת token, אין התחזות למנוי ואין fallback לספק בתשלום. המצב ״Hermes מחובר במחשב הזה״ מתייחס לתקשורת והזדהות מקומית בלבד, לא לבדיקת חיוב, quota או תשובה חיה.

## שיחות והרשאות

- שיחה אחת לכל tuple של executable קנוני, profile, workspace ו־project. לכל מיפוי מזהה conversation מקומי ומזהה session אמיתי מהשרת. בשלב זה אין כפתור new conversation בתוך אותו tuple; פרויקט חדש יוצר מיפוי נפרד.
- לפני prompt, `session/new` או `session/load` מדויק. ללא load capability או בהיעדר session לא מייצרים תחליף שקט. updates נרשמים לפני load; replay טקסטואלי שהתקבל מחליף cache מקומי. רק טקסט נתמך לתצוגה — לא תמונות/reasoning/tool history עשיר.
- מצב edit `default` חייב להיות מפורסם, ו־`session/set_mode` חייב להצליח; אחרת prompt חסום. זה אינו מוכיח את מדיניות כלל הכלים בפרופיל.
- הודעה והקשר משתמש מסומן נשלחים כבלוקים, לא system-role של OpenAI ולא היסטוריה חוזרת. מסמכים מסומנים כנתונים לא מהימנים. פקודות slash נחסמות כדי שלא יהפכו למסלול שינוי yolo/config.
- טקסט מגיע בהדרגה, פעילות כלי מוצגת בנפרד. בורר מודלים מופיע רק מתוך `availableModels` של session (לרוב לאחר התור הראשון); אין קטלוג קשיח ואין הגבלת regex של OpenAI על מזהים.
- הרשאה מחייבת prompt אמיתי ב־UI, project/session תואמים ומזהה בקשה חד־פעמי. מוצע רק ID `allow_once` עם kind תואם. קבוע/לכל session אינם מוצעים. דחייה, Escape, סגירת/הסתרת UI, ניתוק, timeout של 60 שניות או אופציה לא נתמכת → cancelled. שום קוד כלי אינו מבוצע על ידי renderer.
- מחזור חיי הביטול מתחיל מיד בכניסה ל־`reply`, לפני `session/new`, `session/load` או `session/set_mode`. Stop בזמן הכנה מסמן `cancelling`, ממתין לסיום בקשת ההכנה הקיימת ולא שולח `session/prompt` או הודעת משתמש לשרת. מיפוי session/replay שכבר התקבל נשמר; התור מסומן `cancelled` עם `cancelled_before_prompt`, ללא הוספת זוג הודעות פיקטיבי. תור חדש דורש שליחה מפורשת ובדיקת mode מחדש אם ההכנה לא הושלמה.
- Stop לאחר שליחת prompt מסמן `cancelling` **לפני** דחיית הרשאות ממתינות, שולח notification יחיד `session/cancel` וממתין לתוצאה. כל בקשת הרשאה מאוחרת נדחית אוטומטית, בלי לפתוח UI; token ישן אינו יכול לאשר פעולה בתור הבא. הרשאות קשורות גם למופע התור, ולא רק לפרויקט/session. לחיצה חוזרת על Stop אינה שולחת ביטול נוסף. בזמן ההמתנה לא ניתן להתחיל תור נוסף.
- Stop אינו rollback ואינו הוכחת עצירת כלי. לאחר prompt נשמרת תוצאת השרת בפועל: אם החזיר `end_turn` למרות בקשת הביטול, מוצג `completed`, לא הצלחת ביטול מדומה. לאחר restart, מצב שמור `running` או `cancelling` הופך ל־`unknown`. אין retry אוטומטי. גבול תור הוא 30 דקות; בקשת setup מוגבלת ל־30 שניות. תהליך שאינו משיב לביטול עלול להישאר ממתין עד timeout; נדרש שיפור UI ל־force stop בעתיד.
- במעבר transport כושל נשמרים המשתמש והתשובה החלקית במצב `unknown`; שגיאת RPC מסומנת `failed`, stop אחר מסומן `stopped`. הודעות שגיאה גנריות ללא stdout/stderr או סודות. ביטול אינו הוכחה שכל תהליכי־הנכד נעצרו.

## אחסון ותאימות

`projects.json` ו־`connection.json` הקיימים לא עוברים migration הרסני. זהו שינוי **אדיטיבי**: `backend.json` בוחר adapter; `hermes-state.json` עם `version:1` שומר הגדרות לא סודיות, session mapping, מודל נבחר, תורים ו־cache טקסט. הקבצים נכתבים atomically; schema לא מוכר חסום. הם JSON לא מוצפן ועלולים להכיל מידע עסקי. אין בהם OAuth/API keys. היסטוריית OpenAI ו־Hermes אינה מעורבבת ואינה משודרת מספק אחד לאחר.

אישור איש המחשבים נשמר כ־`acknowledged:true` רק אחרי check/initialize/authenticate מוצלחים, עם executable/workspace קנוניים ופרופיל מפורש. reconnect דורש לחיצה מפורשת ומשתמש בהגדרות השמורות בצד main בלבד, בלי overrides מה־renderer. רשומות ישנות עם false אינן מקודמות אוטומטית; אין אישור על סמך discovery. שינוי שדות בטופס מחייב אישור חדש. אין ניטור או audit לשינויים חיצוניים בקוד Hermes או בתוכן הפרופיל: לאחר שינוי מדיניות/התקנה על איש המחשבים לבדוק ולאשר מחדש. אישור זה אינו sandbox ואינו מחליף אישורים לפעולות בזמן השיחה. Hermes נשאר מקור האמת של היסטוריית הסוכן. Pet הוא cache טקסט מוגבל, לא עורך state.db של Hermes. לא הוספו כלים גנריים ל־preload; CSP, sandbox, contextIsolation, sender validation ו־safeStorage נשארו.

## מה אומת בפועל

- `npm test`: בדיקות Node, כולל בדיקות **PROTOCOL MOCK** מפורשות: framing מפוצל בעברית, requests/notifications, חסימת RPC לא נתמך, auth חסר/null, version לא נתמך, mode לא נתמך, mapping/restart/load, replay לפני load response, מודלים מפורסמים בלבד, allow-once/deny/timeout/token זר, cancel, crash ושימור partial כ־unknown ללא retry.
- בדיקות הביטול עוצרות תשובת פרוטוקול באמצעות gate מפורש (ללא sleeps): הרשאות מאוחרות אחרי Stop, token ישן גם בתור הבא, ביטול כפול, ביטול במהלך new/load/set_mode וב־session שכבר נטען, ותשובת setup מאוחרת אחרי כשל transport. נבדק שאין prompt אחרי ביטול הכנה, שאין retry אוטומטי ושאפשר להתחיל תור חדש מפורש עם אותו session. ה־gate מחזיק רק את תשובת RPC הנבחרת ומשחרר אותה אחרי בדיקת מצב הביטול, כדי לתפוס את המרוץ באופן דטרמיניסטי.
- `npm run check`: formatting.
- `npm run test:ui`: Electron אמיתי מבודד ל־UI הקיים, החיה, ובדיקת **Hermes PROTOCOL MOCK** בתהליך־בן נפרד. נבדקים settings, partial text לפני permission response, allow-once, Escape deny, cancel, models ו־IPC מחלון החיה. `artifacts/hermes-protocol-mock.png` מכיל תשובות מדומות מסומנות, לא מודל חי.
- `node scripts/check-hermes-handshake.cjs /absolute/path/to/hermes`: **בדיקה אמיתית ללא inference** עם HOME/HERMES_HOME ריקים וזמניים, ללא פרופיל משתמש, ללא session/new וללא authenticate. במחשב זה: `acp --check` exit 0; initialize protocol 1, agent `hermes-agent`, version `unknown`, loadSession true, auth יחיד `hermes-setup` מסוג terminal. כך נבדקו ה־transport והיעדר auth בלי חשבון/מנוי קיים.

## לא אומת / לא נעשה

לא נשלחה בקשת inference אמיתית, לא אומת ספק/OAuth/מנוי/quota, לא בוצעה פעולת כלי אמיתית, ולא נבדקו refresh, logout או חיוב. לא שונו התקנת Hermes, פרופילים, auth, config או gateway קיימים. לא אותחל מחדש מופע האפליקציה שהיה פתוח. חבילות `dist/` לא נבנו מחדש — הן אינן כוללות בהכרח שינוי זה.

נדרשת בדיקת E2E מאושרת על פרופיל ניסוי מוגבל ובעלות מאושרת, ובדיקה נפרדת על Windows. נדרשות עוד בדיקות גרסאות Hermes, ניתוק בזמן כלי חיצוני/process-tree cleanup, עדכוני session metadata/compression, replay רב־מדיה, חסמי quota אמיתיים ושחזור אחרי sleep/wake. אין טענת production readiness או בדיקת מדיניות אוטומטית של כלל כלי הפרופיל.
