"use strict";
// Only send and the dedicated, guarded WordPress connection entry are active.
// Model/project setup remains unreachable from chat navigation.
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.adactive;
  const history = location.pathname.endsWith("history.html");
  let attachments = [], unread = 0;
  let current,
    busy = false;
  const notify = async (message, error = false) => {
    $("notice").setAttribute("role", error ? "alert" : "status");
    $("notice").setAttribute("aria-live", error ? "assertive" : "polite");
    $("notice").textContent = message;

  };
  for (const element of document.querySelectorAll(
    "button, input, select, textarea",
  )) {
    if (
      [
        "send",
        "composer",
        "connection",
        "model-setup",
        "history-toggle",
        "history-close",
        "activity-log-toggle",
        "activity-unblock-btn",
      ].includes(element.id)
    )
      continue;
    element.disabled = true;
    element.tabIndex = -1;
  }
  for (const id of ["options-panel", "inspect-panel", "chat-model-menu"])
    $(id).inert = true;
  for (const dialog of document.querySelectorAll("dialog")) dialog.inert = true;
  $("connection").onclick = async () => {
    try {
      await api?.openWordPress();
    } catch (error) {
      await notify(error.message, true);
    }
  };
  $("model-setup").onclick = () => api.openModel().catch(e => notify(e.message,true));
  $("history-toggle").onclick = async () => { await api.openHistory(); unread = 0; $("history-badge").textContent = ""; };
  $("history-close").onclick = () => api.closeHistory();
  let inActivityLog = false;
  let activityRequest = 0;
  async function loadActivityLog() {
    if (!api?.wpActivityLog) return;
    $("activity-list")?.replaceChildren();
    if ($("activity-blocked-banner")) $("activity-blocked-banner").hidden = true;
    try {
      const request = ++activityRequest;
      const data = await api.wpActivityLog();
      if (request === activityRequest && data.project === current?.id) renderActivityLog(data);
    } catch (e) {
      await notify(e.message, true);
    }
  }
  function toggleActivityView(show) {
    inActivityLog = show !== undefined ? show : !inActivityLog;
    if ($("activity-panel")) {
      $("activity-panel").hidden = !inActivityLog;
      $("messages").hidden = inActivityLog;
    }
    if ($("activity-log-toggle")) {
      $("activity-log-toggle").textContent = inActivityLog ? "חזרה לשיחה" : "יומן פעולות";
    }
    if ($("history-title")) {
      $("history-title").textContent = (inActivityLog ? "יומן פעולות · " : "היסטוריה · ") + (current?.name || "");
    }
    if (inActivityLog) {
      loadActivityLog();
    }
  }
  if ($("activity-log-toggle")) {
    $("activity-log-toggle").onclick = () => toggleActivityView();
  }
  if ($("activity-unblock-btn")) {
    $("activity-unblock-btn").onclick = async () => {
      if (busy) return;
      busy = true;
      $("activity-unblock-btn").disabled = true;
      try {
        await notify("משחרר חסימת כתיבה…");
        const updated = await api.unblockWordPress();
        renderActivityLog(updated);
        await notify(updated.blocked ? "החסימה נשארה פעילה." : "החסימה שוחררה בהצלחה. לא נשלחה כתיבה נוספת.");
      } catch (err) {
        await notify(err.message, true);
      } finally {
        busy = false;
        $("activity-unblock-btn").disabled = false;
      }
    };
  }
  function renderActivityLog(data) {
    if (!$("activity-panel") || data.project !== current?.id) return;
    const banner = $("activity-blocked-banner");
    if (banner) banner.hidden = !data.blocked;
    const list = $("activity-list");
    if (!list) return;
    const planCards = (data.plans || []).map((plan) => {
      const card = document.createElement("article");
      card.className = "activity-row";
      const heading = document.createElement("strong");
      heading.textContent = `${plan.undoOf ? "ביטול תוכנית" : "תוכנית בנייה"} · ${plan.title}`;
      const outcomes = document.createElement("ol");
      const labels = { verified: "הושלם ואומת", restored: "שוחזר", unknown: "לא ידוע — יש לבדוק באתר", failed: "נכשל", "not-run": "לא הופעל", executing: "בביצוע" };
      for (const step of plan.steps) {
        const row = document.createElement("li");
        row.textContent = `${step.label} — ${labels[step.state] || "לא הופעל"}`;
        outcomes.append(row);
      }
      card.append(heading, outcomes);
      if (plan.canUndo) {
        const undo = document.createElement("button");
        undo.className = "activity-undo-btn";
        undo.type = "button";
        undo.textContent = "ביטול כל התוכנית";
        undo.disabled = data.blocked;
        undo.onclick = async () => {
          if (busy) return;
          busy = true; undo.disabled = true;
          try {
            await notify("מכין ביטול תוכנית בסדר הפוך לאישור…");
            const result = await api.undoWordPressPlan(plan.id);
            toggleActivityView(false);
            await render(result);
            await notify("");
          } catch (e) { await notify(e.message, true); undo.disabled = false; }
          finally { busy = false; }
        };
        card.append(undo);
      }
      return card;
    });
    if (!data.records || !data.records.length) {
      list.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "activity-empty";
      empty.textContent = "אין פעולות WordPress מתועדות בפרויקט זה.";
      list.append(...planCards, empty);
      return;
    }
    list.replaceChildren(
      ...planCards,
      ...data.records.map((r) => {
        const item = document.createElement("article");
        item.className = "activity-row";

        const dateStr = new Date(r.at).toLocaleString("he-IL", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });

        const actionText = ({
          upload: "הועלתה תמונה", "delete-media": "נמחקה תמונה", create: "נוצרה טיוטה", trash: "הועבר לאשפה",
          menu: "עודכן התפריט הראשי", "menu-restore": "שוחזר התפריט", "front-page": "הוגדר דף הבית",
          "site-identity": "עודכנו שם האתר ותיאורו", "settings-restore": "שוחזרו הגדרות האתר", publish: "פורסם לציבור", unpublish: "הוחזר לטיוטה",
        })[r.action] || "עודכן";

        const stateText =
          r.state === "verified"
            ? "אומת"
            : r.state === "restored"
              ? "שוחזר"
              : "לא ידוע";
        const stateClass =
          r.state === "verified"
            ? "state-verified"
            : r.state === "restored"
              ? "state-restored"
              : "state-unknown";

        const header = document.createElement("div");
        header.className = "activity-row-header";

        const titleSpan = document.createElement("span");
        titleSpan.className = "activity-page-title";
        titleSpan.textContent = r.title || `עמוד ${r.pageId || ""}`;

        const stateBadge = document.createElement("span");
        stateBadge.className = `activity-state-badge ${stateClass}`;
        stateBadge.textContent = stateText;

        header.append(titleSpan, stateBadge);

        const meta = document.createElement("div");
        meta.className = "activity-row-meta";
        meta.textContent = `${dateStr} · ${r.site || data.site || ""} · ${actionText}`;

        item.append(header, meta);

        if (r.canUndo) {
          const actionsDiv = document.createElement("div");
          actionsDiv.className = "activity-row-actions";
          const undoBtn = document.createElement("button");
          undoBtn.type = "button";
          undoBtn.className = "activity-undo-btn";
          undoBtn.textContent = "חזרה אחורה";
          undoBtn.disabled = data.blocked;
          undoBtn.onclick = async () => {
            if (busy) return;
            busy = true;
            undoBtn.disabled = true;
            try {
              await notify("מכין שחזור לאישור…");
              const res = await api.undoWordPress({ logId: r.id });
              toggleActivityView(false);
              await render(res);
              await notify("");
            } catch (err) {
              await notify(err.message, true);
              undoBtn.disabled = false;
            } finally {
              busy = false;
            }
          };
          actionsDiv.append(undoBtn);
          item.append(actionsDiv);
        }

        return item;
      }),
    );
  }
  function chips() {
    $("context-chips").replaceChildren(...attachments.map(m => {
      const b = document.createElement("button"); b.type = "button"; b.className = "context-chip";
      b.textContent = "הקשר: " + m.content.slice(0,28) + " ×";
      b.title = "הסרת הקשר מצורף";
      b.onclick = () => { if (busy) return; attachments = attachments.filter(a => a.id !== m.id); chips(); }; return b;
    }));
  }
  api?.onAttached?.(value => {
    if (busy || value.projectId !== current?.id) return;
    const merged = [...attachments, ...value.messages.filter(m => !attachments.some(a => a.id === m.id))];
    if (merged.length > 20 || merged.reduce((n,m) => n+m.content.length,0) > 16000) { notify("הקשר מצורף ארוך מדי",true); return; }
    attachments = merged; chips();
  });
  let expiryTimer;
  function reviewCard(review) {
    clearTimeout(expiryTimer);
    if (!review) return;
    const card = document.createElement("article");
    card.id = "wp-review";
    card.className = "bubble wp-review";
    card.dataset.token = review.token;
    const title = document.createElement("h3");
    const isPlan = ["build-plan", "undo-plan"].includes(review.kind);
    title.textContent = isPlan ? `${review.kind === "undo-plan" ? "ביטול כל התוכנית" : "תוכנית בנייה"} · ${review.title}` : "בדיקה ואישור פעולת WordPress";
    const detail = document.createElement("p");
    detail.textContent = `${review.site}\nמשאב: ${review.resource || "pages"}\nפרויקט: ${review.project}\n${review.kind === "upload" ? "העלאת תמונה" : review.kind === "delete-media" ? "מחיקת תמונה לצמיתות " + review.pageId : review.kind === "create" ? "יצירת טיוטה חדשה" : review.kind === "trash" ? "העברת טיוטה לפח " + review.pageId : "עדכון עמוד/פוסט " + review.pageId} · ${review.status}\n${review.warning}\nהאישור תקף ל־5 דקות. תוכן HTML מוצג כטקסט, לא מורץ.`;
    if (isPlan) detail.textContent = `${review.site}\n${review.warning}\nהאישור תקף ל־5 דקות וחל על כל השלבים המפורטים.`;
    else if (["menu", "menu-restore", "front-page", "site-identity", "settings-restore", "publish", "unpublish"].includes(review.kind))
      detail.textContent = `${review.site}\n${review.warning}\nהאישור תקף ל־5 דקות.`;
    if (review.resource === "media") {
      detail.textContent += `\nכתובת תמונה: ${review.payload.url}\nשם קובץ: ${review.payload.fileName}\nטקסט חלופי: ${review.payload.alt || "(ריק — תמונה דקורטיבית)"}`;
    }
    const preview = document.createElement("pre");
    preview.textContent = JSON.stringify(
      { before: review.before, exactPayload: review.payload },
      null,
      2,
    );
    if (isPlan) {
      preview.style.direction = "rtl";
      preview.style.textAlign = "right";
      preview.textContent = review.steps.map((step) => `${step.number}. ${step.label}${step.key ? " (" + step.key + ")" : ""}\n${step.warning}\n${JSON.stringify(step.payload, null, 2)}`).join("\n\n");
    }
    const actions = document.createElement("div");
    const approve = document.createElement("button");
    approve.id = "wp-approve";
    approve.textContent =
      isPlan ? "אישור וביצוע כל התוכנית" : review.status === "publish" ? "אישור שינוי באתר המפורסם" : "אישור וביצוע";
    const deny = document.createElement("button");
    deny.id = "wp-deny";
    deny.textContent = "דחייה — ללא כתיבה";
    const decide = async (allowed) => {
      if (busy) return;
      busy = true;
      approve.disabled = deny.disabled = true;
      $("composer").disabled = $("send").disabled = true;
      try {
        await notify(
          allowed ? "מבצע שינוי מאושר ומאמת בקריאה חוזרת…" : "דוחה שינוי…",
        );
        await render(
          await api.decideWordPress({ token: review.token, approve: allowed }),
        );
        await notify("");
      } catch (error) {
        card.remove();
        await notify(error.message, true);
      } finally {
        busy = false;
        $("composer").disabled = $("send").disabled = false;
      }
    };
    approve.onclick = () => decide(true);
    deny.onclick = () => decide(false);
    actions.append(approve, deny);
    card.append(title, detail, preview, actions);
    $("messages").append(card);
    $("messages").hidden = inActivityLog;
    expiryTimer = setTimeout(
      () => {
        approve.disabled = deny.disabled = true;
        detail.textContent += "\nהאישור פג. שלחו בקשה חדשה.";
      },
      Math.max(0, review.expires - Date.now()),
    );
  }
  async function render(state) {
    if (current && current.id !== state.project.id) { attachments = []; unread = 0; chips(); }
    if (!history && current?.id === state.project.id && state.project.messages.length > current.messages.length) unread++;
    current = state.project;
    $("history-badge").textContent = unread ? String(unread) : "";
    $("model-setup").hidden = !!state.connection.connected;
    $("composer").placeholder = state.connection.connected ? "איך אפשר לעזור באתר שלך?" : "קודם חיבור מודל, אחר כך WordPress";
    $("history-title").textContent =
      (inActivityLog ? "יומן פעולות · " : "היסטוריה · ") + current.name;
    $("projects").replaceChildren(
      ...state.projects.map((p) => new Option(p.name, p.id)),
    );
    $("projects").value = current.id;
    $("connection").classList.toggle("connected", !!state.wordpress?.connected);
    $("connection-status").textContent = state.connection.connected
      ? `${state.connection.provider} · ${state.connection.model}`
      : "אין מודל מחובר";
    $("wordpress-status").textContent = state.wordpress?.connected
      ? `WordPress מחובר · ${state.wordpress.site}`
      : "WordPress לא מחובר";
    const messages = $("messages");
    messages.hidden = !history || inActivityLog;
    if ($("activity-panel")) $("activity-panel").hidden = !inActivityLog;
    messages.replaceChildren(
      ...(history ? current.messages : []).map((m) => {
        const article = document.createElement("article");
        article.className = "bubble " + m.role;
        const label = document.createElement("span");
        label.className = "role";
        label.textContent =
          m.role === "user" ? "את/ה" : "ADActive · תשובת המודל";
        const body = document.createElement("p");
        body.textContent = m.content;
        article.append(label, body);
        const actions = document.createElement("div"); actions.className = "message-actions";
        for (const [action, title, format] of [["copy","העתקה"],["export","ייצוא .md","md"],["export","ייצוא .txt","txt"],["attach","צירוף להודעה הבאה"]]) {
          const b = document.createElement("button"); b.type = "button"; b.textContent = title;
          b.onclick = async () => { b.disabled = true; try {
            const result = await api.messageAction({action, format, projectId:current.id, messageIds:[m.id]});
            await notify(result.canceled ? "הייצוא בוטל" : action === "attach" ? "צורף כהקשר להודעה הבאה בסרגל" : action === "copy" ? "הועתק" : "יוצא");
          } catch(e) { await notify(e.message,true); } finally { b.disabled = false; } }; actions.append(b);
        }
        article.append(actions);
        return article;
      }),
    );
    if (history) {
      if (inActivityLog) loadActivityLog();
      reviewCard(state.review);
      if (!current.messages.length && !state.review) messages.textContent = "אין עדיין הודעות בפרויקט הזה.";
      if (state.review) { await new Promise(requestAnimationFrame); messages.scrollTop = messages.scrollHeight; }
    }

  }
  $("chat-form").onsubmit = async (event) => {
    event.preventDefault();
    if (busy || !current) return;
    const message = $("composer").value;
    if (!message.trim()) return;
    if (!api) {
      notify("תצוגה מקדימה בלבד — אין בקשת AI.");
      return;
    }
    busy = true;
    $("composer").disabled = $("send").disabled = true;
    $("chat-panel").setAttribute("aria-busy", "true");
    try {
      await notify("ממתין לתשובת המודל…");
      if (!(await api.state()).connection.connected) { await api.openModel(); await notify("חברו מודל בחלון המאובטח — ללא מפתחות בצ׳אט"); return; }
      const response = await api.send({ id: current.id, message, contextIds: attachments.map(m => m.id) });
      if (response.action === "connect") {
        await api.openModel();
      } else {
        await notify("");
        $("composer").value = "";
        attachments = []; chips();
        await render(response);
      }
    } catch (error) {
      await notify(error.message, true);
    } finally {
      busy = false;
      $("composer").disabled = $("send").disabled = false;
      $("chat-panel").setAttribute("aria-busy", "false");
      $("composer").focus();
    }
  };
  $("composer").onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $("chat-form").requestSubmit();
    }
  };
  window.onkeydown = (event) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      history ? api?.closeHistory() : api?.hide();
    }
  };
  api?.onShow?.(() => $("composer").focus());
  const refresh = () => (history ? api.historyState() : api.state()).then(render).catch(e => notify(e.message,true));
  api?.onStateChanged?.(() => { if (!busy) refresh(); });
  if (api)
    (history ? api.historyState() : api.state())
      .then(render)
      .catch((error) => notify(error.message, true));
  else notify("תצוגה מקדימה · להפעלה מלאה השתמש ב־npm start");
})();
