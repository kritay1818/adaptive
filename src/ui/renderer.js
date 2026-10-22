"use strict";
// Only send and the dedicated, guarded WordPress connection entry are active.
// Model/project setup remains unreachable from chat navigation.
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.adactive;
  const history = location.pathname.endsWith("history.html");
  let attachments = [],
    unread = 0;
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
        "attach-image",
        "chat-export-md",
        "chat-export-txt",
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
  $("model-setup").onclick = () =>
    api.openModel().catch((e) => notify(e.message, true));
  $("history-toggle").onclick = async () => {
    await api.openHistory();
    unread = 0;
    $("history-badge").textContent = "";
  };
  $("history-close").onclick = () => api.closeHistory();
  let inActivityLog = false;
  let activityRequest = 0;
  async function loadActivityLog() {
    if (!api?.wpActivityLog) return;
    $("activity-list")?.replaceChildren();
    if ($("activity-blocked-banner"))
      $("activity-blocked-banner").hidden = true;
    try {
      const request = ++activityRequest;
      const data = await api.wpActivityLog();
      if (request === activityRequest && data.project === current?.id)
        renderActivityLog(data);
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
      $("activity-log-toggle").textContent = inActivityLog
        ? "חזרה לשיחה"
        : "יומן פעולות";
    }
    if ($("history-title")) {
      $("history-title").textContent =
        (inActivityLog ? "יומן פעולות · " : "") + (current?.name || "");
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
        await notify(
          updated.blocked
            ? "החסימה נשארה פעילה."
            : "החסימה שוחררה בהצלחה. לא נשלחה כתיבה נוספת.",
        );
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
      const labels = {
        verified: "הושלם ואומת",
        restored: "שוחזר",
        unknown: "לא ידוע — יש לבדוק באתר",
        failed: "נכשל",
        "not-run": "לא הופעל",
        executing: "בביצוע",
      };
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
          busy = true;
          undo.disabled = true;
          try {
            await notify("מכין ביטול תוכנית בסדר הפוך לאישור…");
            const result = await api.undoWordPressPlan(plan.id);
            toggleActivityView(false);
            await render(result);
            await notify("");
          } catch (e) {
            await notify(e.message, true);
            undo.disabled = false;
          } finally {
            busy = false;
          }
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

        const actionText =
          {
            upload: "הועלתה תמונה",
            "delete-media": "נמחקה תמונה",
            create: "נוצרה טיוטה",
            trash: "הועבר לאשפה",
            menu: "עודכן התפריט הראשי",
            "menu-restore": "שוחזר התפריט",
            "front-page": "הוגדר דף הבית",
            "site-identity": "עודכנו שם האתר ותיאורו",
            "settings-restore": "שוחזרו הגדרות האתר",
            "site-css": "עודכן עיצוב האתר (CSS)",
            "css-restore": "שוחזר עיצוב האתר",
            "site-logo": "הוגדר לוגו האתר",
            header: "עודכנה כותרת האתר",
            footer: "עודכנה תחתית האתר",
            "template-restore": "שוחזרה תבנית האתר",
            publish: "פורסם לציבור",
            unpublish: "הוחזר לטיוטה",
          }[r.action] || "עודכן";

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
    $("context-chips").replaceChildren(
      ...attachments.map((m) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "context-chip";
        b.textContent = "הקשר: " + m.content.slice(0, 28) + " ×";
        b.title = "הסרת הקשר מצורף";
        b.onclick = () => {
          if (busy) return;
          attachments = attachments.filter((a) => a.id !== m.id);
          chips();
        };
        return b;
      }),
    );
  }
  api?.onAttached?.((value) => {
    if (busy || value.projectId !== current?.id) return;
    const merged = [
      ...attachments,
      ...value.messages.filter((m) => !attachments.some((a) => a.id === m.id)),
    ];
    if (
      merged.length > 20 ||
      merged.reduce((n, m) => n + m.content.length, 0) > 16000
    ) {
      notify("הקשר מצורף ארוך מדי", true);
      return;
    }
    attachments = merged;
    chips();
  });
  let expiryTimer;
  const STATES = {
    verified: ["ok", "✅ בוצע ואומת"],
    denied: ["denied", "❌ נדחה — לא נכתב כלום"],
    expired: ["warn", "⌛ פג תוקף — שלחו את הבקשה שוב"],
    unknown: ["warn", "⚠️ תוצאה לא ידועה — בדקו באתר"],
    partial: ["warn", "⚠️ התוכנית נעצרה — ראו את הפירוט בהודעה למעלה"],
  };
  // Plain-Hebrew summary of what approving will do. Display only: approval binds to review.token / exact payload.
  function summaryOf(review) {
    const lines = [];
    const quote = (t) => `'${t || "ללא כותרת"}'`;
    if (["build-plan", "undo-plan"].includes(review.kind)) {
      lines.push(
        `${review.kind === "undo-plan" ? "יבוטלו" : "יבוצעו"} ${review.steps.length} שלבים באתר ${review.site}:`,
      );
      return {
        lines,
        steps: review.steps.map(
          (st) =>
            `${st.number}. ${st.label}${st.payload?.title ? " — " + quote(st.payload.title) : st.payload?.fileName ? " — " + st.payload.fileName : ""}`,
        ),
      };
    }
    const title = review.payload?.title ?? review.before?.title;
    const what =
      review.kind === "create"
        ? `ייווצר עמוד חדש כטיוטה בשם ${quote(title)}`
        : review.kind === "update"
          ? `יעודכן ${quote(title)} (${review.status === "publish" ? "עמוד מפורסם" : "טיוטה"})`
          : review.kind === "upload"
            ? `תועלה תמונה לספריית המדיה: ${review.payload?.fileName || ""}`
            : review.kind === "delete-media"
              ? "תימחק לצמיתות תמונה שהועלתה דרך האפליקציה"
              : review.kind === "trash"
                ? `הטיוטה ${quote(title)} תועבר לפח`
                : review.kind === "publish"
                  ? `יפורסם לציבור: ${quote(title)}`
                  : review.kind === "unpublish"
                    ? `יוחזר לטיוטה: ${quote(title)}`
                    : review.kind === "menu"
                      ? "יעודכן התפריט הראשי של האתר"
                      : review.kind === "front-page"
                        ? "יוגדר דף הבית של האתר"
                        : review.kind === "site-logo"
                          ? "יוגדר לוגו האתר מתמונה שהועלתה"
                          : review.kind === "header"
                            ? "תוחלף הכותרת העליונה (Header) של האתר"
                            : review.kind === "footer"
                              ? "תוחלף התחתית (Footer) של האתר"
                              : review.kind === "template-restore"
                                ? "תוחזר התבנית הקודמת של האתר"
                                : review.kind === "site-css"
                                  ? `יוחלף ה־CSS המותאם של כל האתר (${(review.payload?.css || "").length} תווים)`
                                  : review.kind === "css-restore"
                                    ? "יוחזר ה־CSS המותאם הקודם של האתר"
                                    : review.kind === "site-identity"
                                      ? "יעודכנו שם האתר ותיאורו"
                                      : "יבוצע שינוי באתר";
    lines.push(what, `אתר: ${review.site}`);
    if (review.resource === "media")
      lines.push(
        `טקסט חלופי: ${review.payload.alt || "(ריק — תמונה דקורטיבית)"}`,
      );
    return { lines, steps: [] };
  }
  function summaryNode(review) {
    const { lines, steps } = summaryOf(review);
    const box = document.createElement("div");
    box.className = "review-summary";
    const p = document.createElement("p");
    p.textContent = lines.join("\n");
    box.append(p);
    if (steps.length) {
      const ol = document.createElement("ul");
      for (const t of steps) {
        const li = document.createElement("li");
        li.textContent = t;
        ol.append(li);
      }
      box.append(ol);
    }
    return box;
  }
  function stateLine(kind) {
    const [cls, label] = STATES[kind] || STATES.unknown;
    const line = document.createElement("p");
    line.className = "review-state " + cls;
    line.setAttribute("role", "status");
    line.textContent = label;
    return line;
  }
  function viewButton(operation) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "view-site";
    b.textContent = "צפייה באתר";
    b.onclick = async () => {
      b.disabled = true;
      try {
        await api.openSite(operation);
      } catch (e) {
        await notify(e.message, true);
      } finally {
        b.disabled = false;
      }
    };
    return b;
  }
  function reviewCard(review) {
    clearInterval(expiryTimer);
    if (!review) return;
    const card = document.createElement("article");
    card.id = "wp-review";
    card.className = "bubble wp-review";
    card.dataset.token = review.token;
    const title = document.createElement("h3");
    const isPlan = ["build-plan", "undo-plan"].includes(review.kind);
    title.textContent = isPlan
      ? `${review.kind === "undo-plan" ? "ביטול כל התוכנית" : "תוכנית בנייה"} · ${review.title}`
      : "בדיקה ואישור פעולת WordPress";
    const detail = document.createElement("p");
    detail.className = "review-warning";
    detail.textContent = `${review.warning}\nהאישור תקף ל־5 דקות${isPlan ? " וחל על כל השלבים המפורטים" : ""}.`;
    // Technical details: collapsed; same exact data the approval is bound to.
    const tech = document.createElement("details");
    tech.className = "review-tech";
    const summary = document.createElement("summary");
    summary.textContent = "פרטים טכניים";
    const meta = document.createElement("p");
    meta.textContent =
      `פרויקט: ${review.project}\nמשאב: ${review.resource || "pages"} · סוג: ${review.kind}${review.pageId ? " · מזהה " + review.pageId : ""} · ${review.status || ""}\nתוכן HTML מוצג כטקסט, לא מורץ.` +
      (review.resource === "media"
        ? `\nכתובת תמונה: ${review.payload.url}\nשם קובץ: ${review.payload.fileName}`
        : "");
    const preview = document.createElement("pre");
    preview.textContent = isPlan
      ? review.steps
          .map(
            (step) =>
              `${step.number}. ${step.label}${step.key ? " (" + step.key + ")" : ""}\n${step.warning}\n${JSON.stringify(step.payload, null, 2)}`,
          )
          .join("\n\n")
      : JSON.stringify(
          { before: review.before, exactPayload: review.payload },
          null,
          2,
        );
    if (isPlan) {
      preview.style.direction = "rtl";
      preview.style.textAlign = "right";
    }
    tech.append(summary, meta, preview);
    const actions = document.createElement("div");
    const approve = document.createElement("button");
    approve.id = "wp-approve";
    approve.textContent = isPlan
      ? "אישור וביצוע כל התוכנית"
      : review.status === "publish"
        ? "אישור שינוי באתר המפורסם"
        : "אישור וביצוע";
    const deny = document.createElement("button");
    deny.id = "wp-deny";
    deny.textContent = "דחייה — ללא כתיבה";
    const settle = (kind) => {
      actions.replaceWith(stateLine(kind));
    };
    const decide = async (allowed) => {
      if (busy) return;
      busy = true;
      approve.disabled = deny.disabled = true;
      $("composer").disabled = $("send").disabled = true;
      try {
        await notify(
          allowed ? "מבצע שינוי מאושר ומאמת בקריאה חוזרת…" : "דוחה שינוי…",
        );
        const response = await api.decideWordPress({
          token: review.token,
          approve: allowed,
        });
        await render(response);
        await notify("");
      } catch (error) {
        if (/פג|בוטל/.test(error.message)) {
          settle("expired");
          await notify("");
        } else {
          card.remove();
          await notify(error.message, true);
        }
      } finally {
        busy = false;
        $("composer").disabled = $("send").disabled = false;
      }
    };
    approve.onclick = () => decide(true);
    deny.onclick = () => decide(false);
    actions.append(approve, deny);
    const countdown = document.createElement("p");
    countdown.className = "review-countdown";
    countdown.setAttribute("role", "timer");
    card.append(title, countdown, summaryNode(review), detail, actions, tech);
    $("messages").append(card);
    $("messages").hidden = inActivityLog;
    const tick = () => {
      const left = Math.max(0, review.expires - Date.now());
      countdown.textContent = `ממתין לאישור שלך · נותרו ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}`;
      countdown.classList.toggle("low", left < 60000);
      if (left > 0 || !actions.isConnected) return;
      clearInterval(expiryTimer);
      approve.disabled = deny.disabled = true;
      countdown.remove();
      settle("expired");
    };
    tick();
    expiryTimer = setInterval(tick, 1000);
  }
  // Progress line with elapsed timer; same short text in the chat window and the small bar.
  let progress = null,
    progressTimer = null;
  const clock = (ms) =>
    `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  function paintProgress() {
    const el = $("progress");
    if (!progress) {
      if (el) {
        el.textContent = "";
        el.hidden = true;
      }
      return;
    }
    const elapsed = Date.now() - progress.since;
    let line = `${progress.text} (${clock(elapsed)})`;
    if (elapsed >= 20000) line += " · משימות גדולות יכולות לקחת כמה דקות";
    if (el) {
      el.textContent = line;
      el.hidden = false;
    } else notify(line);
  }
  function progressEvent(value) {
    const text = typeof value === "string" ? value : value?.text || "";
    if (!text) {
      progress = null;
      clearInterval(progressTimer);
      progressTimer = null;
      paintProgress();
      if (!$("progress") && !busy) notify("");
      return;
    }
    progress = {
      text,
      since: Number.isFinite(value?.since)
        ? value.since
        : progress?.since || Date.now(),
    };
    if (!progressTimer) progressTimer = setInterval(paintProgress, 1000);
    paintProgress();
  }
  let shownCount = -1,
    hadReview = false;
  // Messages not yet in the store: the optimistic user bubble while sending, and failed sends with a retry button.
  let localTail = [],
    sending = false,
    stopped = false;
  // Reference image chosen via main's file dialog; the renderer holds only an opaque id and a small thumbnail.
  let attached = null;
  const safeThumb = (t) =>
    typeof t === "string" &&
    /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(t);
  function paintChip() {
    const chip = $("image-chip");
    if (!chip) return;
    chip.replaceChildren();
    chip.hidden = !attached;
    if (!attached) return;
    if (safeThumb(attached.thumb)) {
      const img = document.createElement("img");
      img.src = attached.thumb;
      img.alt = "תמונת השראה";
      chip.append(img);
    }
    const name = document.createElement("span");
    name.textContent = attached.name;
    name.dir = "auto";
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.title = "הסרת התמונה";
    x.setAttribute("aria-label", "הסרת התמונה");
    x.onclick = () => {
      if (!busy) {
        attached = null;
        paintChip();
      }
    };
    chip.append(name, x);
  }
  if ($("attach-image"))
    $("attach-image").onclick = async () => {
      if (busy) return;
      try {
        const picked = await api.pickImage();
        if (picked.canceled) return;
        attached = picked;
        paintChip();
        $("composer").focus();
      } catch (e) {
        await notify(e.message, true);
      }
    };
  function tailNodes() {
    return localTail.flatMap((entry) => {
      const user = messageNode({
        role: "user",
        content:
          entry.image && !safeThumb(entry.image.thumb)
            ? "🖼 " + entry.text
            : entry.text,
        at: entry.at,
        thumb: entry.image?.thumb,
      });
      user.querySelector(".message-menu")?.remove();
      user.dataset.local = "1";
      if (!entry.error) return [user];
      const err = document.createElement("article");
      err.className = "msg assistant result bad";
      err.dataset.local = "1";
      const line = document.createElement("div");
      line.className = "result-line";
      const i = document.createElement("span");
      i.className = "result-icon";
      i.textContent = "❌";
      let techNode = null;
      const [errBody, errIds] = splitBtn(entry.error);
      const [headline, ...technical] = errBody.split("\n--TECH--\n");
      const t = document.createElement("span");
      t.className = "result-text";
      t.dir = "auto";
      t.textContent = headline;
      line.append(i, t);
      if (technical.length) {
        const d = document.createElement("details");
        d.className = "review-tech";
        const s = document.createElement("summary");
        s.textContent = "פרטים טכניים";
        const pre = document.createElement("pre");
        pre.dir = "auto";
        pre.textContent = technical.join("\n");
        d.append(s, pre);
        techNode = d;
      }
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "undo-result";
      retry.textContent = "שליחה שוב";
      retry.onclick = () => {
        if (busy) return;
        localTail = localTail.filter((e) => e !== entry);
        paintLocal();
        sendInChat(entry.text, entry.image);
      };
      err.append(
        line,
        ...(techNode ? [techNode] : []),
        ...[actionButtons(errIds, true)].filter(Boolean),
        retry,
      );
      return [user, err];
    });
  }
  function paintLocal() {
    const box = $("messages");
    box.querySelectorAll("[data-local]").forEach((n) => n.remove());
    box.querySelector(".empty-state")?.remove();
    box.append(...tailNodes());
    box.scrollTop = box.scrollHeight;
  }
  function setSending(on) {
    sending = on;
    const send = $("send");
    send.disabled = false;
    send.textContent = on ? "■" : "↑";
    send.title = on ? "עצירה" : "";
    send.setAttribute("aria-label", on ? "עצירה" : "שלח הודעה");
    send.classList.toggle("stop", on);
    if (on) progressEvent({ text: "חושב…", since: Date.now() });
    else progressEvent({ text: "" });
  }
  async function sendInChat(message, image = attached) {
    busy = true;
    stopped = false;
    const entry = { text: message, at: new Date().toISOString(), image };
    attached = null;
    paintChip();
    localTail.push(entry);
    $("composer").value = "";
    grow();
    setSending(true);
    paintLocal();
    $("chat-panel").setAttribute("aria-busy", "true");
    try {
      await notify("");
      if (!(await api.historyState()).connection.connected)
        throw new Error("אין מודל מחובר. חברו מודל מהסרגל הקטן (ליד החתול).");
      const response = await api.send({
        id: current.id,
        message,
        contextIds: attachments.map((m) => m.id),
        ...(image ? { imageId: image.id } : {}),
      });
      localTail = [];
      attachments = [];
      chips();
      if (response.action === "connect")
        await notify("חברו מודל בחלון המאובטח — ללא מפתחות בצ׳אט");
      await render(response);
    } catch (error) {
      entry.error = stopped
        ? "הבקשה הופסקה." +
          (error.message.includes("\n--BTN--\n")
            ? "\n--BTN--\n" + error.message.split("\n--BTN--\n")[1]
            : "")
        : error.message;
      paintLocal();
    } finally {
      busy = false;
      setSending(false);
      $("chat-panel").setAttribute("aria-busy", "false");
      $("composer").focus();
    }
  }
  async function stopSend() {
    stopped = true;
    try {
      await api.cancelWordPress();
    } catch (e) {
      await notify(e.message, true);
    }
  }
  const PREPARED = /^(הוכנה תוכנית|הוכן שינוי|התמונה הורדה ונבדקה)/;
  const RESULT = /^(✅|⚠️|❌|⛔)/u;
  const timeOf = (m) => {
    const d = new Date(m.at);
    return isNaN(d)
      ? ""
      : d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  };
  const dayKey = (m) => {
    const d = new Date(m.at);
    return isNaN(d) ? "" : d.toDateString();
  };
  function dayLabel(m) {
    const d = new Date(m.at),
      today = new Date(),
      yesterday = new Date(Date.now() - 864e5);
    if (d.toDateString() === today.toDateString()) return "היום";
    if (d.toDateString() === yesterday.toDateString()) return "אתמול";
    return d.toLocaleDateString("he-IL", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }
  // Starts the existing undo flow; the user then approves it on the normal review card.
  function undoButton(m) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "undo-result";
    b.textContent = m.undoPlan ? "ביטול כל התוכנית" : "ביטול";
    b.onclick = async () => {
      if (busy) return;
      busy = true;
      b.disabled = true;
      try {
        await notify("מכין ביטול לאישור…");
        const result = m.undoPlan
          ? await api.undoWordPressPlan(m.undo)
          : await api.undoWordPress({ logId: m.undo });
        await render(result);
        await notify("");
      } catch (e) {
        await notify(e.message, true);
        b.disabled = false;
      } finally {
        busy = false;
      }
    };
    return b;
  }
  function messageMenu(m) {
    const menu = document.createElement("details");
    menu.className = "message-menu";
    const more = document.createElement("summary");
    more.textContent = "⋯";
    more.title = "עוד פעולות";
    more.setAttribute("aria-label", "עוד פעולות להודעה");
    const actions = document.createElement("div");
    actions.className = "message-actions";
    for (const [action, title, format] of [
      ["copy", "העתקה"],
      ["export", "ייצוא .md", "md"],
      ["export", "ייצוא .txt", "txt"],
      ["attach", "צירוף להודעה הבאה"],
    ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = title;
      b.onclick = async () => {
        b.disabled = true;
        try {
          const result = await api.messageAction({
            action,
            format,
            projectId: current.id,
            messageIds: [m.id],
          });
          await notify(
            result.canceled
              ? "הייצוא בוטל"
              : action === "attach"
                ? "צורף כהקשר להודעה הבאה בסרגל"
                : action === "copy"
                  ? "הועתק"
                  : "יוצא",
          );
        } catch (e) {
          await notify(e.message, true);
        } finally {
          b.disabled = false;
        }
      };
      actions.append(b);
    }
    menu.append(more, actions);
    return menu;
  }
  // Messages may end with "\n--BTN--\n[ids]" (action buttons); only the latest message shows them.
  const BTN_LABELS = {
    resume: "המשך",
    cancel: "ביטול",
    stop: "עצירה",
    billing: "פתיחת עמוד החיוב",
    model: "חיבור מודל מחדש",
    wordpress: "חיבור האתר מחדש",
  };
  function actionButtons(ids, latest) {
    if (!latest || !ids.length) return null;
    const row = document.createElement("div");
    row.className = "action-row";
    for (const id of ids) {
      if (!BTN_LABELS[id]) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "undo-result";
      b.textContent = BTN_LABELS[id];
      b.onclick = async () => {
        if (busy) return;
        try {
          if (id === "resume") await sendInChat("המשך", null);
          else if (id === "cancel" || id === "stop") {
            busy = true;
            try {
              await render(await api.resumeAction("discard"));
            } finally {
              busy = false;
            }
          } else await api.openHelp(id);
        } catch (e) {
          await notify(e.message, true);
        }
      };
      row.append(b);
    }
    return row;
  }
  const splitBtn = (s) => {
    const [head, json] = String(s).split("\n--BTN--\n");
    let ids = [];
    try {
      ids = json ? JSON.parse(json) : [];
    } catch {
      /* ignore */
    }
    return [head, Array.isArray(ids) ? ids : []];
  };
  function messageNode(m0, latest = false) {
    const [withoutBtn, btnIds] = splitBtn(m0.content);
    m0 = { ...m0, content: withoutBtn };
    // Usage/diagnostics appended by main after "--TECH--" go under a collapsed "פרטים טכניים".
    const [mainText, ...techParts] = String(m0.content).split("\n--TECH--\n");
    const m = { ...m0, content: mainText };
    const techText = techParts.join("\n");
    const article = document.createElement("article");
    const time = document.createElement("time");
    time.textContent = timeOf(m);
    if (m.role === "assistant" && RESULT.test(m.content)) {
      // Compact result card: icon + one line + view button; the rest is technical and collapsed.
      const [first, ...rest] = m.content.split("\n");
      const icon = /^(?:✅|⚠️|❌|⛔)/u.exec(first)[0];
      article.className =
        "msg assistant result " +
        (icon === "✅"
          ? "ok"
          : icon === "❌" || icon === "⛔"
            ? "bad"
            : "warn");
      const line = document.createElement("div");
      line.className = "result-line";
      const i = document.createElement("span");
      i.className = "result-icon";
      i.textContent = icon;
      const t = document.createElement("span");
      t.className = "result-text";
      t.dir = "auto";
      t.textContent = first.slice(icon.length).trim();
      line.append(i, t);
      article.append(line);
      if (m.view) article.append(viewButton(m.view));
      if (m.undo && icon !== "❌" && icon !== "⛔")
        article.append(undoButton(m));
      const more = [rest.join("\n").trim(), techText]
        .filter(Boolean)
        .join("\n\n");
      if (more) {
        const d = document.createElement("details");
        d.className = "review-tech";
        const s = document.createElement("summary");
        s.textContent = "פרטים טכניים";
        const pre = document.createElement("pre");
        pre.dir = "auto";
        pre.textContent = more;
        d.append(s, pre);
        article.append(d);
      }
    } else {
      article.className = "msg " + m.role;
      if (safeThumb(m.thumb)) {
        const img = document.createElement("img");
        img.className = "msg-thumb";
        img.src = m.thumb;
        img.alt = "תמונת השראה שצורפה";
        article.append(img);
      }
      const body = document.createElement("p");
      body.dir = "auto";
      body.textContent = m.content;
      article.append(body);
      if (techText) {
        const d = document.createElement("details");
        d.className = "review-tech";
        const s = document.createElement("summary");
        s.textContent = "פרטים טכניים";
        const pre = document.createElement("pre");
        pre.dir = "auto";
        pre.textContent = techText;
        d.append(s, pre);
        article.append(d);
      }
    }
    const buttons = actionButtons(btnIds, latest);
    if (buttons) article.append(buttons);
    article.append(time, messageMenu(m));
    return article;
  }
  function messageNodes(list) {
    const nodes = [];
    let day = null;
    list.forEach((m, index) => {
      const next = list[index + 1];
      // One result per action: hide the "prepared for review" reply once its result follows.
      if (
        m.role === "assistant" &&
        PREPARED.test(m.content) &&
        next?.role === "assistant" &&
        RESULT.test(next.content)
      )
        return;
      const key = dayKey(m);
      if (key && key !== day) {
        day = key;
        const sep = document.createElement("div");
        sep.className = "date-sep";
        sep.textContent = dayLabel(m);
        nodes.push(sep);
      }
      nodes.push(messageNode(m, index === list.length - 1));
    });
    return nodes;
  }
  function emptyState() {
    const box = document.createElement("div");
    box.className = "empty-state";
    const h = document.createElement("p");
    h.className = "empty-title";
    h.textContent =
      "שלום! אני כאן כדי לעזור לבנות ולערוך את האתר שלך. אפשר לכתוב לי בעברית חופשית, למשל:";
    box.append(h);
    for (const example of [
      "תבנה אתר של 3 עמודים למספרה בתל אביב: בית, אודות וצור קשר",
      "תכתוב לי עמוד אודות קצר ומזמין לעסק שלי",
      "תשנה את שם האתר ואת התיאור שלו",
    ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "example";
      b.textContent = example;
      b.dir = "auto";
      b.onclick = () => {
        $("composer").value = example;
        grow();
        $("composer").focus();
      };
      box.append(b);
    }
    return box;
  }
  function grow() {
    const c = $("composer");
    if (!history) return;
    c.style.height = "auto";
    c.style.height = Math.min(c.scrollHeight, 120) + "px";
  }
  async function render(state) {
    if (current && current.id !== state.project.id) {
      attachments = [];
      unread = 0;
      chips();
    }
    if (
      !history &&
      current?.id === state.project.id &&
      state.project.messages.length > current.messages.length
    )
      unread++;
    current = state.project;
    $("history-badge").textContent = unread ? String(unread) : "";
    $("model-setup").hidden = !!state.connection.connected;
    if ($("attach-image")) {
      $("attach-image").disabled = !state.connection.connected;
      $("attach-image").title = state.connection.connected
        ? "צירוף תמונת השראה (PNG / JPG / WebP, עד 5 MB)"
        : "חברו מודל כדי לצרף תמונה";
    }
    $("composer").placeholder = state.connection.connected
      ? "איך אפשר לעזור באתר שלך?"
      : "קודם חיבור מודל, אחר כך WordPress";
    $("history-title").textContent =
      (inActivityLog ? "יומן פעולות · " : "") + current.name;
    if ($("history-site"))
      $("history-site").textContent = state.wordpress?.connected
        ? state.wordpress.site
        : "WordPress לא מחובר";
    if ($("conn-dot")) {
      const ok = !!state.connection.connected && !!state.wordpress?.connected;
      $("conn-dot").className = "conn-dot " + (ok ? "ok" : "bad");
      $("conn-dot").title =
        `מודל: ${state.connection.connected ? "מחובר" : "לא מחובר"} · אתר: ${state.wordpress?.connected ? "מחובר" : "לא מחובר"}`;
    }
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
    const stick =
      messages.scrollHeight - messages.scrollTop - messages.clientHeight < 160;
    const grew =
      current.messages.length !== shownCount || !!state.review !== hadReview;
    shownCount = current.messages.length;
    hadReview = !!state.review;
    messages.replaceChildren(
      ...(history ? [...messageNodes(current.messages), ...tailNodes()] : []),
    );
    if (history) {
      if (inActivityLog) loadActivityLog();
      reviewCard(state.review);
      if (!current.messages.length && !state.review)
        messages.append(emptyState());
      if (grew || stick) {
        await new Promise(requestAnimationFrame);
        messages.scrollTop = messages.scrollHeight;
      }
    }
  }
  api?.onProgress?.((value) => progressEvent(value));
  $("chat-form").onsubmit = async (event) => {
    event.preventDefault();
    if (history && sending) {
      if (event.submitter?.id === "send") stopSend();
      return;
    }
    if (busy || !current) return;
    let message = $("composer").value;
    if (!message.trim() && history && attached)
      message = "ראו את תמונת ההשראה המצורפת ועצבו בהתאם";
    if (!message.trim()) return;
    if (!api) {
      notify("תצוגה מקדימה בלבד — אין בקשת AI.");
      return;
    }
    if (history) return sendInChat(message);
    busy = true;
    $("composer").disabled = $("send").disabled = true;
    $("chat-panel").setAttribute("aria-busy", "true");
    try {
      await notify("ממתין לתשובת המודל…");
      if (
        !(await (history ? api.historyState() : api.state())).connection
          .connected
      ) {
        if (history) {
          await notify(
            "אין מודל מחובר. חברו מודל מהסרגל הקטן (ליד החתול).",
            true,
          );
          return;
        }
        await api.openModel();
        await notify("חברו מודל בחלון המאובטח — ללא מפתחות בצ׳אט");
        return;
      }
      // From the small bar: open and focus the chat window so the full progress is visible there.
      api.openHistory().catch(() => {});
      const response = await api.send({
        id: current.id,
        message,
        contextIds: attachments.map((m) => m.id),
      });
      if (response.action === "connect") {
        await api.openModel();
      } else {
        await notify("");
        $("composer").value = "";
        grow();
        attachments = [];
        chips();
        await render(response);
      }
    } catch (error) {
      // Same friendly Hebrew text as the chat window (technical details and buttons live there).
      const [body] = splitBtn(error.message);
      await notify(body.split("\n--TECH--\n")[0].replace(/\n+/g, " "), true);
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
  $("composer").addEventListener("input", grow);
  // Header "⋯" menu (history window only): export the last 20 messages, close.
  for (const [id, format] of [
    ["chat-export-md", "md"],
    ["chat-export-txt", "txt"],
  ]) {
    if (!$(id)) continue;
    $(id).onclick = async () => {
      $("chat-more").open = false;
      try {
        const result = await api.messageAction({
          action: "export",
          format,
          projectId: current.id,
          messageIds: current.messages.slice(-20).map((m) => m.id),
        });
        await notify(result.canceled ? "הייצוא בוטל" : "השיחה יוצאה");
      } catch (e) {
        await notify(e.message, true);
      }
    };
  }
  if ($("history-close"))
    $("history-close").addEventListener("click", () => {
      if ($("chat-more")) $("chat-more").open = false;
    });
  const refresh = () =>
    (history ? api.historyState() : api.state())
      .then(render)
      .catch((e) => notify(e.message, true));
  api?.onStateChanged?.(() => {
    if (!busy) refresh();
  });
  if (api)
    (history ? api.historyState() : api.state())
      .then(render)
      .catch((error) => notify(error.message, true));
  else notify("תצוגה מקדימה · להפעלה מלאה השתמש ב־npm start");
})();
