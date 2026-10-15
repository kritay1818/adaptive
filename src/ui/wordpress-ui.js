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
  window.onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
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
    try {
      const state = await api.testWordPress(candidate);
      if (attempt === epoch)
        $("wp-result").textContent = `המשתמש אומת · ${state.wordpress.site}`;
    } catch (error) {
      if (attempt === epoch) $("wp-result").textContent = error.message;
    } finally {
      candidate.password = "";
      busy = false;
      $("wp-test").disabled = false;
    }
  };
  if (api)
    api
      .wordPressState()
      .then((state) => {
        project = state.project;
        $("wp-project").textContent = `פרויקט: ${project.name}`;
        $("wp-site").value = state.wordpress.site || "";
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
