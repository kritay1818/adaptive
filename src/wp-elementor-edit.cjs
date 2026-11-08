"use strict";
// Working with an EXISTING Elementor page (a real site's own content):
//   wp_prepare_duplicate_page   a draft copy: title + suffix, the Elementor data, page settings and template exactly as they are
//   wp_prepare_elementor_edit   targeted operations on elements by id: set properties, insert kit sections, remove, move
// Nothing the operations do not name is touched: unknown, third-party and Pro widgets stay as they are, key for key. New content
// (texts, links, images, colors) goes through the same validator and builder as every other Elementor write. The helpers of
// wp-elementor.cjs arrive lazily in `h` (this file is loaded before they exist). Everything else is reached through `this`.
const { PATTERNS } = require("./elementor-kit/index.cjs");
const { createHash } = require("node:crypto");

const EDIT_TOOL = "wp_prepare_elementor_edit";
const DUP_TOOL = "wp_prepare_duplicate_page";
const PAGE_TOOL = "wp_prepare_elementor_page";
const ID = /^[A-Za-z0-9]{3,16}$/;
const MAX_OPS = 30;
const MAX_COPY = 2.5 * 1024 * 1024; // largest page that is copied or edited (it is also kept for undo)
const DUMMY_MEDIA = 999999999; // stands in for an image while a probe element is built (never written)
const SENT = "​"; // placeholder text that can never equal real input
const COPY_SUFFIX = " — עותק";
const POSITIONS = ["before", "after", "start", "end"];

const schema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = { type: "string" };

// What the model may put in `set`: the properties of the widgets and containers the app can build, as one flat bag.
function setProps(idSchema, S) {
  const { type: _t, ...widget } = S.widgetProps(idSchema, false);
  return {
    ...widget,
    ...S.containerProps(idSchema),
    align: { type: "string", enum: ["start", "center", "end", "stretch"] },
    width: {
      anyOf: [
        { type: "integer", minimum: 1, maximum: 100 },
        { type: "string", enum: ["boxed", "full"] },
      ],
    },
  };
}
function operationsSchema(idSchema, S) {
  return {
    type: "array",
    minItems: 1,
    maxItems: MAX_OPS,
    items: schema(
      {
        op: { type: "string", enum: ["set", "insert", "remove", "move"] },
        id: str,
        set: schema(setProps(idSchema, S)),
        position: { type: "string", enum: POSITIONS },
        target: str,
        patterns: S.patternsSchema(idSchema),
        containers: S.containersSchema(idSchema),
      },
      ["op"],
    ),
  };
}
function tools(S) {
  const id = { type: "integer" };
  return [
    {
      name: DUP_TOOL,
      description:
        "Create a DRAFT copy of an existing Elementor page: title + ' — עותק' (or your title), the full Elementor data, page settings and template copied exactly as they are (the site's own content; nothing new is added). Use it for 'copy this page and change X', then change the copy with wp_prepare_elementor_edit. Never rebuild an existing page from scratch. Nothing is written before the user approves the review card; undo moves the copy to the trash.",
      parameters: schema({ id, title: str }, ["id"]),
    },
    {
      name: EDIT_TOOL,
      description:
        "Targeted edit of an EXISTING Elementor page; everything not named stays exactly as it is (unknown, third-party and Pro widgets included). Read the page first with wp_read_elementor_page: it lists every element id. operations: set {id, set:{text, html, color, background, mediaId, backgroundImage, url, paddingX, size, ...}} for known widgets and containers; insert {position before|after + target id (the section containing it) or start|end, patterns / containers}; remove {id}; move {id, position, target}. Never send Elementor JSON, HTML, scripts or code. Nothing is written before the user approves the review card; read-back and undo as usual.",
      parameters: schema({ id, operations: operationsSchema(id, S) }, [
        "id",
        "operations",
      ]),
    },
  ];
}

// ---- reading helpers (pure) ---------------------------------------------------------------------------------------------------
const strip = (s) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const cut = (s, n) =>
  String(s).length > n ? String(s).slice(0, n) + "…" : String(s);
const SUPPORTED = new Set([
  "heading",
  "text-editor",
  "image",
  "button",
  "spacer",
  "divider",
  "icon-list",
  "video",
]);
const HE_TYPE = {
  container: "אזור",
  heading: "כותרת",
  "text-editor": "טקסט",
  image: "תמונה",
  button: "כפתור",
  spacer: "רווח",
  divider: "קו מפריד",
  "icon-list": "רשימה",
  video: "וידאו",
};
const HE_PROP = {
  text: "טקסט",
  html: "טקסט",
  level: "רמת כותרת",
  align: "יישור",
  color: "צבע",
  background: "רקע",
  size: "גודל",
  weight: "משקל",
  font: "גופן",
  url: "קישור",
  newTab: "פתיחה בלשונית חדשה",
  mediaId: "תמונה",
  alt: "טקסט חלופי",
  width: "רוחב",
  height: "גובה",
  thickness: "עובי",
  items: "פריטים",
  icon: "אייקון",
  controls: "פקדי וידאו",
  loop: "לולאה",
  direction: "כיוון",
  justify: "יישור ראשי",
  gap: "מרווח",
  paddingX: "ריפוד אופקי",
  paddingY: "ריפוד אנכי",
  minHeight: "גובה מינימלי",
  widthPercent: "רוחב באחוזים",
  radius: "פינות מעוגלות",
  wrap: "שבירת שורה",
  backgroundImage: "תמונת רקע",
  overlay: "שכבת צבע",
  overlayOpacity: "שקיפות השכבה",
};
const kindOf = (el) =>
  el?.elType === "container" ? "container" : el?.widgetType;
const kids = (el) => (Array.isArray(el?.elements) ? el.elements : []);
function textOf(el) {
  const s = el.settings || {};
  switch (el.widgetType) {
    case "heading":
      return s.title;
    case "text-editor":
      return strip(s.editor);
    case "button":
      return s.text;
    case "image":
      return s.image?.alt;
    case "icon-list":
      return s.icon_list?.[0]?.text;
    default:
      return (
        s.title ||
        s.text ||
        strip(s.editor) ||
        s.heading ||
        s.label ||
        s.button_text ||
        ""
      );
  }
}
function firstText(el) {
  if (el.elType !== "container") return strip(textOf(el));
  for (const c of kids(el)) {
    const t = firstText(c);
    if (t) return t;
  }
  return "";
}
function label(el) {
  const t = firstText(el);
  const type = kindOf(el);
  return `${HE_TYPE[type] || type || "אלמנט"}${t ? ` '${cut(t, 30)}'` : ""} #${el.id}`;
}
function countAll(data) {
  let n = 0;
  const walk = (list) =>
    list.forEach((el) => {
      n++;
      walk(kids(el));
    });
  walk(Array.isArray(data) ? data : []);
  return n;
}
// Types in the page that the app does not build (kept exactly as they are).
function foreignTypes(data) {
  const out = new Set();
  const walk = (list) =>
    list.forEach((el) => {
      if (el?.elType === "widget" && !SUPPORTED.has(el.widgetType))
        out.add(String(el.widgetType || "widget").slice(0, 40));
      else if (el?.elType && !["container", "widget"].includes(el.elType))
        out.add(String(el.elType).slice(0, 40));
      walk(kids(el));
    });
  walk(Array.isArray(data) ? data : []);
  return [...out];
}
// One entry per element: id, depth, type, a short preview and the main editable settings. Unknown widgets are read-only.
function outlineOf(data, max = 500) {
  const entries = [];
  let total = 0;
  const col = (s, key) => {
    const g = s.__globals__?.[key];
    const m =
      typeof g === "string" && /^globals\/colors\?id=([a-z0-9_-]+)$/.exec(g);
    return m
      ? `global:${m[1]}`
      : typeof s[key] === "string"
        ? s[key]
        : undefined;
  };
  const clean = (o) =>
    Object.fromEntries(
      Object.entries(o).filter(
        ([, v]) => v !== undefined && v !== "" && v !== null,
      ),
    );
  const settings = (el) => {
    const s = el.settings || {};
    switch (kindOf(el)) {
      case "container":
        return clean({
          background: col(s, "background_color"),
          backgroundImage: s.background_image?.id,
          overlay: col(s, "background_overlay_color"),
          direction: s.flex_direction,
          paddingY: s.padding?.top,
          paddingX: s.padding?.right,
          minHeight: s.min_height?.size,
          width: s.content_width,
          widthPercent: s.width?.size,
        });
      case "heading":
        return clean({
          text: cut(s.title ?? "", 100),
          level: s.header_size,
          color: col(s, "title_color"),
          url: s.link?.url,
          size: s.typography_font_size?.size,
        });
      case "text-editor":
        return clean({
          text: cut(strip(s.editor), 120),
          color: col(s, "text_color"),
        });
      case "image":
        return clean({
          mediaId: s.image?.id,
          alt: s.image?.alt,
          url: s.link?.url,
          width: s.width?.size,
        });
      case "button":
        return clean({
          text: s.text,
          url: s.link?.url,
          color: col(s, "button_text_color"),
          background: col(s, "background_color"),
        });
      case "icon-list":
        return clean({ items: (s.icon_list || []).length });
      case "video":
        return clean({
          url: s.youtube_url || s.vimeo_url,
          mediaId: s.hosted_url?.id,
        });
      case "spacer":
        return clean({ height: s.space?.size });
      default:
        return {};
    }
  };
  const walk = (list, depth) =>
    list.forEach((el) => {
      if (!el || typeof el !== "object") return;
      total++;
      if (entries.length >= max) return walk(kids(el), depth + 1);
      const type = kindOf(el) || "unknown";
      const known = type === "container" || SUPPORTED.has(type);
      const entry = {
        id: String(el.id ?? ""),
        depth,
        type,
        ...(known
          ? { set: settings(el) }
          : { readOnly: true, preview: cut(strip(textOf(el)), 80) }),
        ...(kids(el).length ? { children: kids(el).length } : {}),
      };
      if (type === "container") {
        const t = firstText(el);
        if (t) entry.preview = cut(t, 60);
      }
      entries.push(entry);
      walk(kids(el), depth + 1);
    });
  walk(Array.isArray(data) ? data : [], 0);
  return { entries, total, truncated: total > entries.length };
}

module.exports = function edit(h) {
  // ---- validation (pure) ------------------------------------------------------------------------------------------------------
  function validateDuplicate(args) {
    if (!h.object(args)) h.fail("ארגומנטים לא תקינים");
    h.onlyKeys(args, ["id", "title"], DUP_TOOL);
    if (!h.numericId(args.id)) h.fail("id: מזהה העמוד המקורי לא תקין");
    if (args.title !== undefined) h.plain(args.title, 300, "title");
    return structuredClone(args);
  }
  function validateEdit(args) {
    if (!h.object(args)) h.fail("ארגומנטים לא תקינים");
    h.onlyKeys(args, ["id", "operations"], EDIT_TOOL);
    if (!h.numericId(args.id)) h.fail("id: מזהה עמוד לא תקין");
    const ops = args.operations;
    if (!Array.isArray(ops) || !ops.length || ops.length > MAX_OPS)
      h.fail(`operations: 1 עד ${MAX_OPS} פעולות`);
    ops.forEach((op, i) => {
      const L = `operations[${i}]`;
      if (!h.object(op)) h.fail(`${L}: אובייקט עם op`);
      const allowed = {
        set: ["op", "id", "set"],
        insert: ["op", "position", "target", "patterns", "containers"],
        remove: ["op", "id"],
        move: ["op", "id", "position", "target"],
      }[op.op];
      if (!allowed) h.fail(`${L}.op: set, insert, remove או move`);
      h.onlyKeys(op, allowed, L);
      if (op.op !== "insert" && !(typeof op.id === "string" && ID.test(op.id)))
        h.fail(`${L}.id: מזהה אלמנט מהעמוד (מ־wp_read_elementor_page)`);
      if (
        op.target !== undefined &&
        !(typeof op.target === "string" && ID.test(op.target))
      )
        h.fail(`${L}.target: מזהה אלמנט מהעמוד`);
      if (op.op === "set") {
        if (!h.object(op.set) || !Object.keys(op.set).length)
          h.fail(`${L}.set: אובייקט עם המאפיינים לשינוי`);
      }
      if (op.op === "insert" || op.op === "move") {
        const allowedPositions =
          op.op === "insert" ? POSITIONS : ["before", "after"];
        if (!allowedPositions.includes(op.position))
          h.fail(`${L}.position: ${allowedPositions.join(", ")}`);
        if (["before", "after"].includes(op.position) && !op.target)
          h.fail(`${L}.target: נדרש מזהה אלמנט ליד ${op.position}`);
        if (["start", "end"].includes(op.position) && op.target !== undefined)
          h.fail(`${L}.target: אסור עם ${op.position} (תחילת/סוף העמוד)`);
      }
      if (op.op === "move" && op.id === op.target)
        h.fail(`${L}: אי אפשר להזיז אלמנט לעצמו`);
      if (op.op === "insert") {
        if (op.patterns === undefined && op.containers === undefined)
          h.fail(`${L}: נדרשים patterns או containers להוספה`);
        try {
          h.validateElementor(PAGE_TOOL, {
            title: "x",
            patterns: op.patterns,
            containers: op.containers,
          });
        } catch (e) {
          h.fail(`${L}: ${e.message}`);
        }
      }
    });
    return structuredClone(args);
  }

  // ---- applying operations ------------------------------------------------------------------------------------------------------
  function indexOf(data) {
    const map = new Map(),
      dup = new Set();
    const walk = (list, parent, top) =>
      list.forEach((el, index) => {
        if (!h.object(el)) return;
        const t = top ?? el;
        if (typeof el.id === "string") {
          if (map.has(el.id)) dup.add(el.id);
          else map.set(el.id, { el, list, index, parent, top: t });
        }
        walk(kids(el), el, t);
      });
    walk(data, null, null);
    return { map, dup };
  }
  // Settings of a probe element as one flat map: __globals__ entries become "__g__<key>".
  function flat(settings) {
    const { __globals__: g, ...rest } = settings || {};
    for (const [k, v] of Object.entries(g || {})) rest[`__g__${k}`] = v;
    return rest;
  }
  const DEFAULTS = {
    heading: { text: SENT },
    "text-editor": { html: `<p>${SENT}</p>` },
    image: { mediaId: DUMMY_MEDIA },
    button: { text: SENT, url: "/probe/" },
    spacer: { height: 0 },
    divider: {},
    "icon-list": { items: [{ text: SENT }] },
    video: { mediaId: DUMMY_MEDIA },
  };
  // A different, still buildable value for the same property: keys that change between the two probes depend on it.
  function other(key, v) {
    if (typeof v === "number")
      return ["mediaId", "backgroundImage"].includes(key)
        ? DUMMY_MEDIA - 1
        : v + 1;
    if (typeof v === "boolean") return !v;
    if (Array.isArray(v)) return [{ text: `${SENT}b` }];
    if (typeof v !== "string") return v;
    if (key === "font") return v === "global:zz" ? "global:yy" : "global:zz";
    if (["color", "background", "overlay"].includes(key))
      return v === "#000000" ? "#111111" : "#000000";
    if (key === "align") return v === "center" ? "start" : "center";
    if (key === "direction") return v === "row" ? "column" : "row";
    if (key === "justify") return v === "center" ? "start" : "center";
    if (key === "width") return v === "full" ? "boxed" : "full";
    if (key === "icon") return v === "star" ? "check" : "star";
    if (key === "url") return v === "/__a/" ? "/__b/" : "/__a/";
    return `${v}${SENT}`;
  }
  const shortValue = (k, v) =>
    k === "mediaId" || k === "backgroundImage"
      ? `תמונה #${v}`
      : k === "items"
        ? `${v.length} פריטים`
        : typeof v === "boolean"
          ? v
            ? "כן"
            : "לא"
          : cut(strip(v), 50);

  // Gives new elements ids that no element of the page has.
  function reid(list, taken) {
    for (const el of list) {
      let id = el.id,
        n = 0;
      while (taken.has(id))
        id = createHash("sha1")
          .update(`${el.id}:${++n}`)
          .digest("hex")
          .slice(0, 8);
      el.id = id;
      taken.add(id);
      reid(kids(el), taken);
    }
  }

  const methods = {
    // The text/globals/media that the operations use, shaped like a simple structure so the page machinery can check them.
    editUsage(a, expanded, original) {
      const idx = indexOf(original);
      const nodes = [];
      for (const op of a.operations) {
        if (op.op !== "set") continue;
        const video = idx.map.get(op.id)?.el?.widgetType === "video";
        const node = {};
        for (const k of [
          "color",
          "background",
          "overlay",
          "font",
          "backgroundImage",
        ])
          if (op.set[k] !== undefined) node[k] = op.set[k];
        if (op.set.mediaId !== undefined) {
          node.mediaId = op.set.mediaId;
          node.type = video ? "video" : "image";
        }
        if (Object.keys(node).length) nodes.push(node);
      }
      return {
        containers: [
          ...[...expanded.values()].flat(),
          ...(nodes.length ? [{ children: nodes }] : []),
        ],
      };
    },
    // Applies the operations to a copy of the page data. Returns the new data, its JSON, and readable change lines.
    async applyEdit(project, a, current, env, signal) {
      const original = h.parseData(current.data || "[]");
      const work = structuredClone(original);
      const expanded = new Map();
      a.operations.forEach((op, i) => {
        if (op.op !== "insert") return;
        const v = h.validateElementor(
          PAGE_TOOL,
          { title: "x", patterns: op.patterns, containers: op.containers },
          { palette: env.palette, values: env.values },
        );
        expanded.set(i, v.containers);
      });
      const usage = this.editUsage(a, expanded, original);
      if (env.info) this.assertGlobals(usage, env.info);
      const media = await this.resolveMedia(
        project,
        usage,
        signal,
        env.mockIds,
      );
      const dummy = (id) => ({
        id,
        url: `https://${h.MOCK_HOST}/probe-${id}.png`,
        alt: "",
      });
      media.set(DUMMY_MEDIA, dummy(DUMMY_MEDIA));
      media.set(DUMMY_MEDIA - 1, dummy(DUMMY_MEDIA - 1));
      const ctx = { rtl: env.rtl, media };
      const origin = new URL(this.wp.status(project).site).origin;
      const taken = new Set();
      const collectIds = (list) =>
        list.forEach((el) => {
          if (typeof el?.id === "string") taken.add(el.id);
          collectIds(kids(el));
        });
      collectIds(work);
      const changes = [];
      // Labels are taken from the page as it was read, so the list matches what the user and the model saw.
      const labels = new Map();
      const labelAll = (list) =>
        list.forEach((el) => {
          if (typeof el?.id === "string") labels.set(el.id, label(el));
          labelAll(kids(el));
        });
      labelAll(original);
      const lab = (el) => labels.get(el.id) ?? label(el);
      const find = (idx, id) => {
        const hit = idx.map.get(id);
        if (!hit)
          h.fail(
            `האלמנט ${id} לא נמצא בעמוד (ייתכן שהוסר בפעולה קודמת). קראו שוב את העמוד.`,
          );
        if (idx.dup.has(id))
          h.fail(
            `המזהה ${id} מופיע יותר מפעם אחת בעמוד, ולכן אי אפשר לטפל בו בבטחה.`,
          );
        return hit;
      };
      for (const [i, op] of a.operations.entries()) {
        const L = `operations[${i}]`;
        const idx = indexOf(work);
        if (op.op === "set") {
          const hit = find(idx, op.id);
          const el = hit.el;
          const isC = el.elType === "container";
          const type = kindOf(el);
          if (!isC && !SUPPORTED.has(type))
            h.fail(
              `האלמנט ${op.id} הוא ווידג'ט '${type}' שהאפליקציה אינה בונה, ולכן אפשר רק להסיר או להזיז אותו, לא לשנות.`,
            );
          const set = { ...op.set };
          el.settings = h.object(el.settings) ? el.settings : {};
          const s = el.settings;
          const exclude = new Set();
          if (isC) {
            // One padding side keeps the other as it is.
            if ((set.paddingX === undefined) !== (set.paddingY === undefined)) {
              if (set.paddingY === undefined)
                set.paddingY = Number(s.padding?.top) || 0;
              else set.paddingX = Number(s.padding?.right) || 0;
            }
            if (
              (set.overlay !== undefined || set.overlayOpacity !== undefined) &&
              set.backgroundImage === undefined
            ) {
              if (!s.background_image?.id)
                h.fail(`${L}.set: שכבת צבע אפשרית רק באזור שיש לו תמונת רקע`);
              set.backgroundImage = DUMMY_MEDIA;
              for (const k of [
                "background_image",
                "background_position",
                "background_repeat",
                "background_size",
                "background_background",
              ])
                exclude.add(k);
              if (set.overlay === undefined) {
                // Opacity alone: only the opacity changes.
                set.overlay = "#000000";
                exclude.add("background_overlay_color");
                exclude.add("background_overlay_background");
                exclude.add("__g__background_overlay_color");
              }
            }
          } else {
            if (set.newTab !== undefined && set.url === undefined) {
              if (!s.link?.url)
                h.fail(
                  `${L}.set: אין לאלמנט קישור שאפשר לשנות לו את פתיחת הלשונית`,
                );
              set.url = s.link.url;
            }
            if (type === "image" && set.mediaId === undefined)
              exclude.add("image");
            if (
              type === "video" &&
              set.url === undefined &&
              set.mediaId === undefined
            ) {
              exclude.add("hosted_url");
              exclude.add("video_type");
            }
            if (type === "icon-list" && set.items && set.icon === undefined) {
              const v = s.icon_list?.[0]?.selected_icon?.value;
              const key = Object.entries(h.ICONS).find(
                ([, [val]]) => val === v,
              )?.[0];
              if (key) set.icon = key;
            }
          }
          // Validation of the new values with the same checks as new content.
          const count = { n: 0 };
          const dummyChild = [{ type: "spacer", height: 0 }];
          const node = isC
            ? { children: dummyChild, ...set }
            : { type, ...DEFAULTS[type], ...set };
          const base = isC
            ? { children: dummyChild }
            : { type, ...DEFAULTS[type] };
          if (isC)
            h.checkContainer(node, `${L}.set`, count, hit.parent !== null);
          else h.checkWidget(node, `${L}.set`, count);
          const build = (n) =>
            isC
              ? h.containerElement(n, `edit/${op.id}`, ctx, hit.parent !== null)
              : h.widgetElement(n, `edit/${op.id}`, ctx);
          const altNode = { ...node };
          for (const k of Object.keys(set)) altNode[k] = other(k, set[k]);
          const probe = build(node);
          const p1 = flat(probe.settings),
            p0 = flat(build(base).settings),
            p2 = flat(build(altNode).settings);
          h.checkBuilt([{ ...probe, elements: [] }], { rtl: env.rtl }, origin);
          const J = JSON.stringify;
          const applied = [];
          for (const k of new Set([...Object.keys(p1), ...Object.keys(p2)])) {
            if (exclude.has(k)) continue;
            if (J(p1[k]) === J(p0[k]) && J(p1[k]) === J(p2[k])) continue;
            applied.push(k);
            if (k.startsWith("__g__")) {
              const real = k.slice(5);
              s.__globals__ = h.object(s.__globals__) ? s.__globals__ : {};
              if (p1[k] === undefined) delete s.__globals__[real];
              else s.__globals__[real] = p1[k];
            } else if (p1[k] === undefined) delete s[k];
            else s[k] = structuredClone(p1[k]);
          }
          // A direct value replaces a global reference of the same setting (the reference would win otherwise).
          for (const k of applied)
            if (
              !k.startsWith("__g__") &&
              p1[`__g__${k}`] === undefined &&
              h.object(s.__globals__)
            )
              delete s.__globals__[k];
          if (h.object(s.__globals__) && !Object.keys(s.__globals__).length)
            delete s.__globals__;
          if (
            type === "image" &&
            set.mediaId === undefined &&
            op.set.alt !== undefined
          )
            s.image = {
              ...(h.object(s.image) ? s.image : {}),
              alt: op.set.alt,
            };
          const name = lab(el);
          for (const [k, v] of Object.entries(op.set))
            changes.push(`${name}: ${HE_PROP[k] || k} ← ${shortValue(k, v)}`);
        } else if (op.op === "insert") {
          const containers = expanded.get(i);
          const built = containers.map((c, j) =>
            h.containerElement(c, `edit${i}/c${j}`, ctx, false),
          );
          reid(built, taken);
          h.checkBuilt(built, { rtl: env.rtl }, origin);
          let at, where;
          if (op.position === "start") {
            at = 0;
            where = "בתחילת העמוד";
          } else if (op.position === "end") {
            at = work.length;
            where = "בסוף העמוד";
          } else {
            const hit = find(idx, op.target);
            at = work.indexOf(hit.top) + (op.position === "after" ? 1 : 0);
            where = `${op.position === "after" ? "אחרי" : "לפני"} ${lab(hit.top)}`;
          }
          work.splice(at, 0, ...built);
          const names = (op.patterns || []).map(
            (p) => `'${PATTERNS[p.pattern]?.label || p.pattern}'`,
          );
          const extra = op.containers?.length
            ? [`${op.containers.length} אזורים חופשיים`]
            : [];
          changes.push(`נוסף ${[...names, ...extra].join(", ")} ${where}`);
        } else if (op.op === "remove") {
          const hit = find(idx, op.id);
          const foreign = foreignTypes([hit.el]);
          changes.push(
            `הוסר ${lab(hit.el)}${countAll([hit.el]) > 1 ? ` (כולל ${countAll([hit.el]) - 1} אלמנטים בתוכו)` : ""}${foreign.length ? ` — כולל ווידג'טים שהאפליקציה אינה בונה: ${foreign.join(", ")}` : ""}`,
          );
          hit.list.splice(hit.index, 1);
        } else if (op.op === "move") {
          const hit = find(idx, op.id);
          const tgt = find(idx, op.target);
          const inside = (el) => el.id === op.target || kids(el).some(inside);
          if (inside(hit.el)) h.fail(`${L}: אי אפשר להזיז אלמנט לתוך עצמו`);
          if (hit.el.elType !== "container" && tgt.parent === null)
            h.fail(
              `${L}: ווידג'ט אי אפשר להניח ברמה העליונה של העמוד; הזיזו אותו ליד אלמנט בתוך אזור`,
            );
          const name = lab(hit.el);
          hit.list.splice(hit.index, 1);
          const after = indexOf(work);
          const t2 = after.map.get(op.target);
          t2.list.splice(
            t2.index + (op.position === "after" ? 1 : 0),
            0,
            hit.el,
          );
          changes.push(
            `הוזז ${name} ${op.position === "after" ? "אחרי" : "לפני"} ${lab(tgt.el)}`,
          );
        }
      }
      const text = JSON.stringify(work);
      if (h.canonText(original) === h.canonText(work))
        h.fail("אין שינוי: הפעולות המבוקשות לא משנות את העמוד");
      if (Buffer.byteLength(text) > MAX_COPY)
        h.fail("העמוד אחרי השינוי גדול מדי (מעל 2.5MB); צמצמו את ההוספות");
      return { data: work, text, changes, elements: countAll(work) };
    },
    async globalValuesFor(project, info, a, signal) {
      return a.operations.some((o) => o.op === "insert" && o.patterns)
        ? this.templateGlobalValues(project, info, signal)
        : null;
    },
    checkEditable(page, what) {
      if (page.editMode !== "builder")
        h.fail(
          "העמוד אינו עמוד Elementor (נבנה בעורך הרגיל), ולכן אי אפשר לערוך אותו כאן. צרו עמוד חדש או ערכו אותו בעורך הרגיל.",
        );
      if (!["draft", "publish", "pending", "private"].includes(page.status))
        h.fail(
          `${what} נתמך רק בעמוד שהוא טיוטה, ממתין לבדיקה, פרטי או מפורסם`,
        );
      if (Buffer.byteLength(page.data || "") > MAX_COPY)
        h.fail(
          "העמוד גדול מדי (מעל 2.5MB) כדי לשמור אותו לשחזור, ולכן האפליקציה לא תשנה אותו.",
        );
    },
    // plan = { mockIds, pages } while a build plan is only being prepared: pages is the plan's virtual Elementor pages.
    async prepareEdit(agent, project, args, signal, plan = null) {
      const a = validateEdit(args);
      const info = await this.gate(project, signal);
      const virtual = plan?.pages?.get(a.id);
      const current = virtual
        ? { ...structuredClone(virtual), id: a.id }
        : await this.readPage(project, a.id, signal);
      this.checkEditable(current, "עריכה");
      const palette = info.globals ? null : h.DEFAULT_PALETTE;
      const values = await this.globalValuesFor(project, info, a, signal);
      const rtl =
        h.hebrew(h.parseData(current.data || "[]")) ||
        (await this.rtl(project, { containers: [] }, signal));
      const out = await this.applyEdit(
        project,
        a,
        current,
        { palette, values, rtl, mockIds: plan?.mockIds, info },
        signal,
      );
      const published = current.status === "publish";
      const foreign = foreignTypes(out.data);
      const before = countAll(h.parseData(current.data || "[]"));
      return this.pending(agent, project, "elementor-edit", {
        target: {
          pageId: current.id,
          rtl,
          plan: !!plan,
          palette,
          values,
          // For the next step of a plan that edits the same (virtual) page.
          ...(plan ? { virtualAfter: { ...current, data: out.text } } : {}),
        },
        before: current,
        payload: {
          meta: { _elementor_edit_mode: "builder", _elementor_data: out.text },
        },
        pageId: current.id,
        preview: {
          before: {
            id: current.id,
            title: current.title,
            status: current.status,
            elements: before,
          },
          payload: {
            title: current.title,
            changes: out.changes,
            elements: out.elements,
          },
        },
        warning: `${published ? "זהו עמוד מפורסם — האישור ישנה את האתר הגלוי מיד. " : ""}רק מה שמופיע ברשימה ישתנה; כל שאר העמוד נשאר בדיוק כפי שהוא${foreign.length ? ` (כולל ווידג'טים שהאפליקציה אינה בונה: ${foreign.join(", ")})` : ""}. הנתונים הקודמים נשמרים לשחזור. ${h.CSS_WARN}`,
        summary: `שינויים בעמוד Elementor '${current.title || "ללא כותרת"}' (#${current.id}), ${out.changes.length} פעולות:\n${out.changes.map((c) => "• " + c).join("\n")}`,
      });
    },
    // Plan step at execution time: the page (a copy made earlier in the plan) exists now, so the operations are applied to it.
    async finalizeEdit(agent, project, p, args, signal) {
      const a = validateEdit(args);
      const current = await this.readPage(project, a.id, signal);
      this.checkEditable(current, "עריכה");
      const rtl = !!p.target?.rtl;
      const out = await this.applyEdit(
        project,
        a,
        current,
        {
          palette: p.target?.palette || null,
          values: p.target?.values || null,
          rtl,
        },
        signal,
      );
      p.before = current;
      p.beforeDigest = h.digest(current);
      p.pageId = current.id;
      p.target = { ...p.target, pageId: current.id };
      p.payload = {
        meta: { _elementor_edit_mode: "builder", _elementor_data: out.text },
      };
      return p;
    },
    // ---- duplicate -------------------------------------------------------------------------------------------------------------
    async prepareDuplicate(agent, project, args, signal, plan = null) {
      const a = validateDuplicate(args);
      await this.gate(project, signal);
      const src = await this.readPage(project, a.id, signal);
      this.checkEditable(src, "העתקה");
      const data = h.parseData(src.data || "[]");
      await this.assertExposed(project, signal);
      const title = a.title ?? `${src.title || "ללא כותרת"}${COPY_SUFFIX}`;
      const settings =
        src.pageSettings &&
        Object.keys(src.pageSettings).length <= 200 &&
        JSON.stringify(src.pageSettings).length <= 50000
          ? src.pageSettings
          : null;
      const meta = {
        _elementor_edit_mode: "builder",
        ...(src.templateType && /^[a-z0-9_-]{1,40}$/.test(src.templateType)
          ? { _elementor_template_type: src.templateType }
          : {}),
        _elementor_data: src.data,
        ...(settings && Object.keys(settings).length
          ? { _elementor_page_settings: settings }
          : {}),
      };
      const payload = {
        title,
        status: "draft",
        ...(src.pageTemplate &&
        /^[A-Za-z0-9_.\/-]{1,100}$/.test(src.pageTemplate)
          ? { template: src.pageTemplate }
          : {}),
        meta,
      };
      const n = countAll(data);
      const foreign = foreignTypes(data);
      const skipped =
        src.pageSettings && Object.keys(src.pageSettings).length && !settings
          ? " הגדרות העמוד לא הועתקו (גדולות מדי)."
          : "";
      return this.pending(agent, project, "elementor-duplicate", {
        target: {
          sourceId: src.id,
          sourceTitle: src.title,
          sourceDigest: h.digest(h.stateOfPage(src, false)),
          plan: !!plan,
          elements: n,
          // The copy as the next step of a plan will find it.
          virtual: {
            title,
            status: "draft",
            editMode: "builder",
            templateType: src.templateType,
            data: src.data,
            pageSettings: settings,
            pageTemplate: payload.template ?? null,
            modified: "",
          },
        },
        before: null,
        payload,
        preview: {
          before: null,
          payload: { title, from: src.id, elements: n },
        },
        warning: `טיוטה בלבד — לא מפורסם. התוכן, הגדרות העמוד והתבנית מועתקים כמות שהם מהעמוד '${src.title || "ללא כותרת"}' (#${src.id}), בלי שינוי ובלי תוכן חדש${foreign.length ? `; כולל ווידג'טים שהאפליקציה אינה בונה (${foreign.join(", ")})` : ""}.${skipped} ניתן לבטל (העותק יועבר לפח).`,
        summary: `ייווצר עותק של העמוד '${src.title || "ללא כותרת"}' (#${src.id}) כטיוטה חדשה: '${title}' — ${n} אלמנטים.`,
      });
    },
  };
  return {
    EDIT_TOOL,
    DUP_TOOL,
    tools,
    operationsSchema,
    validateEdit,
    validateDuplicate,
    outlineOf,
    foreignTypes,
    countAll,
    methods,
  };
};
