# הצעת שילוב Hermes מקומי ב־ADActive-Pet

## החלטה מומלצת

**ADActive-Pet יהיה ACP host ל־Hermes שמותקן במחשב הלקוח.** תהליך Electron main יפעיל `hermes -p <profile> acp` כתהליך־בן וידבר איתו ב־JSON-RPC על stdio. Hermes נשאר בעל הספקים, ההזדהות, הכלים, הזיכרון והיסטוריית הסוכן; החיה היא ממשק, לא runtime סוכן נוסף ולא שירות inference של ADActive.

מסלול משני אמיתי קיים: **API Server adapter מקומי של Hermes gateway**, עם HTTP/SSE ואימות Bearer. זה אינו שירות Hermes מתארח ציבורי. למסלול הראשון עדיפות ל־ACP: אין פורט או secret חיבור נוסף, ויש פרוטוקול מפורש לעדכוני כלים, אישורים, ביטול ומיפוי sessions. API Server מתאים למי שכבר מפעיל gateway ורוצה חיבור לשירות קיים; לא להפעילו/לשנותו אוטומטית מאחורי גב המשתמש.

`copilot-acp` הוא ספק שמפעיל Copilot CLI *מתוך* Hermes; אינו שם החיבור בין החיה ל־Hermes.

## בסיס האימות וגבולותיו

- נקראו התיעוד הרשמי החי [1–5], קוד ההתקנה המקומית שאינו מכיל credentials וקוד האפליקציה.
- `hermes acp --help` הציג `--check`, `--setup`, `--setup-browser`, `--version` ו־`--accept-hooks`.
- `hermes acp --check` החזיר בפועל `Hermes ACP check OK`.
- `hermes acp --version` החזיר `unknown`. סביבת הקוד המותקנת אינה Git checkout ולכן אין commit מאומת. אין להסיק מזה מספר גרסה או תאימות לכל התקנת לקוח; נדרשים handshake ובדיקות capabilities.
- SDK ה־ACP המותקן מגדיר `PROTOCOL_VERSION = 1`, וקורא הודעת JSON אחת בכל שורה.
- לא נקראו `.env`, `auth.json`, config אישי, נתוני חשבונות או credentials; לא הופעל OAuth, gateway חדש או inference. אין טענה שחיבור מלא, billing או Windows אומתו מקצה לקצה.
- `web_extract` נכשל בגלל 403 בשירות החילוץ, לא בגלל חסימת אתר Hermes. אתר התיעוד עצמו נקרא בדפדפן וב־curl מאומת TLS. נתיבי ACP/API שנוח לנחש אינם הנתיבים הקנוניים; הקישורים התקינים מופיעים במקורות.

## הארכיטקטורה הקיימת והפער

- `src/main.cjs`: תהליך main, חלונות החיה/sidebar, IPC עם בדיקת שולח, `Provider` יחיד. `send` בונה messages, ממתין לתשובה אחת ושומר זוג הודעות רק בהצלחה.
- `src/provider.cjs`: OpenAI בלבד, כתובת קבועה `https://api.openai.com/v1/chat/completions`, Bearer key, `store:false`, timeout של 60 שניות, ללא streaming או ביטול. המפתח מוצפן ב־`safeStorage` והחיבור נשמר ב־`connection.json`.
- `src/core.cjs`: פרויקטים והיסטוריה ב־`projects.json`, system prompt שאומר במפורש שאין כלים, מסמכים כנתונים לא מהימנים, 40 הודעות אחרונות בכל request.
- הבידוד של Electron טוב כבסיס: `sandbox`, `contextIsolation`, בלי Node ב־renderer; רשת renderer, ניווט, webview וחלונות חיצוניים חסומים. **אין לפרק את ההגנות כדי להוסיף Hermes.**
- אין עדיין ממשק לאישורים, streams, sessions של backend או כלים. החלפת URL ב־Provider אינה אינטגרציה מספקת ואף עלולה להוסיף גישה למחשב ללא UI לאישור.
- ה־README מזכיר דחייה של eve. בבקשה זו Hermes הוא runtime שנבחר במפורש; לא מוסיפים eve כשכבת סוכן שנייה.

## חוזה ACP מוצע ומאומת

### הפעלה ו־transport

1. לבחור installation ופרופיל במפורש; לא להניח שה־PATH של Electron זהה לטרמינל, ולא לקבע את נתיב סביבת ההתקנה הנוכחית.
2. להריץ discovery באמצעות executable שנבחר ואומת ו־`acp --check`; לא לקרוא credentials לצורך בדיקת התקנה.
3. main מפעיל executable עם מערך arguments קבוע `['-p', profile, 'acp']`, ללא shell וללא הרכבת פקודה מטקסט שיחה. stdio בצינורות, לא PTY; UTF-8, JSON-RPC 2.0 newline-delimited ב־stdin/stdout. stderr הוא לוג נפרד ומסונן. אין HTTP auth token בין תהליכים אלו.
4. לתמוך ב־chunking של שורות UTF-8, מגבלת גודל, request IDs, שגיאות, notifications ובקשות חוזרות מהשרת במקביל לתשובה ארוכה. מומלץ SDK תואם ACP במקום parser אד־הוק; לא נבחרה/הותקנה עדיין חבילת JS.
5. אין צורך ב־gateway עבור ACP. לא להשתמש ב־`--yolo`, `--accept-hooks` או auto-answer לאישורים. ניהול תהליך נפרד: החיה רשאית לסגור רק ילד שהפעילה, לא את כל תהליכי Hermes של המשתמש.

### Handshake / auth / שיחה

דוגמאות לשדות wire, לא תמליל של חיבור חי:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"adactive-pet","version":"<app-version>"}}}
{"jsonrpc":"2.0","id":2,"method":"authenticate","params":{"methodId":"<id-advertised-by-initialize>"}}
{"jsonrpc":"2.0","id":3,"method":"session/new","params":{"cwd":"<absolute-approved-workspace>","mcpServers":[]}}
{"jsonrpc":"2.0","id":4,"method":"session/prompt","params":{"sessionId":"<returned-session-id>","prompt":[{"type":"text","text":"<user-message>"}]}}
```

- `initialize` מפרסם capabilities ו־auth methods; אין להציג מחובר רק מפני שהתהליך חי. `authenticate` משתמש רק ב־method ID שהשרת פרסם.
- הזדהות runtime שכבר מוגדרת ב־Hermes נשארת מנוהלת ב־Hermes. השיטה `hermes-setup` היא terminal auth; args שפורסמו הם `['--setup']` עבור launcher ה־ACP, כלומר בפועל `hermes -p <profile> acp --setup`.
- setup הוא תהליך אינטראקטיבי נפרד בטרמינל אמיתי, לא הודעות על pipe ה־JSON-RPC. בשלב ראשון להנחות את המשתמש לפתוח את האשף המקומי; אין לבנות OAuth חלופי, לקרוא token stores או לבקש token בשיחה. לפרסם terminal-auth capability רק אם מימוש host אכן תומך בו. לאחר setup, reconnect ו־handshake מחדש.
- `session/new` מקבל `cwd` מוחלט ו־`mcpServers`; להתחיל עם מערך MCP ריק. ה־cwd קובע סביבת עבודה, **אינו sandbox או גבול גישה לקבצים**.
- `session/update` נשלח תוך כדי prompt ויכול להכיל טקסט, מחשבה, כלי, שינוי metadata או usage. להפריד תצוגת activity מהתשובה; reasoning אינו טקסט תשובה סופי. `session/prompt` מסתיים בתוצאת stop reason, לא בשדה `choices` של OpenAI.
- `session/cancel` הוא notification עם `sessionId`; להמשיך לקרוא עד סיום התור. ביטול אינו rollback של קבצים, שליחה או פעולות שכבר בוצעו. אין retry אוטומטי של prompt לאחר disconnect.
- `session/set_model` עם `sessionId` ו־`modelId` משתמש במזהה שהשרת פרסם; הדוגמאות בתיעוד הן `provider:model` או `custom:<name>:<model>`. הבחירה היא ברמת session, לא שינוי ברירת המחדל הגלובלית. אין להחיל regex של מודל OpenAI על IDs אלו.
- להשתמש רק בפעולות/capabilities שפורסמו. בהתקנה שנבדקה קיימות load/list/resume/fork. לשחזור מדויק עדיף `session/load` עם `sessionId`, `cwd`, `mcpServers`; לרשום handler ל־updates **לפני** הקריאה, משום שההיסטוריה מוזרמת לפני תשובת load. קוד `resume` עשוי ליצור session חדש אם הישן חסר; אין להציג זאת כשחזור מוצלח.

### Sessions, פרויקטים ופרטיות

- לשמור מיפוי מפורש `(installation, profile, projectId, conversationId) → sessionId, cwd, selectedModel` עם migration מגובה. אין לזהות שיחה לפי ההודעה הראשונה ואין לערבב project ID עם Hermes session ID.
- Hermes הוא מקור האמת להיסטוריית הסוכן, כולל tools/compression; Pet יכול לשמור cache לתצוגה, לא לשדר מחדש 40 הודעות בכל תור של session קיים.
- לא לשלוח את system prompt הקיים הטוען שאין כלים אל Hermes. ACP prompt blocks אינם OpenAI messages ולא מספקים כאן system-role שרירותי. הקשר/כללי פרויקט: להעביר כהקשר משתמש מפורש ומסומן, או להכין context file רק בהסכמה ולפי מדיניות Hermes. אין להבטיח שזה זהה לסמכות system prompt.
- מסמכים חיצוניים נשארים נתונים לא מהימנים; לא לכתוב אותם אוטומטית ל־AGENTS.md, skills או config.
- sessions שונים באותו profile אינם בידוד לקוחות: memory/skills/session search עשויים להיות משותפים. אם נדרשת הפרדת מידע בין לקוחות, לבחור profiles נפרדים, ובסיכון גבוה גם OS account/sandbox נפרד. אין להעתיק credential stores בין profiles אוטומטית.

## אישורים והרשאות: תנאי להפעלה

1. מדיניות מומלצת `approvals.mode: manual`, ACP edit mode `default` (בקוד: `ask`). אין `yolo`, `approvals.mode: off`, `dont_ask` או auto-approval של hooks. זו מדיניות להצבה בהתקנה עתידית בהסכמה, לא שינוי שבוצע כאן.
2. לממש `session/request_permission` כשאלה אמיתית: session, פקודה/קובץ/diff, תיאור, וזהות סביבת העבודה. תשובת JSON-RPC: `result.outcome = {"outcome":"selected","optionId":"<offered-id>"}`; ביטול: `{"outcome":"cancelled"}`. לקבל רק ID שהוצע באותה בקשה.
3. ה־bridge הנבדק מציע `allow_once`, לעיתים `allow_session`, `allow_always`, `deny`, ולעיתים `deny_always`. ברירת המחדל במוצר תהיה דחייה/אישור חד־פעמי; אין להציע אישור קבוע ב־MVP. **לא להסתמך על `kind` בלבד**: `allow_session` משתמש ב־kind מסוג `allow_always`, אך הסמנטיקה נבדלת לפי option ID.
4. timeout/שגיאה/סגירת UI גורמים לדחייה. ברירת המחדל של timeout באישור Hermes היא 300 שניות; לא להחיל את timeout ה־60 שניות הקיים על תור סוכן שלם.
5. manual אינו אישור על כל פעולה: הסריקה מתמקדת בין היתר בפקודות מסוכנות, וקיימים כלים/תוספים עם מדיניות משלהם. אין לטעון שה־UI לאישורים הוא sandbox או שמונע כל הוצאת מידע.
6. ACP משתמש ב־`hermes-acp` toolset רחב: קבצים, terminal, browser/web, memory/skills, execute_code, delegation ועוד. לצמצם מראש בפרופיל ייעודי באמצעות `platform_toolsets.acp` ו־`agent.disabled_toolsets`; לבחון גם plugins ו־MCP. רשימה ריקה לבדה **אינה מבטיחה אפס כלים**: plugin toolsets עדיין עשויים להתווסף.
7. `HERMES_ACP_SKIP_CONFIGURED_MCP=1` הוא marker רשמי ש־host יכול להעביר לילד כדי לדלג על startup של MCP גלובליים כש־host מנהל MCP. הוא אינו חסימת כלים מלאה. אין להעביר MCP מה־renderer ללא מדיניות ואישור.
8. לפני שמאפשרים סוכן עם גישה למחשב: לבדוק allowlists קיימים, hooks ו־plugins בפרופיל שנבחר בתהליך onboarding מאושר. אם לא ניתן לקבוע מדיניות בטוחה, לא לשלוח prompt לסוכן רחב־הרשאות; להציג חסם ברור במקום להסתפק ב״אין yolo בפקודה״.

## חלופה: API Server מקומי

התיעוד הרשמי נמצא תחת Open WebUI [2]; קוד ההתקנה מאשר transport עשיר יותר מה־quickstart.

- הפעלה מפורשת של adapter: `API_SERVER_ENABLED=true`, `API_SERVER_HOST=127.0.0.1`, `API_SERVER_PORT=8642` כברירת מחדל, `API_SERVER_KEY` נפרד. gateway צריך לפעול באותו profile; שינוי דורש restart. לבצע רק במסגרת setup עתידי מאושר.
- `Authorization: Bearer <API_SERVER_KEY>` לנתיבים המוגנים. זהו secret לחיבור ל־Hermes, **לא** מפתח OpenAI/Anthropic. לא לשים אותו בארגומנט shell, URL, renderer state או logs; אם Pet שומר אותו, `safeStorage` ב־main, fail-closed ללא הצפנה.
- בדיקות ללא inference: `GET /health` (liveness), `GET /v1/models` עם auth, ובהתקנות התומכות `GET /v1/capabilities`. health אינו מוכיח הרשאות ספק או יכולת הפקת תשובה.
- API בסיסי: `POST /v1/chat/completions` עם `model`, `messages`, `stream`; streaming הוא SSE. `/v1/models` עשוי לפרסם alias של הסוכן/profile, לא קטלוג raw של ספק. `/v1/responses` תומך state דרך `previous_response_id`; אין להניח זהות מלאה לכל פרמטר OpenAI.
- בהתקנה המקומית capabilities מפרסם `/api/sessions`, `/api/sessions/{session_id}/chat/stream`, `/v1/runs`, `/v1/runs/{run_id}/events`, `/approval`, `/stop`, `/steer` ו־`/api/model/options`. תכנון לקוח HTTP מלא צריך להשתמש ביכולות אלו לאישורים ולא להסתפק ב־Chat Completions שמסתיר את lifecycle. יש להשלים בדיקת payload schemas לפני מימוש; זמינותן אינה מובטחת בגרסאות ישנות.
- `X-Hermes-Session-Id` ממשיך היסטוריה מ־state.db; `X-Hermes-Session-Key` הוא מפתח channel/memory נפרד ויציב, לא session transcript. כאשר נעזרים בהמשכיות server-side, אין לשלוח שוב היסטוריה מלאה. ללא session ID הקוד מסוגל לגזור ID מטביעת system/הודעת משתמש ראשונה — לא רצוי כמפתח פרויקט של Pet.
- הנתיבים החדשים צריכים capability negotiation. ל־gateway מרובה profiles קיימת תמיכה בקוד ב־`/p/<profile>/...` עם auth פרופיל־ספציפי; ב־MVP עדיף profile יחיד שנבחר במפורש.
- main עושה HTTP; אין צורך לפתוח CORS ל־renderer. להשאיר loopback בלבד ולדחות redirect/remote URL כברירת מחדל. חיבור מרוחק מחייב תכנון TLS והרשאות נפרד; הכלים רצים על **מחשב שרת Hermes**, לא על הלקוח.
- key מעניק גישה לסוכן, לא רק לשיחת LLM. local HTTP אינו תחליף למודל אישורים או בידוד.

## ספקים, OAuth ומנויים — מה מותר להבטיח

הטבלה משקפת את תיעוד Hermes החי [3], לא בדיקת entitlement של חשבון כלשהו. התנהגות חיוב וזמינות עשויות להשתנות; יש להפנות ל־dashboard ולתנאי הספק.

| מסלול | תמיכה מתועדת | מגבלת ההבטחה במוצר |
|---|---|---|
| OpenAI API | `openai-api`, מפתח API | חיוב API נפרד; מנוי ChatGPT אינו מפתח API. |
| ChatGPT / Codex | `openai-codex`, OAuth דרך Hermes; ללא צורך בהתקנת Codex CLI | משתמש במודלי Codex. תיעוד Hermes אומר במפורש שזכאות tiers ואופן ניכוי quota אינם מתועדים במלואם; לא להבטיח כל מנוי או שימוש בלתי מוגבל. |
| Anthropic API | מפתח API, API מקורי של Anthropic | חיוב לפי ארגון/מפתח, בנפרד ממנוי Claude. |
| Claude OAuth | לפי התיעוד: Claude Max **עם extra usage credits שנרכשו** | Hermes מחייב extra/overage credits, לא הקצאת הבסיס של Max. Claude Pro אינו נתמך במסלול זה. |
| Nous Portal | OAuth, מנוי Nous, מודלים ו־Tool Gateway נתמכים | מנוי Nous אמיתי עם תנאיו; אין בכך hosted API ציבורי של agent. |
| GitHub Copilot | provider `copilot`, OAuth device flow/סוגי token נתמכים; או `copilot-acp` עם CLI מחובר | זכאות ותמחור לפי Copilot. classic PAT אינו נתמך; לא כל token של GitHub מתאים. |
| Gemini | `gemini` עם API key; Vertex עם GCP billing | אין מסלול מתועד לצריכת מנוי Google AI Pro/Ultra. OAuth של Vertex הוא auth ל־GCP, לא מנוי צרכני. |
| xAI | API key או `xai-oauth` למנויים נתמכים | login מוצלח יכול עדיין להסתיים ב־403 בגלל tier; מכסת inference מעבר לפרטים מסוימים אינה מתועדת במלואה. |
| OpenRouter | API key או OAuth PKCE שמייצר/שומר key | OAuth הוא שיטת חיבור, אינו הבטחה למכסת מנוי צרכני או חיוב אפס. |
| אחרים/מקומיים | בין היתר Qwen OAuth, MiniMax OAuth, Ollama/LM Studio ו־custom endpoints | לחשוף רק מה שההתקנה מפרסמת ומה שהמשתמש הגדיר; אין ״מפתח אחד לכל הפרוטוקולים״. |

ב־Codex ברירת המחדל המתועדת היא device code. browser PKCE הוא מסלול אופציונלי עם callback קבוע `http://localhost:1455/auth/callback`; התנגשות פורט וטיפול refresh הם באחריות Hermes, לא callback server חדש של Pet. אין לאסוף cookies או לשאול לסיסמת ChatGPT.

**UX מומלץ:** שתי אפשרויות נפרדות: ״Hermes המקומי שלי״ ו־״API ישיר (אופציונלי)״. ב־Hermes להציג provider/model בפועל, והסבר auth/billing שאינו מתחייב מעבר לנתונים. אין לבחור ״מנוי״ רק לפי שם מודל. תור סוכן עשוי לכלול כמה קריאות, compression, auxiliary models ושירותי כלים; counters של tokens אינם חשבונית ואינם quota מוסמך. אין fallback אוטומטי ממנוי ל־API מחייב ללא הסכמה.

## API ישיר אופציונלי

להשאיר את OpenAI הקיים כ־adapter עצמאי. אם מוסיפים ספקים, כל אחד צריך auth, endpoint, request schema, model catalog ו־error handling תואמים: Anthropic Messages אינו OpenAI Chat Completions, Gemini שונה, וגם ספקים OpenAI-compatible יכולים לדרוש Responses או headers מיוחדים. OAuth צרכני של Hermes אינו secret שניתן לשאוב לשימוש direct. שינוי המודל דרך Pet במסלול Hermes צריך לעבור דרך פרוטוקול session של Hermes.

## Windows והפצה

- התיעוד העדכני [4] כולל native Windows 10/11 x86_64/aarch64; לא נכון לומר ש־WSL הוא הדרך היחידה. MSIX דורש Windows 11 22H2 ומעלה; optional dependencies מוגבלות לפי ארכיטקטורה. יש installer רשמי `install.ps1` וגם Desktop.
- bundle Electron portable אינו כולל Hermes/ACP אוטומטית. נדרש onboarding להתקנה רשמית, dependency check ובחירת launcher; לא `pip install hermes-agent` כדרך הפצה, המסומנת unsupported בתיעוד.
- לבדוק executable/launcher אמיתי ב־Windows; `spawn` ללא shell מתאים ל־exe, אך קובצי `.cmd`/`.ps1` דורשים טיפול ייעודי ובטוח. אין להניח שנתיב POSIX או arguments של shell יפעלו.
- לבדוק UTF-8/עברית, paths עם רווחים, home/profile נכון, logout/refresh, process-tree cleanup, sleep/wake ותהליך יתום. לא להפעיל כמנהל מערכת כברירת מחדל; POSIX `0600` אינו תחליף ל־ACL/DPAPI.
- אם בוחרים WSL2, Hermes והכלים רצים בתוך Linux, ומסלולים צריכים המרה מפורשת; אין להבטיח desktop automation native של Windows. gateway daemon ב־WSL דורש בדיקת lifecycle/systemd. ACP child אינו דורש daemon.
- `README.md` מציין שה־EXE הקיים נבנה ב־macOS אך לא הורץ ב־Windows ואינו חתום. נדרשים Windows אמיתי, חתימה/SmartScreen לפי מדיניות ארגונית, ובדיקות ACP גם מחוץ לטרמינל.

## תוכנית יישום לאחר אישור — ללא שינוי קוד בשלב זה

1. להגדיר interface של backend ב־main: status/connect/new/load/send/cancel/model-selection ו־event stream; ליצור adapters נפרדים ל־Hermes ACP ול־OpenAI direct. API Server כשלב משני.
2. להוסיף migration ל־Store: מיפוי sessions, מצב turn `running/completed/cancelled/failed/unknown`, cache ומזהה חיבור. כשל transport אינו מוחק הישגים של סוכן ואינו גורר replay אוטומטי.
3. להרחיב preload ברשימת פעולות/events סגורה עם אימות sender/project/session; לא IPC גנרי. לשמור CSP וחסימת רשת renderer. להוסיף UI לאישורים, פעילות כלים, Stop וחיבור profile/model.
4. setup ראשוני: גילוי Hermes, `--check`, profile/workspace, מדיניות הרשאות מאושרת, setup provider ב־Hermes, handshake. לא לשנות פרופיל פעיל, gateway או credentials בהתקנה אחרת.
5. acceptance tests: framing מפוצל/עברית, auth חסר, initialize בגרסאות שונות, stream לפני load response, persistence אחרי restart, הפרדת פרויקטים/profiles, אישור/דחייה/timeout/option ID זר, ביטול, child crash, quota error, model change, מסמך זדוני, renderer IPC לא מורשה והעדר credentials בלוגים. בדיקות פרוטוקול מדומות מסומנות ככאלה.
6. בדיקת E2E אמיתית על profile ניסוי ייעודי ובעלות מאושרת: תשובה, פעולה בטוחה עם אישור, דחיית פעולה, ביטול ושחזור. לאחר מכן אותו תרחיש על Windows אמיתי. אין להכריז ״מחובר ועובד״ על בסיס `--check` בלבד.

## מקורות

[1] ACP Host Integration — https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/  
[2] API Server / Open WebUI — https://hermes-agent.nousresearch.com/docs/user-guide/messaging/open-webui/  
[3] LLM and Model Providers; במיוחד Subscription plans — https://hermes-agent.nousresearch.com/docs/integrations/providers/  
[4] Platform Support — https://hermes-agent.nousresearch.com/docs/getting-started/platform-support/  
[5] אתר תיעוד ראשי — https://hermes-agent.nousresearch.com/docs

הקוד המקומי שנקרא נמצא תחת:
`/Users/simplevaad/.hermes/installs/56b0687101cf34d2/environments/9a8c26a11bc5432da95ea98bd625e8de/workspace/`

- `acp_adapter/entry.py`: stdio, logging, setup/check; `auth.py`: methods ו־hermes-setup.
- `acp_adapter/server.py`: initialize, session lifecycle, model selection, edit modes, permission callback.
- `acp_adapter/permissions.py`: stable option IDs, scope, timeout, deny-on-error.
- `acp_adapter/session.py`: toolsets ו־provider runtime resolution.
- `gateway/platforms/api_server.py`: capabilities/endpoints ו־Bearer auth.
- `gateway/platforms/api_server_openai_routes.py`: session headers, history ו־streaming approval bridge.
- SDK סמוך ב־`venv/lib/python3.14/site-packages/acp/meta.py` ו־`connection.py`: protocol version ו־JSON-line receive loop.

המסמך הוא הצעת יישום מבוססת תיעוד וקוד, לא אישור הפצה ולא בדיקת ספק בתשלום. השינוי היחיד בפרויקט במסגרת משימה זו הוא מסמך זה.
