"use strict";
const $ = (id) => document.getElementById(id);
const api = window.adactive;
// Test-only legacy configuration fixture: never loaded in production.
for (const id of ["options-toggle", "chat-model-toggle"]) {
  if ($(id)) $(id).hidden = false;
}
let current = null,
  busy = false,
  dirty = false,
  connected = false,
  connectingNow = false,
  openingSettings = false,
  wpConnected = false,
  connectionMeta = {},
  modelDraft = null,
  modelChoice = null,
  discoveryEpoch = 0,
  discoveryTimer = null,
  discoveryCancellation = Promise.resolve();
const notify = (message) => {
  $("notice").textContent = message;
};
function setBusy(value) {
  busy = value;
  for (const id of [
    "composer",
    "context",
    "rules",
    "documents",
    "save-context",
    "send",
    "projects",
    "new-project",
    "connection",
    "chat-model-toggle",
    "apply-model",
    "manage-models",
    "disconnect",
    "empty-connect",
  ]) {
    if ($(id)) $(id).disabled = value;
  }
  $("disconnect").disabled = value || !connected;
  $("chat-panel").setAttribute("aria-busy", String(value));
}
function render(state) {
  current = state.project;
  wpConnected = !!state.wordpress?.connected;
  $("wordpress-status").textContent = wpConnected
    ? `WordPress מחובר · אומת בעבר: ${state.wordpress.site}`
    : "WordPress לא מחובר";
  $("wp-disconnect").disabled = !wpConnected;
  $("wp-site").value = state.wordpress?.site || "";
  $("wp-username").value = "";
  $("wp-password").value = "";
  $("wp-project").textContent = `פרויקט: ${current.name}`;
  const select = $("projects");
  select.replaceChildren(
    ...state.projects.map((p) => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      return o;
    }),
  );
  select.value = current.id;
  for (const k of ["context", "rules", "documents"]) $(k).value = current[k];
  dirty = false;
  connection(state.connection);
  renderMessages();
}
function connection(c) {
  connected = c.connected;
  connectionMeta = c;
  updateProviderControls();
  renderSavedModels();
  $("chat-model-toggle").textContent = c.connected
    ? `${c.model} ▾`
    : "בחירת מודל ▾";
  $("connection-status").textContent = c.connected
    ? `${c.provider} · ${c.model}`
    : c.legacyDisabled
      ? "אין מודל מחובר · חיבור Hermes הישן מושבת"
      : "אין מודל מחובר";
  $("connection").classList.toggle("connected", c.connected);
  $("disconnect").disabled = !c.connected;
  if (current) renderMessages();
}
function renderMessages() {
  const el = $("messages");
  el.hidden = !current.messages.length;
  el.replaceChildren(
    ...current.messages.map((m) => {
      const div = document.createElement("article");
      div.className = "bubble " + m.role;
      const label = document.createElement("span");
      label.className = "role";
      label.textContent = m.role === "user" ? "את/ה" : "ADActive · תשובת המודל";
      const body = document.createElement("p");
      body.textContent = m.content;
      div.append(label, body);
      return div;
    }),
  );
  el.scrollTop = el.scrollHeight;
}

function clearSecrets() {
  $("api-key").value = "";
  $("wp-password").value = "";
  resetModels();
}
async function openConnect() {
  if (openingSettings || $("connect-dialog").open) return;
  if (!api) {
    notify("תצוגה מקדימה בלבד. פתחו את אפליקציית Electron לחיבור מאובטח.");
    return;
  }
  clearSecrets();
  $("connect-error").textContent = "";
  $("wp-result").textContent = wpConnected
    ? "חיבור שנשמר לאחר אימות קודם. הבדיקה אינה מתבצעת ברקע."
    : "בדיקת קריאה בלבד. אין שינוי בתוכן האתר.";
  openingSettings = true;
  options(false);
  try {
    await api.chatSurface?.("settings");
    lastSurface = "settings";
    $("connect-dialog").showModal();
    scheduleModels();
    $("wp-site").focus({ preventScroll: true });
    $("connect-dialog").scrollTop = 0;
  } catch (error) {
    notify(error.message);
  } finally {
    openingSettings = false;
    syncSurface();
  }
}
$("connection").onclick = openConnect;

$("cancel-connect").onclick = () => {
  clearSecrets();
  $("connect-dialog").close();
};
$("connect-dialog").addEventListener("close", clearSecrets);
$("connect-dialog").addEventListener("cancel", (e) => {
  if (connectingNow) e.preventDefault();
  else clearSecrets();
});
function setupBusy(value) {
  connectingNow = value;
  for (const id of [
    "wp-site",
    "wp-username",
    "wp-password",
    "wp-test",
    "wp-disconnect",
    "api-key",
    "provider",
    "provider-region",
    "load-models",
    "model-search",
    "model",
    "confirm-connect",
    "disconnect",
    "cancel-connect",
  ])
    $(id).disabled = value;
  if (!value) {
    $("wp-disconnect").disabled = !wpConnected;
    $("disconnect").disabled = !connected;
  }
}
$("wp-form").onsubmit = async (e) => {
  e.preventDefault();
  if (connectingNow) return;
  let password = $("wp-password").value;
  const args = {
    id: current.id,
    site: $("wp-site").value,
    username: $("wp-username").value,
    password,
  };
  $("wp-password").value = "";
  setupBusy(true);
  $("wp-result").textContent = "בודק חיבור לקריאה בלבד…";
  try {
    const state = await api.connectWordPress(args);
    // Only redacted connection metadata returns from main. Do not overwrite unsaved context.
    wpConnected = state.wordpress.connected;
    $("wordpress-status").textContent =
      `WordPress מחובר · אומת: ${state.wordpress.site}`;
    $("wp-result").textContent =
      "החיבור אומת ונשמר מוצפן לפרויקט. לא בוצע שינוי בתוכן האתר.";
  } catch (error) {
    $("wp-result").textContent = error.message;
  } finally {
    password = "";
    args.password = "";
    setupBusy(false);
  }
};
$("wp-disconnect").onclick = async () => {
  if (connectingNow) return;
  setupBusy(true);
  try {
    await api.disconnectWordPress(current.id);
    wpConnected = false;
    $("wordpress-status").textContent = "WordPress לא מחובר";
    $("wp-result").textContent =
      "הפרטים השמורים לפרויקט נמחקו. לביטול הסיסמה באתר, בטלו אותה בפרופיל WordPress.";
    $("wp-site").value = "";
    $("wp-username").value = "";
    $("wp-password").value = "";
  } catch (error) {
    $("wp-result").textContent = error.message;
  } finally {
    setupBusy(false);
  }
};
$("connect-form").onsubmit = (e) => e.preventDefault();
$("confirm-connect").onclick = async () => {
  if (connectingNow) return;
  if (
    !$("connect-dialog").open ||
    !modelDraft ||
    !modelDraft.models.some((m) => m.id === $("model").value)
  ) {
    $("connect-error").textContent = "בחרו מודל מהרשימה כדי להתחבר";
    return;
  }
  const model = $("model").value;
  setupBusy(true);
  $("connect-error").textContent = "בודק מודל…";
  try {
    connection(
      await api.connect({ token: modelDraft.token, model, consent: true }),
    );
    resetModels();
    $("connect-error").textContent = "המודל אומת ונשמר. חיבור WordPress נפרד.";
  } catch (error) {
    $("connect-error").textContent = error.message;
  } finally {
    setupBusy(false);
  }
};
function tab(inspect) {
  $("chat-panel").hidden = inspect;
  $("inspect-panel").hidden = !inspect;
  $("chat-tab").setAttribute("aria-selected", String(!inspect));
  $("inspect-tab").setAttribute("aria-selected", String(inspect));
  options(false);
}
$("chat-tab").onclick = () => tab(false);
$("back-chat").onclick = () => {
  tab(false);
  $("composer").focus();
};
$("inspect-tab").onclick = () => tab(true);
for (const k of ["context", "rules", "documents"])
  $(k).oninput = () => {
    dirty = true;
    $("save-status").textContent = "שינויים עדיין לא נשמרו";
  };
async function save() {
  if (!api || !current) throw new Error("שמירה זמינה באפליקציית Electron בלבד");
  const state = await api.save({
    id: current.id,
    context: $("context").value,
    rules: $("rules").value,
    documents: $("documents").value,
  });
  current = state.project;
  dirty = false;
  $("save-status").textContent = "ההקשר והכללים נשמרו מקומית";
  notify("ההקשר נשמר");
}
$("context-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await save();
  } catch (error) {
    $("save-status").textContent = error.message;
  }
};
$("projects").onchange = async () => {
  const id = $("projects").value;
  try {
    if (dirty) await save();
    render(await api.state(id));
    notify("");
  } catch (error) {
    notify(error.message);
    $("projects").value = current.id;
  }
};
$("new-project").onclick = () => {
  if (!api) {
    notify("יצירת פרויקט זמינה באפליקציה בלבד");
    return;
  }
  $("project-dialog").showModal();
  $("project-name").focus();
};
$("cancel-project").onclick = () => $("project-dialog").close();
$("project-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    if (dirty) await save();
    render(await api.create($("project-name").value));
    $("project-name").value = "";
    $("project-dialog").close();
    notify("הפרויקט נוצר. ההקשר והשיחה שלו נפרדים.");
  } catch (error) {
    $("project-dialog").close();
    notify(error.message);
  }
};
$("disconnect").onclick = async () => {
  try {
    connection(await api.disconnect());
    notify(
      "הספק הפעיל נותק והמפתח שלו נמחק. ספקים אחרים, WordPress והשיחות לא שונו.",
    );
  } catch (error) {
    notify(error.message);
  }
};
$("hide").onclick = () =>
  api ? api.hide() : notify("זוהי תצוגה מקדימה בדפדפן");
$("chat-form").onsubmit = async (e) => {
  e.preventDefault();
  if (busy) return;
  if (!api) {
    notify("תצוגה מקדימה בלבד — אין מודל מחובר ואין בקשת AI.");
    return;
  }
  const message = $("composer").value;
  if (!message.trim()) return;
  setBusy(true);
  notify("");
  try {
    if (dirty) await save();
    notify("בודק את הבקשה…");
    const response = await api.send({ id: current.id, message });
    notify("");
    if (response.action === "connect") {
      await openConnect();
    } else {
      render(response);
      $("composer").value = "";
    }
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(false);
    if (!document.querySelector("dialog[open]")) $("composer").focus();
  }
};
$("composer").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("chat-form").requestSubmit();
  }
};
function resetModels() {
  ++discoveryEpoch;
  clearTimeout(discoveryTimer);
  discoveryTimer = null;
  modelDraft = null;
  $("load-models").hidden = true;
  $("load-models").disabled = false;
  $("model-picker").setAttribute("aria-busy", "false");
  $("connect-error").textContent = "";
  $("model").replaceChildren();
  $("model-summary").textContent = "בחירת מודל ▾";
  $("model-search").value = "";
  $("model-picker").open = false;
  $("models-note").textContent =
    "המודלים נטענים אוטומטית עם מפתח API, ללא בקשת יצירה.";
  discoveryCancellation =
    api?.cancelModels().catch(() => {}) || Promise.resolve();
}
function updateProviderControls() {
  const previous = $("provider").value;
  $("provider").replaceChildren(
    ...(connectionMeta.providers || []).map((p) => new Option(p.label, p.id)),
  );
  if (previous) $("provider").value = previous;
  if (!$("provider").value && connectionMeta.providerId)
    $("provider").value = connectionMeta.providerId;
  const p = connectionMeta.providers?.find((p) => p.id === $("provider").value);
  $("region-label").hidden = !p?.regions.length;
  $("provider-region").replaceChildren(
    ...(p?.regions || []).map((r) => new Option(r.label, r.id)),
  );
  const saved = connectionMeta.saved?.some(
    (r) => r.provider === p?.id && r.region === $("provider-region").value,
  );
  $("provider-note").textContent =
    (saved
      ? "מפתח מוצפן שמור. השאירו ריק לשימוש בו, או הזינו מפתח להחלפה. "
      : "אין מפתח שמור לספק הזה. ") +
    (p?.id === "qwen"
      ? "Qwen: Singapore בלבד, לא Coding Plan. אזורים אחרים עדיין אינם נתמכים."
      : p?.id === "moonshot"
        ? "Kimi: פלטפורמה בינלאומית moonshot.ai בלבד, לא Kimi Code / חשבון סין."
        : "API ישיר בלבד; אין שימוש במנוי הצ׳אט.");
}
$("provider").onchange = () => {
  $("api-key").value = "";
  resetModels();
  updateProviderControls();
  scheduleModels();
};
$("provider-region").onchange = () => {
  $("api-key").value = "";
  resetModels();
  scheduleModels();
};
$("api-key").oninput = () => {
  resetModels();
  scheduleModels();
};
function hasDiscoveryCredential() {
  return (
    !!$("api-key").value.trim() ||
    connectionMeta.saved?.some(
      (r) =>
        r.provider === $("provider").value &&
        r.region === $("provider-region").value,
    )
  );
}
function scheduleModels() {
  if (!api || !$("connect-dialog").open || !hasDiscoveryCredential()) return;
  $("models-note").textContent = "הרשימה תיטען אוטומטית… ללא בקשת יצירה.";
  discoveryTimer = setTimeout(discoverModels, 800);
}
function filterModels() {
  const q = $("model-search").value.toLowerCase();
  const previous = $("model").value;
  $("model").replaceChildren(
    ...(modelDraft?.models || [])
      .filter((m) => `${m.label} ${m.id}`.toLowerCase().includes(q))
      .map(
        (m) =>
          new Option(m.label === m.id ? m.id : `${m.label} · ${m.id}`, m.id),
      ),
  );
  if ([...$("model").options].some((o) => o.value === previous))
    $("model").value = previous;
  else $("model").selectedIndex = -1;
  $("model-summary").textContent =
    $("model").value ||
    ($("model").options.length ? "בחירת מודל ▾" : "אין תוצאות");
}
$("model-search").oninput = filterModels;
$("model").onchange = () => {
  $("model-summary").textContent = $("model").value;
};
async function discoverModels() {
  clearTimeout(discoveryTimer);
  if (
    connectingNow ||
    !api ||
    !$("connect-dialog").open ||
    !hasDiscoveryCredential()
  )
    return;
  const epoch = discoveryEpoch;
  const args = {
    provider: $("provider").value,
    region: $("provider-region").value,
    key: $("api-key").value.trim(),
  };
  const active = () => epoch === discoveryEpoch && $("connect-dialog").open;
  $("load-models").hidden = true;
  $("model-picker").setAttribute("aria-busy", "true");
  $("models-note").textContent = "טוען מודלים מהספק… ללא בקשת יצירה.";
  $("connect-error").textContent = "";
  try {
    // A prior reset must finish cancelling before a new main-process draft is created.
    await discoveryCancellation;
    if (!active()) return;
    const result = await api.discoverModels(args);
    if (!active()) return;
    modelDraft = result;
    $("api-key").value = "";
    $("models-note").textContent = modelDraft.note;
    $("model-search").value = "";
    filterModels();
    $("model-picker").open = true;
    $("connect-error").textContent = "בחרו מודל ואז לחצו על חיבור מודל.";
  } catch (error) {
    if (!active()) return;
    modelDraft = null;
    $("connect-error").textContent = error.message;
    $("models-note").textContent =
      "לא ניתן לטעון את הרשימה. בדקו את המפתח ונסו שוב.";
    $("model").replaceChildren();
    $("load-models").hidden = false;
  } finally {
    args.key = "";
    if (active()) $("model-picker").setAttribute("aria-busy", "false");
  }
}
$("load-models").onclick = () => {
  resetModels();
  discoverModels();
};
function modelMenu(open) {
  $("chat-model-menu").hidden = !open;
  if (open) options(false);
  $("chat-model-toggle").setAttribute("aria-expanded", String(open));
  if (open) {
    modelChoice = null;
    renderSavedModels();
    $("chat-model-search").focus();
  }
}
function renderSavedModels() {
  const q = $("chat-model-search").value.toLowerCase();
  const buttons = [];
  for (const r of connectionMeta.saved || [])
    for (const model of r.models) {
      const label = `${r.label} · ${model}`;
      if (!label.toLowerCase().includes(q)) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.dir = "auto";
      b.setAttribute(
        "aria-pressed",
        String(modelChoice?.slot === r.slot && modelChoice?.model === model),
      );
      b.onclick = () => {
        if (busy) return;
        modelChoice = { slot: r.slot, model };
        renderSavedModels();
      };
      buttons.push(b);
    }
  $("saved-models").replaceChildren(...buttons);
  if (!buttons.length)
    $("saved-models").textContent = "אין מודלים שמורים המתאימים לחיפוש";
  $("apply-model").disabled = !modelChoice || busy;
}
$("chat-model-toggle").onclick = () => modelMenu($("chat-model-menu").hidden);
$("chat-model-search").oninput = () => {
  modelChoice = null;
  renderSavedModels();
};
$("chat-model-menu").onkeydown = (e) => {
  if (e.key === "Escape") {
    e.stopPropagation();
    modelMenu(false);
    $("options-toggle").focus();
  }
};
$("manage-models").onclick = async () => {
  modelMenu(false);
  await openConnect();
  $("model-title").scrollIntoView();
  $("provider").focus();
};
$("apply-model").onclick = async () => {
  if (!modelChoice || busy) return;
  setBusy(true);
  try {
    connection(await api.selectModel({ ...modelChoice, consent: true }));
    modelMenu(false);
    notify("המודל הוחלף. לא נשלחה בקשת AI.");
  } catch (e) {
    notify(e.message);
  } finally {
    setBusy(false);
  }
};
function options(open) {
  $("options-panel").hidden = !open;
  $("options-toggle").setAttribute("aria-expanded", String(open));
}
$("options-toggle").onclick = () => options($("options-panel").hidden);
let lastSurface;
function syncSurface() {
  const multiline = $("composer").value.includes("\n");
  $("composer").classList.toggle("multiline", multiline);
  const surface =
    openingSettings || document.querySelector("dialog[open]")
      ? "settings"
      : !$("inspect-panel").hidden
        ? "inspect"
        : !$("options-panel").hidden || !$("chat-model-menu").hidden
          ? "menu"
          : current?.messages.length
            ? "conversation"
            : multiline
              ? "multiline"
              : $("notice").textContent
                ? "notice"
                : "compact";
  if (surface === lastSurface) return;
  lastSurface = surface;
  api?.chatSurface?.(surface).catch(() => {});
}
new MutationObserver(syncSurface).observe(document.body, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["hidden", "open"],
});
$("composer").addEventListener("input", syncSurface);
function focusComposer() {
  if (!document.querySelector("dialog[open]")) {
    tab(false);
    modelMenu(false);
    $("composer").focus();
  }
}
api?.onShow?.(focusComposer);
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  // Native modal cancellation closes only the uppermost dialog first.
  if (document.querySelector("dialog[open]")) return;
  event.preventDefault();
  if (!$("chat-model-menu").hidden) modelMenu(false);
  else if (!$("options-panel").hidden) options(false);
  else if (!$("inspect-panel").hidden) tab(false);
  else api?.hide();
});
for (const dialog of document.querySelectorAll("dialog"))
  dialog.addEventListener("close", () => {
    syncSurface();
    $("composer").focus();
  });
syncSurface();
if (api) {
  api
    .state()
    .then(render)
    .catch((e) => notify(e.message));
} else {
  const o = document.createElement("option");
  o.textContent = "הסטודיו שלי";
  $("projects").append(o);
  notify("תצוגה מקדימה · להפעלה מלאה השתמש ב־npm start");
  $("disconnect").disabled = true;
}
