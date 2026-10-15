"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { atomic } = require("./core.cjs");
const { structureTools, digest, same, pick } = require("./wp-structure.cjs");
const MAX_STEPS = 40;
const ACTIONS = ["wp_prepare_upload_image", "wp_prepare_create_page", "wp_prepare_create_post", "wp_prepare_update_page", "wp_prepare_update_post", ...structureTools.filter((t) => t.name.startsWith("wp_prepare_")).map((t) => t.name)];
const LABELS = {
  wp_prepare_upload_image: "העלאת תמונה", wp_prepare_create_page: "יצירת טיוטת עמוד", wp_prepare_create_post: "יצירת טיוטת פוסט",
  wp_prepare_update_page: "עדכון עמוד", wp_prepare_update_post: "עדכון פוסט", wp_prepare_menu: "הגדרת התפריט הראשי",
  wp_prepare_front_page: "הגדרת דף הבית", wp_prepare_site_identity: "שם האתר ותיאורו", wp_prepare_publish_page: "פרסום עמוד לציבור", wp_prepare_publish_post: "פרסום פוסט לציבור",
};
const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = { type: "string" }, referenceId = { anyOf: [{ type: "integer" }, { type: "string", description: "Earlier created page/post ID, e.g. {{home.id}}" }] };
const planTool = {
  name: "wp_prepare_build_plan",
  description: "Prepare ONE human-approved build plan of 1–40 ordered WordPress writes. No writes during preparation. Each step has a unique key, tool and args. IDs may reference earlier create steps: {{home.id}}. In page content only, use {{hero.id}} / {{hero.url}} from an earlier upload. No forward references. One main menu per plan; each setting key may be written once. All steps are shown before approval, executed serially and verified separately. Stop at first failure/unknown, never retry. Plan undo reverses completed steps after separate review.",
  parameters: schema({ title: str, steps: { type: "array", minItems: 1, maxItems: MAX_STEPS,
    items: schema({ key: str, tool: { type: "string", enum: ACTIONS }, args: schema({
      id: referenceId, pageId: referenceId, title: str, content: str, url: str, fileName: str, alt: str,
      location: str, blogname: str, blogdescription: str,
      links: { type: "array", minItems: 1, maxItems: 40, items: schema({ pageId: referenceId, label: str }, ["pageId", "label"]) },
    }) }, ["key", "tool", "args"]) } }, ["title", "steps"]),
};
const refPattern = /\{\{([a-z][a-z0-9_]{0,39})\.(id|url)\}\}/g;
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
function error(message) { throw new Error(message); }
function replaceRefs(value, outputs) {
  if (typeof value === "string") {
    const exact = /^\{\{([a-z][a-z0-9_]{0,39})\.(id|url)\}\}$/.exec(value);
    const get = (key, field) => {
      if (!outputs.has(key) || outputs.get(key)[field] === undefined) error("הפניה לשלב שלא הושלם ואומת");
      return outputs.get(key)[field];
    };
    if (exact) return get(exact[1], exact[2]);
    return value.replace(refPattern, (_match, key, field) => String(get(key, field)));
  }
  if (Array.isArray(value)) return value.map((v) => replaceRefs(v, outputs));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, replaceRefs(v, outputs)]));
  return value;
}
function validatePlan(args, validate) {
  if (!object(args) || Object.keys(args).some((k) => !["title", "steps"].includes(k)) || typeof args.title !== "string" || !args.title.trim() || args.title.length > 300 || /[<>\x00-\x1f]/.test(args.title) || !Array.isArray(args.steps) || !args.steps.length || args.steps.length > MAX_STEPS || JSON.stringify(args).length > 1000000) error("תוכנית בנייה מוגבלת ל־40 שלבים ולגודל כולל של 1 MB");
  const earlier = new Map(), mock = new Map(), ids = new Set();
  const collect = (v) => { if (Number.isSafeInteger(v)) ids.add(v); else if (Array.isArray(v)) v.forEach(collect); else if (object(v)) Object.values(v).forEach(collect); };
  collect(args.steps);
  let synthetic = 1000000000, menus = 0;
  const settings = new Set();
  for (const step of args.steps) {
    if (!object(step) || Object.keys(step).some((k) => !["key", "tool", "args"].includes(k)) || typeof step.key !== "string" || !/^[a-z][a-z0-9_]{0,39}$/.test(step.key) || earlier.has(step.key) || !ACTIONS.includes(step.tool) || !object(step.args)) error("שלב או מזהה תוכנית אינם תקינים");
    const walk = (v, key) => {
      if (typeof v === "string") {
        const refs = [...v.matchAll(refPattern)];
        if (v.includes("{{") && !refs.length) error("הפניה אינה תקינה");
        for (const [, source, field] of refs) {
          const sourceTool = earlier.get(source);
          if (!sourceTool || !["wp_prepare_upload_image", "wp_prepare_create_page", "wp_prepare_create_post"].includes(sourceTool)) error("הפניות מותרות רק ליצירה בשלב קודם");
          if (key === "content") {
            if (field === "url" && sourceTool !== "wp_prepare_upload_image") error("כתובת בתוכן חייבת להגיע מהעלאת תמונה מאומתת");
          } else if (["id", "pageId"].includes(key)) {
            if (v !== `{{${source}.${field}}}` || field !== "id") error("מזהה חייב להיות הפניה מלאה");
            const expected = step.tool.endsWith("_post") ? "wp_prepare_create_post" : "wp_prepare_create_page";
            if (sourceTool !== expected) error("סוג המשאב בהפניה אינו תואם לשלב");
          } else error("הפניות מותרות רק במזהים ובתוכן עמודים");
        }
        if (v.replace(refPattern, "").includes("{{")) error("הפניה לא מוכרת");
      } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
      else if (object(v)) for (const [k, x] of Object.entries(v)) walk(x, k);
    };
    walk(step.args, "");
    validate(step.tool, replaceRefs(step.args, mock));
    if (step.tool === "wp_prepare_menu" && ++menus > 1) error("אפשר להגדיר תפריט ראשי אחד בכל תוכנית");
    const changed = step.tool === "wp_prepare_front_page" ? ["show_on_front", "page_on_front"] : step.tool === "wp_prepare_site_identity" ? Object.keys(step.args) : [];
    for (const key of changed) { if (settings.has(key)) error("כל הגדרת אתר נכתבת פעם אחת בלבד בתוכנית"); settings.add(key); }
    while (ids.has(synthetic)) synthetic--;
    mock.set(step.key, { id: synthetic--, url: `https://plan-reference.invalid/${step.key}.png` });
    earlier.set(step.key, step.tool);
  }
  return mock;
}
class BuildPlans {
  constructor(agent, validate) { this.agent = agent; this.validate = validate; }
  file(id) { return path.join(this.agent.dir, `wordpress-plans-${id}.json`); }
  load(id) {
    if (!fs.existsSync(this.file(id))) return [];
    this.agent.secureLog();
    try {
      const data = JSON.parse(fs.readFileSync(this.file(id), "utf8"));
      const plans = JSON.parse(this.agent.storage.decryptString(Buffer.from(data.encrypted, "base64")));
      if (!Array.isArray(plans)) throw Error();
      return plans;
    } catch { error("לא ניתן לקרוא את תוכניות הבנייה המאובטחות"); }
  }
  save(id, plan) {
    this.agent.secureLog();
    const all = this.load(id).filter((p) => p.id !== plan.id).concat(plan);
    atomic(this.file(id), { version: 1, encrypted: this.agent.storage.encryptString(JSON.stringify(all)).toString("base64") });
  }
  list(id) {
    const log = this.agent.getActivityLog(id);
    return this.load(id).reverse().map((plan) => {
      const steps = plan.steps.map((step) => {
        const record = this.agent.records.find((r) => r.project === id && r.operation === step.operation);
        const row = log.find((e) => e.operation === step.operation);
        const state = record?.state === "verified" ? (row?.state === "restored" ? "restored" : "verified") : record?.state === "executing" && this.agent.running.has(id) ? "executing" : ["unknown", "executing"].includes(record?.state) ? "unknown" : record?.state === "cancelled" ? "failed" : ["running", "stopped"].includes(plan.state) ? "not-run" : step.state;
        return { ...step, state };
      });
      return { ...plan, steps, canUndo: !plan.undoOf && plan.site === this.agent.wp.status(id).site && steps.some((s) => s.state === "verified") };
    });
  }
  async prepare(id, args, signal) {
    const agent = this.agent;
    const mock = validatePlan(args, this.validate);
    agent.secureLog();
    const fingerprint = agent.fingerprint(id), planId = randomUUID();
    const virtual = new Map(), owners = new Map(), steps = [];
    let imageBytes = 0;
    const readPage = async (_project, pageId, _signal, resource) => {
      const key = `${resource}:${pageId}`;
      if (!virtual.has(key)) virtual.set(key, await agent.wp.page(id, pageId, signal, resource));
      return structuredClone(virtual.get(key));
    };
    try {
      for (const [index, definition] of args.steps.entries()) {
        signal.throwIfAborted();
        const resolved = replaceRefs(definition.args, mock);
        const resource = definition.tool.endsWith("_post") ? "posts" : "pages";
        const target = resolved.id ? `${resource}:${resolved.id}` : null;
        const beforeFrom = target ? owners.get(target) : undefined;
        let pending;
        if (definition.tool === "wp_prepare_upload_image") {
          await agent.prepareImage(id, resolved, signal, fingerprint);
          pending = agent.pending.get(id);
          agent.pending.delete(id);
          imageBytes += pending.image.bytes.length;
          if (imageBytes > 50 * 1024 * 1024) error("תוכנית מוגבלת ל־50 MB של תמונות ממתינות לאישור");
        } else if (structureTools.some((t) => t.name === definition.tool)) {
          pending = await agent.structure.prepare(agent, id, definition.tool, resolved, signal, readPage);
        } else {
          const before = definition.tool.startsWith("wp_prepare_update_") ? await readPage(id, resolved.id, signal, resource) : null;
          if (before && !["draft", "publish"].includes(before.status)) error("עדכון נתמך רק בטיוטה או בתוכן מפורסם");
          const payload = {};
          for (const key of ["title", "content"]) if (resolved[key] !== undefined) payload[key] = resolved[key];
          if (!before) payload.status = "draft";
          const preview = { token: randomUUID(), project: id, site: agent.wp.status(id).site, resource,
            kind: before ? "update" : "create", pageId: before?.id || null, status: before?.status || "draft", before, payload,
            expires: agent.now() + 5 * 60 * 1000, warning: before?.status === "publish" ? "השינוי ישפיע מיד על תוכן גלוי לציבור" : "טיוטה בלבד — ללא פרסום" };
          pending = { ...preview, beforeDigest: before ? digest(before) : null, fingerprint, preview: structuredClone(preview) };
        }
        pending.planId = planId; pending.planTitle = args.title; pending.planIndex = index;
        agent.record(pending, "awaiting-review");
        steps.push({ definition: structuredClone(definition), pending, beforeFrom, label: LABELS[definition.tool] });
        if (["create", "update", "publish"].includes(pending.kind)) {
          const pageId = pending.kind === "create" ? mock.get(definition.key).id : resolved.id;
          const projected = { ...(pending.before || { id: pageId, modified: "" }), ...pending.payload, status: pending.status || pending.payload.status };
          virtual.set(`${resource}:${pageId}`, projected);
          owners.set(`${resource}:${pageId}`, definition.key);
        }
      }
      signal.throwIfAborted();
      if (fingerprint !== agent.fingerprint(id)) error("חיבור האתר השתנה; התוכנית בוטלה");
      const preview = { token: planId, project: id, site: agent.wp.status(id).site, kind: "build-plan", resource: "plan", title: args.title,
        expires: agent.now() + 5 * 60 * 1000, warning: "האישור חל על כל השלבים לפי הסדר. פרסום, תפריט ודף בית עשויים לשנות את האתר הגלוי. הביצוע נעצר בכשל הראשון, ללא ניסיון חוזר או ביטול אוטומטי. הפניות {{step.id}} / {{step.url}} ייקבעו רק מתוצאות מאומתות של שלבים קודמים.",
        steps: steps.map((s, index) => ({ number: index + 1, key: s.definition.key, label: s.label, payload: s.definition.args, before: s.pending.before, warning: s.pending.warning })) };
      agent.pending.set(id, { ...preview, fingerprint, steps, preview: structuredClone(preview) });
      return { text: `הוכנה תוכנית בנייה עם ${steps.length} שלבים לבדיקה. לא בוצעה כתיבה.`, review: agent.review(id) };
    } catch (e) { agent.pending.delete(id); throw e; }
  }
  compile(step, results) {
    const p = { ...step.pending };
    if (step.beforeFrom) {
      const result = results.get(step.beforeFrom)?.page;
      if (!result) error("מצב השלב הקודם חסר; התוכנית נעצרה");
      p.before = structuredClone(result); p.beforeDigest = digest(p.before);
    }
    if (!step.definition) return p;
    const outputs = new Map([...results].map(([key, result]) => [key, result.media ? { id: result.media.id, url: result.media.source } : { id: result.page?.id }]));
    const args = replaceRefs(step.definition.args, outputs);
    this.validate(step.definition.tool, args);
    if (["create", "update"].includes(p.kind)) {
      p.payload = {};
      for (const key of ["title", "content"]) if (args[key] !== undefined) p.payload[key] = args[key];
      if (p.kind === "create") p.payload.status = "draft";
      else p.pageId = args.id;
      p.status = p.before?.status || "draft";
    } else if (p.kind === "publish") { p.pageId = args.id; if (p.before.status !== "draft") error("שלב הפרסום אינו פועל על טיוטה"); }
    else if (p.kind === "front-page") p.payload = { show_on_front: "page", page_on_front: args.pageId };
    else if (p.kind === "menu") p.payload = args;
    return p;
  }
  async execute(id, approved, signal) {
    const agent = this.agent, results = new Map();
    const journal = { id: approved.token, title: approved.title, site: approved.site, at: new Date(agent.now()).toISOString(), state: "running", undoOf: approved.undoOf || null,
      steps: approved.steps.map((s, index) => ({ key: s.definition?.key || `undo_${index}`, label: s.label, operation: s.pending.token, state: "not-run" })) };
    this.save(id, journal); // A durable manifest must exist before the first external write.
    for (const [index, step] of approved.steps.entries()) {
      try {
        signal.throwIfAborted();
        if (approved.fingerprint !== agent.fingerprint(id) || agent.blocked.has(id)) error("החיבור השתנה או כתיבות הפרויקט נחסמו");
        const p = this.compile(step, results);
        journal.steps[index].state = "executing";
        this.save(id, journal);
        const stepSignal = AbortSignal.any([signal, AbortSignal.timeout(p.structure ? 180000 : 45000)]);
        const result = await agent.executeApproved(id, p, stepSignal);
        results.set(journal.steps[index].key, result);
        journal.steps[index].state = "verified";
        this.save(id, journal);
      } catch (e) {
        const record = agent.records.find((r) => r.operation === step.pending.token);
        journal.steps[index].state = record?.state === "verified" ? "verified" : ["unknown", "executing"].includes(record?.state) ? "unknown" : "failed";
        if (journal.steps[index].state === "failed") {
          try { agent.record(step.pending, "cancelled"); } catch { /* Keep the stopped summary available even if persistence failed. */ }
        }
        journal.state = "stopped";
        journal.error = e.message;
        break;
      }
    }
    if (journal.state === "running") journal.state = "complete";
    try { this.save(id, journal); } catch { journal.error = "לא ניתן לשמור את סיכום התוכנית. תוצאות השלבים נשמרו ביומן הפעולות; אין ניסיון חוזר."; }
    const states = { verified: "הושלם ואומת", unknown: "תוצאה לא ידועה — יש לבדוק באתר", failed: "נכשל — לא הושלם", "not-run": "לא הופעל" };
    return { text: `${approved.kind === "undo-plan" ? "ביטול התוכנית" : "תוכנית בנייה"}: ${approved.title}\n${journal.steps.map((s, i) => `${i + 1}. ${s.label}: ${states[s.state] || s.state}`).join("\n")}\n${journal.error || "כל השלבים אומתו."}`, plan: journal };
  }
  async prepareUndo(id, planId) {
    const agent = this.agent;
    if (agent.running.has(id) || agent.blocked.has(id)) error("פעולה מתבצעת או הפרויקט חסום; יש לבדוק באתר לפני ביטול התוכנית");
    const plan = this.list(id).find((p) => p.id === planId && !p.undoOf);
    if (!plan || plan.site !== agent.wp.status(id).site) error("התוכנית אינה שייכת לפרויקט ולאתר הנוכחי");
    const rows = agent.getActivityLog(id).filter((e) => e.planId === planId && e.state === "verified").sort((a, b) => b.planIndex - a.planIndex);
    if (!rows.length || rows.length > MAX_STEPS) error("אין שלבים מאומתים שנותרו לביטול");
    const controller = new AbortController();
    agent.running.set(id, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]);
    const fingerprint = agent.fingerprint(id), token = randomUUID(), virtual = new Map(), owners = new Map(), steps = [];
    agent.pending.delete(id);
    try {
      for (const [index, entry] of rows.entries()) {
        const key = `${entry.resource}:${entry.pageId}`;
        const pageKind = ["create", "update", "publish"].includes(entry.action);
        let current;
        if (pageKind) {
          if (!virtual.has(key)) virtual.set(key, await agent.wp.page(id, entry.pageId, signal, entry.resource));
          current = structuredClone(virtual.get(key));
          if (!same(pick(current, ["title", "content", "status"]), entry.written)) error("תוכן שלב בתוכנית השתנה באתר; יש לבדוק אותו לפני ביטול כל התוכנית");
        }
        let p;
        if (["menu", "front-page", "site-identity", "publish"].includes(entry.action)) {
          p = await agent.structure.prepareUndo(agent, id, entry, signal, current);
        } else {
          let kind, payload, status, warning;
          if (entry.action === "upload") {
            if (!agent.ownsUpload(id, entry)) error("התמונה אינה בבעלות האפליקציה");
            current = await agent.wp.mediaItem(id, entry.pageId, signal);
            if (!current || !same(current, entry.writtenMedia)) error("התמונה השתנתה מאז ההעלאה");
            kind = "delete-media"; status = "deleted";
            payload = { mediaId: entry.pageId, fileName: entry.title, url: current.source, alt: current.alt };
            warning = "מחיקת תמונה לצמיתות; היא עלולה להיעלם מעמודים המשתמשים בה.";
          } else if (entry.action === "create") {
            if (!entry.createdByApp || current.status !== "draft") error("ניתן לבטל יצירה רק אחרי החזרת פרסום לטיוטה");
            kind = "trash"; status = "trash"; payload = { status: "trash" }; warning = "העברת טיוטה שנוצרה באפליקציה לפח";
          } else if (entry.action === "update" && entry.before) {
            kind = "update"; status = current.status; payload = pick(entry.before, ["title", "content"]); warning = "שחזור הכותרת והתוכן הקודמים";
          } else error("שלב זה אינו ניתן לביטול כחלק מתוכנית");
          const preview = { token: randomUUID(), project: id, site: entry.site, resource: entry.resource, kind, pageId: entry.pageId,
            before: current, payload, status, warning, expires: agent.now() + 5 * 60 * 1000 };
          p = { ...preview, beforeDigest: digest(current), fingerprint, undoLogId: entry.id, preview: structuredClone(preview) };
        }
        p.planId = token; p.planTitle = `ביטול: ${plan.title}`; p.planIndex = index;
        agent.record(p, "awaiting-review");
        steps.push({ pending: p, beforeFrom: owners.get(key), label: `ביטול שלב ${entry.planIndex + 1}: ${entry.title}` });
        if (pageKind) {
          virtual.set(key, { ...current, ...p.payload });
          owners.set(key, `undo_${index}`);
        }
      }
      signal.throwIfAborted();
      if (fingerprint !== agent.fingerprint(id)) error("החיבור השתנה; ביטול התוכנית בוטל");
      const preview = { token, project: id, site: plan.site, title: plan.title, kind: "undo-plan", resource: "plan", undoOf: planId,
        expires: agent.now() + 5 * 60 * 1000, warning: "ביטול השלבים שהושלמו ואומתו, בסדר הפוך. שלבים שנכשלו או שתוצאתם אינה ידועה אינם נכללים. עצירה בכשל הראשון, ללא ניסיון חוזר. מחיקת תמונות היא לצמיתות.",
        steps: steps.map((s, i) => ({ number: i + 1, label: s.label, payload: s.pending.payload, before: s.pending.before, warning: s.pending.warning })) };
      agent.pending.set(id, { ...preview, fingerprint, steps, preview: structuredClone(preview) });
      return agent.review(id);
    } finally { if (agent.running.get(id) === controller) agent.running.delete(id); }
  }
}
module.exports = { BuildPlans, planTool, validatePlan, replaceRefs, MAX_STEPS };
