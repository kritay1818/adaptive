"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.adactive;
  let project,
    busy = false,
    epoch = 0;
  const reset = () => {
    epoch++;
    $("wp-password").value = "";
    $("wp-site").focus();
  };
  api?.onWordPressReset(reset);
  const close = () => {
    reset();
    api?.closeWordPress();
  };
  $("wp-close").onclick = close;
  // ---- guide: one step per screen, local images only ----
  const STEPS = [
    [
      "help/step1.png",
      "נכנסים לניהול האתר (wp-admin) ועוברים אל ״משתמשים״ ← ״פרופיל אישי״ (הכפתור ״פתיחת עמוד הסיסמאות באתר שלי״ פותח את העמוד הזה ישר).",
    ],
    [
      "help/step2.png",
      "בחלק ״סיסמאות אפליקציה״ כותבים שם לסיסמה, למשל ADActive, ולוחצים על ״Add Application Password״.",
    ],
    [
      "help/step3.png",
      "תופיע סיסמה בת 24 תווים עם רווחים. מעתיקים אותה — היא מוצגת פעם אחת בלבד.",
    ],
    [
      "help/step4.png",
      "מדביקים אותה כאן בשדה ״סיסמת יישום״, ואז לוחצים ״בדיקת חיבור״.",
    ],
  ];
  let step = 0;
  const guideOpen = () => !$("wp-guide").hidden;
  function showStep(index) {
    step = Math.max(0, Math.min(STEPS.length - 1, index));
    const img = $("guide-img");
    img.hidden = false;
    img.onerror = () => {
      img.hidden = true; // screenshot not available: the sentence below still explains the step
    };
    img.src = STEPS[step][0];
    img.alt = `שלב ${step + 1}`;
    $("guide-text").textContent = STEPS[step][1];
    $("guide-count").textContent = `${step + 1} מתוך ${STEPS.length}`;
    $("guide-back").disabled = step === 0;
    $("guide-next").disabled = step === STEPS.length - 1;
  }
  function openGuide() {
    document.querySelector("main").hidden = true;
    $("wp-guide").hidden = false;
    showStep(0);
    $("guide-next").focus();
  }
  function closeGuide() {
    $("wp-guide").hidden = true;
    document.querySelector("main").hidden = false;
    $("wp-password").focus();
  }
  $("guide-next").onclick = () => showStep(step + 1);
  $("guide-back").onclick = () => showStep(step - 1);
  $("guide-close").onclick = closeGuide;
  $("wp-guide-open").onclick = openGuide;
  $("wp-result-guide").onclick = openGuide;
  // ---- shortcut: open the Application Passwords section of the user's profile (main validates and builds the URL) ----
  const syncSiteButton = () => {
    $("wp-open-passwords").disabled = !$("wp-site").value.trim();
  };
  $("wp-site").addEventListener("input", syncSiteButton);
  $("wp-open-passwords").onclick = async () => {
    try {
      await api.openPasswordPage($("wp-site").value);
      $("wp-result").textContent =
        "נפתח עמוד הסיסמאות בדפדפן. יוצרים שם סיסמת יישום, מעתיקים אותה ומדביקים כאן.";
    } catch (error) {
      $("wp-result").textContent = error.message;
    }
  };
  // An application password is 24 letters/digits, usually shown in groups of four.
  const looksLikeAppPassword = (value) =>
    /^[A-Za-z0-9]{24}$/.test(value.replace(/\s+/g, ""));
  // The AI model (API key) has its own secure window; open it from here too.
  $("wp-open-model").onclick = () => api?.openModel().catch(() => {});
  window.onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (guideOpen()) closeGuide();
      else close();
    }
    if (event.key === "Enter" && event.target.tagName === "INPUT")
      event.preventDefault();
  };
  // Implicit form submission is never permission to authenticate.
  $("wp-form").onsubmit = (event) => event.preventDefault();
  $("wp-test").onclick = async () => {
    if (busy || !project || !api || !$("wp-form").reportValidity()) return;
    const candidate = {
      site: $("wp-site").value,
      username: $("wp-username").value,
      password: $("wp-password").value,
    };
    $("wp-password").value = "";
    busy = true;
    $("wp-test").disabled = true;
    const attempt = epoch;
    $("wp-result").textContent = "בודק חיבור בקריאה בלבד…";
    $("wp-result-guide").hidden = true;
    const typedPassword = candidate.password;
    try {
      const state = await api.testWordPress(candidate);
      if (attempt === epoch)
        $("wp-result").textContent = `המשתמש אומת · ${state.wordpress.site}`;
    } catch (error) {
      if (attempt === epoch) {
        // Authentication failed with something that is not shaped like an application password: most likely the normal login password.
        const wrongKind =
          /האימות נכשל/.test(error.message) &&
          !looksLikeAppPassword(typedPassword);
        $("wp-result").textContent = wrongKind
          ? "נראה שזו סיסמת הכניסה הרגילה — צריך סיסמת יישום."
          : error.message;
        $("wp-result-guide").hidden = !wrongKind;
      }
    } finally {
      candidate.password = "";
      busy = false;
      $("wp-test").disabled = false;
    }
  };
  syncSiteButton();
  if (api)
    api
      .wordPressState()
      .then((state) => {
        project = state.project;
        $("wp-project").textContent = `פרויקט: ${project.name}`;
        $("wp-site").value = state.wordpress.site || "";
        syncSiteButton();
        $("wp-site").focus();
      })
      .catch((error) => {
        $("wp-result").textContent = error.message;
      });
  else {
    $("wp-test").disabled = true;
    $("wp-result").textContent = "תצוגה מקדימה בלבד — אין חיבור לאתר.";
  }
})();
