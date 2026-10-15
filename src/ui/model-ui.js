"use strict";
(() => {
  const $ = (id) => document.getElementById(id),
    api = window.adactive;
  let providers = [],
    models = [],
    token = null,
    epoch = 0,
    timer,
    busy = false;

  const HELP_GUIDES = {
    gemini: [
      "כניסה ל-Google AI Studio (עמוד המפתחות) והתחברות עם חשבון Google.",
      "לחיצה על Create API key (בפרויקט חדש או קיים).",
      "העתקת המפתח שנוצר (מתחיל ב-AIza...) והדבקתו כאן.",
    ],
    openai: [
      "כניסה לעמוד API keys ב-OpenAI Platform והתחברות לחשבון.",
      "לחיצה על Create new secret key והזנת שם למפתח.",
      "העתקת המפתח שנוצר (מתחיל ב-sk-...) והדבקתו כאן.",
    ],
    anthropic: [
      "כניסה ל-Anthropic Console (עמוד Keys) והתחברות לחשבון.",
      "לחיצה על Create Key והזנת שם למפתח.",
      "העתקת המפתח שנוצר (מתחיל ב-sk-ant-...) והדבקתו כאן.",
    ],
    moonshot: [
      "כניסה ל-Moonshot Open Platform הבינלאומי והתחברות לחשבון.",
      "מעבר אל API Keys ולחיצה על + New Key.",
      "העתקת המפתח שנוצר והדבקתו כאן.",
    ],
    qwen: [
      "כניסה ל-Alibaba Cloud Model Studio (יש לוודא אזור Singapore).",
      "מעבר לתפריט API-KEY ולחיצה על Create API Key.",
      "העתקת המפתח שנוצר והדבקתו כאן.",
    ],
  };

  const updateHelp = () => {
    const providerId = $("provider").value || "gemini";
    const steps = HELP_GUIDES[providerId] || HELP_GUIDES.gemini;
    $("help-step-1").textContent = steps[0];
    $("help-step-2").textContent = steps[1];
    $("help-step-3").textContent = steps[2];
  };
  const renderModels = () => {
    const query = $("model-search").value.toLowerCase();
    $("model").replaceChildren(
      ...models
        .filter((m) => (m.id + " " + m.label).toLowerCase().includes(query))
        .map((m) => new Option(m.label, m.id)),
    );
    $("model").selectedIndex = -1;
    $("connect-model").disabled = true;
  };
  const invalidate = () => {
    epoch++;
    clearTimeout(timer);
    token = null;
    models = [];
    renderModels();
    $("picker").setAttribute("aria-busy", "false");
    return api?.cancelModels().catch(() => {});
  };
  const regions = () => {
    const list =
      providers.find((p) => p.id === $("provider").value)?.regions || [];
    $("region").replaceChildren(...list.map((r) => new Option(r.label, r.id)));
    $("region-row").hidden = !list.length;
  };
  const reset = async () => {
    const cancellation = invalidate(),
      attempt = epoch;
    $("api-key").value = "";
    $("model-search").value = "";
    $("result").textContent =
      "הזינו מפתח חדש — הרשימה תיטען אוטומטית, ללא בדיקת AI.";
    if (!api) return;
    await cancellation;
    try {
      const state = await api.modelState();
      if (attempt !== epoch) return;
      providers = state.providers;
      $("provider").replaceChildren(
        ...providers.map((p) => new Option(p.label, p.id)),
      );
      $("provider").value = "gemini";
      regions();
      updateHelp();
      $("active").textContent = state.connected
        ? `חיבור פעיל: ${state.provider} · ${state.model}. לא ישתנה עד לבדיקה מוצלחת.`
        : "החיבור הקיים לא משתנה עד לבדיקה מוצלחת.";
      $("api-key").focus();
    } catch {
      $("result").textContent = "לא ניתן לקרוא את מצב החיבור.";
    }
  };
  const discover = async (attempt, cancellation) => {
    await cancellation;
    if (attempt !== epoch || busy || !$("api-key").value.trim()) return;
    const candidate = {
      provider: $("provider").value,
      region: $("region").value || "",
      key: $("api-key").value.trim(),
    };
    $("api-key").value = "";
    $("picker").setAttribute("aria-busy", "true");
    $("result").textContent = "טוען רשימת מודלים מהספק… ללא בדיקת AI.";
    try {
      const result = await api.discoverModels(candidate);
      if (attempt !== epoch) return;
      token = result.token;
      models = result.models;
      renderModels();
      $("result").textContent =
        "בחרו מודל מהרשימה. החיבור יאומת רק בלחיצה על חיבור מודל.";
    } catch (error) {
      if (attempt === epoch)
        $("result").textContent =
          error.message + " הזינו מחדש את המפתח כדי לנסות שוב.";
    } finally {
      candidate.key = "";
      if (attempt === epoch) $("picker").setAttribute("aria-busy", "false");
    }
  };
  $("api-key").oninput = () => {
    const cancellation = invalidate(),
      attempt = epoch;
    if (api && $("api-key").value.trim())
      timer = setTimeout(() => discover(attempt, cancellation), 800);
  };
  const changeProvider = () => {
    invalidate();
    $("api-key").value = "";
    $("model-search").value = "";
    $("result").textContent = "הזינו מפתח חדש לספק ולאזור שנבחרו.";
  };
  $("provider").onchange = () => {
    changeProvider();
    regions();
    updateHelp();
  };
  $("region").onchange = changeProvider;
  $("model-search").oninput = renderModels;
  $("model").onchange = () => {
    $("connect-model").disabled = busy || !token || !$("model").value;
  };
  $("model-form").onsubmit = (e) => e.preventDefault();
  const close = () => {
    invalidate();
    $("api-key").value = "";
    api?.closeModel();
  };
  $("close-model").onclick = close;
  $("open-key-page").onclick = async () => {
    const providerId = $("provider").value;
    if (!providerId || !api?.openKeyPage) return;
    try {
      await api.openKeyPage(providerId);
    } catch (error) {
      $("result").textContent = error.message;
    }
  };
  window.onkeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
    if (e.key === "Enter" && e.target.tagName === "INPUT") e.preventDefault();
  };
  $("connect-model").onclick = async () => {
    if (busy || !token || !$("model").value) return;
    const attempt = epoch;
    busy = true;
    for (const id of [
      "provider",
      "region",
      "api-key",
      "model",
      "model-search",
      "connect-model",
      "open-key-page",
    ])
      $(id).disabled = true;
    $("result").textContent = "בודק חיבור למודל…";
    try {
      const state = await api.connect({
        token,
        model: $("model").value,
        consent: true,
      });
      if (attempt === epoch) {
        token = null;
        $("result").textContent = `מחובר · ${state.provider} · ${state.model}`;
        $("active").textContent = "המפתח נשמר מוצפן במחשב.";
      }
    } catch (error) {
      if (attempt === epoch) $("result").textContent = error.message;
    } finally {
      busy = false;
      $("api-key").value = "";
      for (const id of [
        "provider",
        "region",
        "api-key",
        "model",
        "model-search",
        "open-key-page",
      ])
        $(id).disabled = false;
      $("connect-model").disabled = !token || !$("model").value;
    }
  };
  updateHelp();
  api?.onModelReset(reset);
  window.addEventListener("beforeunload", () => {
    $("api-key").value = "";
    invalidate();
  });
  if (api) reset();
  else {
    $("api-key").disabled = true;
    $("open-key-page").disabled = true;
    $("result").textContent = "תצוגה מקדימה בלבד — אין להזין מפתח.";
  }
})();
