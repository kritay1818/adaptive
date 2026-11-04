"use strict";
// Elementor Pro Theme Builder templates (header and footer) through the core REST API: an `elementor_library` post with
// _elementor_template_type + _elementor_data, built from the same kit, validator and builder as pages.
// Display conditions (where the template shows) are NOT writable through REST and are never attempted: the user publishes the
// template once in Elementor (Publish ← Entire Site). Everything that needs the page machinery of wp-elementor.cjs (request,
// reads, media, globals, review card, execute, undo) is reached through `this`; the helpers arrive lazily in `h` because this
// file is loaded by wp-elementor.cjs before its own helpers exist.
const { buildTemplate, DEFAULT_PALETTE } = require("./elementor-kit/index.cjs");

const TEMPLATE_TOOL = "wp_prepare_elementor_template";
const TYPES = ["header", "footer"];
const CONTACT_TYPES = ["phone", "email", "address", "hours", "whatsapp"];
const MENU_SLUG = /^[A-Za-z0-9_%.-]{1,200}$/;
const NEED_PRO =
  "כותרת ותחתית (Theme Builder) דורשות Elementor Pro, והוא אינו פעיל באתר הזה. הכותרת והתחתית נשארות של ערכת העיצוב; אפשר להוסיף אזור תחתון כחלק מעמוד (התבנית footer-section) או לערוך אותן ידנית.";
const MANUAL_STEP =
  "כדי להציג אותה בכל האתר: פתחו ב-Elementor ← Publish ← Entire Site";

const schema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = { type: "string" };
const int = (min, max) => ({ type: "integer", minimum: min, maximum: max });
const enumOf = (...values) => ({ type: "string", enum: values });
// Properties shared by the tool and the build-plan step (idSchema: integer, or integer-or-reference inside a plan).
function templateProps(idSchema) {
  const link = schema({ text: str, url: str }, ["text", "url"]);
  return {
    id: { type: "integer" },
    type: enumOf(...TYPES),
    title: str,
    logo: schema(
      {
        source: enumOf("site", "media"),
        mediaId: idSchema,
        alt: str,
        width: int(40, 400),
      },
      ["source"],
    ),
    navigation: enumOf("menu", "links", "none"),
    menuLinks: { type: "array", maxItems: 8, items: link },
    buttons: { type: "array", maxItems: 2, items: link },
    text: str,
    contacts: {
      type: "array",
      maxItems: 6,
      items: schema(
        { type: enumOf(...CONTACT_TYPES), label: str, value: str },
        ["type", "value"],
      ),
    },
    footerLinks: { type: "array", maxItems: 12, items: link },
    linksTitle: str,
    contactsTitle: str,
    copyright: str,
    tone: enumOf("light", "dark"),
  };
}
const templateTools = [
  {
    name: TEMPLATE_TOOL,
    description:
      'Needs Elementor Pro. Prepare an Elementor Theme Builder header or footer template: without id a new DRAFT, with id replaces that template. Header: logo (site logo or mediaId), navigation "menu" (the site\'s existing menu, Pro nav-menu widget) or "links" with menuLinks, up to 2 buttons. Footer: text, contacts, footerLinks, copyright. Colors, RTL and mobile are automatic. Display conditions cannot be written remotely: after approval tell the user to open the template in Elementor and use Publish ← Entire Site. Nothing is written before the user approves the review card.',
    parameters: schema(templateProps({ type: "integer" }), ["type"]),
  },
];

const HEADER_KEYS = ["logo", "navigation", "menuLinks", "buttons"];
const FOOTER_KEYS = [
  "text",
  "contacts",
  "footerLinks",
  "linksTitle",
  "contactsTitle",
  "copyright",
];
const SHARED_KEYS = ["id", "type", "title", "logo", "tone"];

module.exports = function templates(h) {
  // Pure checks (before anything is read from the site). Returns a normalized copy.
  function validateTemplate(args) {
    if (!h.object(args)) h.fail("ארגומנטים לא תקינים");
    h.onlyKeys(
      args,
      [...SHARED_KEYS, ...HEADER_KEYS, ...FOOTER_KEYS],
      TEMPLATE_TOOL,
    );
    if (!TYPES.includes(args.type)) h.fail('type: "header" או "footer" (חובה)');
    const own = args.type === "header" ? HEADER_KEYS : FOOTER_KEYS;
    const other = args.type === "header" ? FOOTER_KEYS : HEADER_KEYS;
    for (const k of other)
      if (args[k] !== undefined)
        h.fail(
          `${k}: שייך ל${args.type === "header" ? "תחתית (footer)" : "כותרת (header)"}, לא ל־${args.type}`,
        );
    if (args.id !== undefined && !h.numericId(args.id))
      h.fail("id: מזהה תבנית לא תקין");
    if (args.title !== undefined) h.plain(args.title, 300, "title");
    if (args.tone !== undefined && !["light", "dark"].includes(args.tone))
      h.fail("tone: light או dark");
    if (args.logo !== undefined) {
      const l = args.logo;
      if (!h.object(l)) h.fail("logo: אובייקט עם source");
      h.onlyKeys(l, ["source", "mediaId", "alt", "width"], "logo");
      if (!["site", "media"].includes(l.source))
        h.fail('logo.source: "site" (לוגו האתר) או "media" (תמונה מהמדיה)');
      if (l.source === "media" && !h.numericId(l.mediaId))
        h.fail("logo.mediaId: תמונת הלוגו רק מספריית המדיה של האתר");
      if (l.source === "site" && l.mediaId !== undefined)
        h.fail('logo.mediaId: רלוונטי רק ל־source "media"');
      if (l.alt !== undefined) h.plain(l.alt, 300, "logo.alt");
      if (l.width !== undefined) h.range(l.width, 40, 400, "logo.width");
    }
    const linkList = (value, key, max, min = 0) => {
      if (value === undefined) return;
      if (!Array.isArray(value) || value.length < min || value.length > max)
        h.fail(`${key}: רשימה של ${min} עד ${max} קישורים`);
      value.forEach((item, i) => {
        if (!h.object(item)) h.fail(`${key}[${i}]: אובייקט עם text ו־url`);
        h.onlyKeys(item, ["text", "url"], `${key}[${i}]`);
        h.plain(item.text, 60, `${key}[${i}].text`);
        if (typeof item.url !== "string")
          h.fail(`${key}[${i}].url: נדרשת כתובת`);
        h.link(item.url, `${key}[${i}].url`);
      });
    };
    if (args.type === "header") {
      const nav = args.navigation ?? "menu";
      if (!["menu", "links", "none"].includes(nav))
        h.fail("navigation: menu, links או none");
      if (nav === "links") {
        if (args.menuLinks === undefined)
          h.fail('menuLinks: navigation "links" דורש 1 עד 8 קישורים');
        linkList(args.menuLinks, "menuLinks", 8, 1);
      } else if (args.menuLinks !== undefined)
        h.fail('menuLinks: רלוונטי רק ל־navigation "links"');
      linkList(args.buttons, "buttons", 2);
    } else {
      if (args.text !== undefined) h.plain(args.text, 600, "text");
      if (args.copyright !== undefined)
        h.plain(args.copyright, 200, "copyright");
      for (const k of ["linksTitle", "contactsTitle"])
        if (args[k] !== undefined) h.plain(args[k], 40, k);
      linkList(args.footerLinks, "footerLinks", 12);
      if (args.contacts !== undefined) {
        if (!Array.isArray(args.contacts) || args.contacts.length > 6)
          h.fail("contacts: עד 6 פרטי קשר");
        args.contacts.forEach((c, i) => {
          if (!h.object(c)) h.fail(`contacts[${i}]: אובייקט`);
          h.onlyKeys(c, ["type", "label", "value"], `contacts[${i}]`);
          if (!CONTACT_TYPES.includes(c.type))
            h.fail(`contacts[${i}].type: אחד מ־${CONTACT_TYPES.join(", ")}`);
          h.plain(c.value, 200, `contacts[${i}].value`);
          if (c.label !== undefined)
            h.plain(c.label, 60, `contacts[${i}].label`);
        });
      }
    }
    if (
      args.id === undefined &&
      !own.some((k) => args[k] !== undefined) &&
      !args.logo
    )
      h.fail(
        args.type === "header"
          ? "כותרת ריקה: ציינו logo, navigation או buttons"
          : "תחתית ריקה: ציינו text, contacts, footerLinks או copyright",
      );
    return structuredClone(args);
  }

  const defaultTitle = (type) =>
    type === "header" ? "כותרת האתר (Header)" : "תחתית האתר (Footer)";

  // The simple container structure (kit) + the menu slug the app resolved; checked like any page structure.
  function structureOf(a, { palette, values, menuSlug }) {
    const containers = buildTemplate(
      a.type,
      {
        ...a,
        navigation: a.type === "header" ? (a.navigation ?? "menu") : undefined,
        menuSlug,
      },
      { palette, values },
    );
    const count = { n: 0, pro: true };
    containers.forEach((c, i) =>
      h.checkContainer(c, `containers[${i}]`, count, false),
    );
    if (count.n > 60) h.fail("התבנית גדולה מדי");
    return { containers };
  }

  const methods = {
    // Pro must be active; the library route must exist and expose Elementor's meta (the same proof as for pages).
    async templateGate(project, signal) {
      const info = await this.gate(project, signal);
      if (!info.pro?.active) h.fail(NEED_PRO);
      return info;
    },
    async assertTemplatesExposed(project, signal) {
      let sample;
      try {
        sample = await this.request(project, {
          route: "templates",
          query: {
            context: "edit",
            per_page: 1,
            status: "any",
            _fields: "id,meta",
          },
          signal,
        });
      } catch (e) {
        if (signal?.aborted || !e.infra) throw e;
        h.fail(
          "תבניות Elementor אינן חשופות ל־REST באתר הזה, או שאין לחשבון המחובר הרשאה אליהן (נדרשת הרשאת מנהל). אפשר ליצור כותרת ותחתית ידנית ב־Templates ← Theme Builder.",
          e.detail,
        );
      }
      const first = Array.isArray(sample) ? sample[0] : undefined;
      if (first) {
        if (
          !h.object(first.meta) ||
          !Object.hasOwn(first.meta, "_elementor_data")
        )
          h.fail(
            "האתר אינו חושף את נתוני Elementor של התבניות דרך ה־REST API, ולכן אי אפשר ליצור תבניות מרחוק. אפשר ליצור אותן ידנית ב־Templates ← Theme Builder.",
          );
        return;
      }
      // An empty library cannot prove it; the pages route exposes the same meta keys.
      await this.assertExposed(project, signal);
    },
    // base: REST base of the elementor_library_type taxonomy; the template's term ids are then read back as `libTerms`.
    async readDoc(project, route, id, signal, missing = false, base) {
      const raw = await this.request(project, {
        route,
        target: id,
        query: {
          context: "edit",
          _fields: "id,title,status,meta,modified" + (base ? "," + base : ""),
        },
        signal,
        missing,
      });
      if (!raw) return null;
      const doc = this.shape(raw, id);
      if (base)
        doc.libTerms = Array.isArray(raw[base])
          ? raw[base].filter(Number.isSafeInteger)
          : null;
      return doc;
    },
    // Elementor tags every library template with a term of the elementor_library_type taxonomy ("header", "footer"), next to
    // _elementor_template_type. When that taxonomy is exposed to REST its base is returned, otherwise null (today's behavior).
    async discoverLibType(project, signal) {
      try {
        const all = await this.request(project, {
          route: "taxonomies",
          query: { context: "edit" },
          signal,
        });
        const t = all?.elementor_library_type;
        if (!h.object(t) || t.show_in_rest === false) return null;
        const base = t.rest_base ?? "elementor_library_type";
        return typeof base === "string" && /^[a-z0-9_-]{1,64}$/.test(base)
          ? { base }
          : null;
      } catch {
        signal?.throwIfAborted();
        return null;
      }
    },
    async findLibTerm(project, base, slug, signal) {
      const list = await this.request(project, {
        route: "libterms",
        base,
        query: { context: "edit", slug, per_page: 5 },
        signal,
      });
      const hit = (Array.isArray(list) ? list : []).find(
        (x) => h.object(x) && x.slug === slug && h.numericId(x.id),
      );
      return hit ? hit.id : null;
    },
    // At execution: the term exists, or it is created first (the only write before the template itself).
    async ensureLibTerm(project, lib, signal) {
      const found = await this.findLibTerm(project, lib.base, lib.slug, signal);
      if (found) return found;
      let made;
      try {
        made = await this.request(project, {
          route: "libterms",
          base: lib.base,
          method: "POST",
          payload: { name: lib.slug, slug: lib.slug },
          signal,
        });
      } catch (e) {
        // The template itself was not touched.
        throw Object.assign(e, { notApplied: true, ambiguousWrite: false });
      }
      if (!h.numericId(made?.id))
        throw Object.assign(
          new Error("האתר לא החזיר מזהה לסוג התבנית (taxonomy)"),
          { infra: true, elementor: true, notApplied: true },
        );
      return made.id;
    },
    // The site's main menu: the one named like a main/primary menu, else the first. null when the site has no menu.
    async resolveMenu(project, signal) {
      let list;
      try {
        list = await this.request(project, {
          route: "menus",
          query: { context: "edit", per_page: 100, _fields: "id,name,slug" },
          signal,
        });
      } catch (e) {
        signal?.throwIfAborted();
        return null;
      }
      const items = (Array.isArray(list) ? list : [])
        .filter(
          (m) =>
            h.object(m) &&
            h.numericId(m.id) &&
            typeof m.slug === "string" &&
            MENU_SLUG.test(m.slug),
        )
        .map((m) => ({
          id: m.id,
          slug: m.slug,
          name: String(m.name ?? m.slug)
            .replace(/[<>\x00-\x1f]/g, "")
            .slice(0, 60),
        }));
      if (!items.length) return null;
      return (
        items.find((m) =>
          /main|primary|header|nav|ראשי|ניווט/i.test(`${m.slug} ${m.name}`),
        ) || items[0]
      );
    },
    async templateGlobalValues(project, info, signal) {
      if (!info.globals) return null;
      try {
        const g = await this.readGlobals(project, signal);
        const values = {};
        for (const id of ["primary", "secondary", "text", "accent"])
          if (g.colors.has(id)) values[id] = g.colors.get(id).value;
        return values;
      } catch {
        signal?.throwIfAborted();
        return null;
      }
    },
    // plan = { mockIds } while a build plan is only being prepared: the menu and the images may not exist yet.
    async prepareTemplate(agent, project, args, signal, plan = null) {
      const a = validateTemplate(args);
      const info = await this.templateGate(project, signal);
      const palette = info.globals ? null : DEFAULT_PALETTE;
      const values = await this.templateGlobalValues(project, info, signal);
      let menu = null;
      if (a.type === "header" && (a.navigation ?? "menu") === "menu") {
        menu = await this.resolveMenu(project, signal);
        if (!menu && plan)
          menu = { slug: "plan-menu", name: "(התפריט שייווצר בתוכנית)" };
        if (!menu)
          h.fail(
            'לא נמצא תפריט באתר, ולכן אין מה להציג בניווט. צרו קודם תפריט (wp_prepare_menu), או בקשו navigation "links" עם menuLinks.',
          );
      }
      const structure = structureOf(a, {
        palette,
        values,
        menuSlug: menu?.slug,
      });
      this.assertGlobals(structure, info);
      const rtl = await this.rtl(project, a, signal);
      const media = await this.resolveMedia(
        project,
        structure,
        signal,
        plan?.mockIds,
      );
      const origin = new URL(this.wp.status(project).site).origin;
      const ctx = { rtl, media, pro: true };
      const data = h.buildElementorData(structure, ctx);
      h.checkBuilt(data, ctx, origin);
      const text = JSON.stringify(data);
      const kinds = h.countKinds(data);
      const lines = h.outline(structure);
      const ph = h.placeholders(a);
      const phLine = ph.length
        ? `\n⚠ מקומות להשלמה ידנית (${ph.length}): ${ph.join(" ")}`
        : "";
      const extra = [
        a.type === "header" && menu ? `ניווט: התפריט '${menu.name}'` : "",
        a.logo
          ? `לוגו: ${a.logo.source === "site" ? "לוגו האתר" : "תמונה #" + a.logo.mediaId}`
          : "",
      ]
        .filter(Boolean)
        .join("; ");
      const view = {
        title: a.title ?? defaultTitle(a.type),
        type: a.type,
        structure,
        elements: kinds.total,
      };
      const manual = `הצגת התבנית בכל האתר היא צעד ידני אחד: ${MANUAL_STEP} (תנאי תצוגה אי אפשר לכתוב מרחוק).`;
      const target = {
        rtl,
        plan: !!plan,
        palette,
        values,
        templateType: a.type,
        menu: menu?.slug ?? null,
        placeholders: ph,
      };
      if (a.id === undefined) {
        await this.assertTemplatesExposed(project, signal);
        const lib = await this.discoverLibType(project, signal);
        if (lib) {
          target.libType = {
            base: lib.base,
            slug: a.type,
            termId: await this.findLibTerm(project, lib.base, a.type, signal),
          };
        }
        const libLine = lib
          ? `\nסוג התבנית ב־Elementor (elementor_library_type '${a.type}') יוגדר כמו שהעורך עושה${target.libType.termId ? "" : "; המונח ייווצר כי חסר באתר"}.`
          : "";
        return this.pending(agent, project, "elementor-template-create", {
          resource: "templates",
          target,
          before: null,
          payload: {
            title: view.title,
            status: "draft",
            meta: {
              _elementor_edit_mode: "builder",
              _elementor_template_type: a.type,
              _elementor_data: text,
            },
          },
          preview: { before: null, payload: view },
          warning: `תבנית ${a.type} חדשה תיווצר כטיוטה בספריית התבניות של Elementor ולא תוצג באתר עד שתפרסמו אותה. ${manual} ניתן לבטל (הטיוטה תועבר לפח).`,
          summary: `תיווצר תבנית ${a.type} של Elementor (טיוטה): '${view.title}' — ${kinds.total} אלמנטים.${extra ? "\n" + extra : ""}\n${lines.join("\n")}${phLine}${libLine}`,
        });
      }
      const current = await this.readDoc(project, "templates", a.id, signal);
      if (current.templateType !== a.type)
        h.fail(
          `התבנית ${a.id} היא מסוג '${current.templateType || "לא ידוע"}' ולא ${a.type}.`,
        );
      if (!["draft", "publish", "pending", "private"].includes(current.status))
        h.fail("עדכון נתמך רק בתבנית שהיא טיוטה, ממתינה, פרטית או מפורסמת");
      if (current.editMode !== "builder")
        h.fail("התבנית אינה תבנית Elementor (נבנתה בעורך אחר).");
      if (Buffer.byteLength(current.data) > h.MAX_BEFORE)
        h.fail(
          "התבנית הנוכחית גדולה מדי כדי לשמור אותה לשחזור, ולכן האפליקציה לא תחליף אותה.",
        );
      const existing = h.inspectExisting(
        h.parseData(current.data || "[]"),
        true,
      );
      if (existing.unsupported.length)
        h.fail(
          `התבנית כוללת אלמנטים שהאפליקציה אינה יכולה לשמר (${existing.unsupported.join(", ")}). עדכון היה מוחק אותם. ערכו אותה ב־Elementor, או צרו תבנית חדשה.`,
        );
      const payload = {
        meta: { _elementor_edit_mode: "builder", _elementor_data: text },
      };
      if (a.title !== undefined && !h.sameText(a.title, current.title))
        payload.title = a.title;
      if (
        h.sameText(
          h.canonText(h.parseData(current.data || "[]")),
          h.canonText(data),
        ) &&
        payload.title === undefined
      )
        h.fail("אין שינוי: התוכן המבוקש זהה לתוכן הקיים");
      const published = current.status === "publish";
      return this.pending(agent, project, "elementor-template-update", {
        resource: "templates",
        target: { ...target, pageId: current.id },
        before: current,
        payload,
        pageId: current.id,
        preview: {
          before: {
            id: current.id,
            title: current.title,
            status: current.status,
            elements: existing.count,
          },
          payload: { ...view, title: payload.title ?? current.title },
        },
        warning: `${published ? "זו תבנית מפורסמת — האישור ישנה את הכותרת/התחתית הגלויה בכל האתר מיד. " : ""}העדכון מחליף את כל תוכן התבנית (${existing.count} אלמנטים קיימים); עיצוב מתקדם שנוסף ידנית בעורך יאבד. הנתונים הקודמים נשמרים לשחזור. תנאי התצוגה הקיימים לא משתנים. ${h.CSS_WARN}`,
        summary: `יוחלף תוכן תבנית ${a.type} '${current.title || "ללא כותרת"}' (#${current.id}) — ${kinds.total} אלמנטים.${extra ? "\n" + extra : ""}\n${lines.join("\n")}${phLine}`,
      });
    },
    // Build-plan step at execution time: the menu exists now and the media ids are real, so the JSON is rebuilt from them.
    async finalizeTemplate(agent, project, p, args, signal) {
      const a = validateTemplate(args);
      let menuSlug;
      if (a.type === "header" && (a.navigation ?? "menu") === "menu") {
        const menu = await this.resolveMenu(project, signal);
        if (!menu)
          h.fail(
            'לא נמצא תפריט באתר בשלב הכותרת. שלב התפריט צריך לבוא לפני הכותרת בתוכנית (או בקשו navigation "links").',
          );
        menuSlug = menu.slug;
      }
      const structure = structureOf(a, {
        palette: p.target?.palette || null,
        values: p.target?.values || null,
        menuSlug,
      });
      const media = await this.resolveMedia(project, structure, signal);
      const origin = new URL(this.wp.status(project).site).origin;
      const ctx = { rtl: !!p.target?.rtl, media, pro: true };
      const data = h.buildElementorData(structure, ctx);
      h.checkBuilt(data, ctx, origin);
      p.payload = structuredClone(p.payload);
      p.payload.meta = {
        ...p.payload.meta,
        _elementor_data: JSON.stringify(data),
      };
      p.target = { ...p.target, menu: menuSlug ?? null };
      return p;
    },
  };
  return {
    TEMPLATE_TOOL,
    NEED_PRO,
    MANUAL_STEP,
    templateTools,
    templateProps,
    validateTemplate,
    methods,
  };
};
