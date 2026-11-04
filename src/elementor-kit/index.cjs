"use strict";
// Elementor design kit: ten tested section patterns. Each pattern takes simple data (text, media ids, links) and returns the SAME
// simple container structure that wp_prepare_elementor_page accepts, so every pattern goes through the normal Elementor validator
// and builder (allowlists, RTL, mobile settings, read-back). Colors and fonts are global references (global:primary ...) so the
// page follows the site design; when a site cannot offer globals the caller passes a hex palette instead.
// Depth rule of the validator: container > container > widget, so a section is either one column container with widgets,
// or one (wrapping) row container whose children are column/card containers with widgets.
const fail = (message) => {
  throw Object.assign(new Error(message), { infra: true, elementor: true });
};
const esc = (v) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Plain text -> simple paragraphs (blank line = new paragraph, newline = line break).
const toHtml = (text) =>
  String(text)
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
const DEFAULT_PALETTE = Object.freeze({
  primary: "#1F3A5F",
  secondary: "#2B3A4A",
  text: "#3A4452",
  accent: "#D9731A",
});
// Contrast: a hero picks white or dark text by the brightness of its background. A color is known when it is a hex value
// (hex palette) or a global whose real value the caller read from the site (values); an unknown global is never trusted.
const HEX = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i;
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const colors = (palette, values = null) => {
  const c = (name) =>
    palette ? palette[name] || DEFAULT_PALETTE[name] : `global:${name}`;
  const known = (ref) => {
    if (typeof ref !== "string") return null;
    if (HEX.test(ref)) return ref;
    const m = /^global:(primary|secondary|text|accent)$/.exec(ref);
    return m && typeof values?.[m[1]] === "string" && HEX.test(values[m[1]])
      ? values[m[1]]
      : null;
  };
  return {
    known,
    primary: c("primary"),
    secondary: c("secondary"),
    text: c("text"),
    accent: c("accent"),
    white: "#ffffff",
    light: "#f5f7fa",
    dark: "#0b1220",
  };
};
const has = (v) => typeof v === "string" && v.trim() !== "";
const need = (d, key, pattern) => {
  if (!has(d[key])) fail(`התבנית ${pattern}: חסר השדה ${key}`);
};
const list = (d, key, pattern, min, max) => {
  const v = d[key];
  if (!Array.isArray(v) || v.length < min || v.length > max)
    fail(`התבנית ${pattern}: ${key} חייב להכיל ${min} עד ${max} פריטים`);
  return v;
};
const heading = (text, level, o = {}) => ({
  type: "heading",
  text,
  level,
  ...o,
});
const text = (value, o = {}) => ({
  type: "text-editor",
  html: toHtml(value),
  ...o,
});
const button = (label, url, o = {}) => ({
  type: "button",
  text: label,
  url,
  ...o,
});
const column = (o, children) => ({ type: "container", ...o, children });
const clean = (list) => list.filter(Boolean);

// Eyebrow + title + subtitle, used at the top of most sections.
// Text color on a background: the preferred color if it reads well there, else white or dark by the background's brightness.
// An unknown background keeps the preferred color.
function readable(k, bg, preferred, min = 4.5) {
  const b = k.known(bg);
  if (!b) return preferred;
  const p = k.known(preferred);
  if (p && ratio(p, b) >= min) return preferred;
  return ratio("#ffffff", b) >= ratio(k.dark, b) ? k.white : k.dark;
}
function intro(
  d,
  k,
  { align = "start", dark = false, level = 2, on = null } = {},
) {
  // on: the hero's background; every text color is then chosen for contrast against it.
  const pick = (preferred) => (on ? readable(k, on, preferred) : preferred);
  return clean([
    has(d.eyebrow) &&
      heading(d.eyebrow, 6, {
        color: pick(dark ? k.white : k.accent),
        size: 14,
        weight: 700,
        align,
      }),
    has(d.title) &&
      heading(d.title, level, {
        color: pick(dark ? k.white : k.primary),
        size: level === 1 ? 46 : 34,
        weight: 700,
        align,
      }),
    has(d.subtitle) &&
      text(d.subtitle, {
        color: pick(dark ? k.white : k.text),
        size: 18,
        align,
      }),
  ]);
}
function buttons(
  d,
  k,
  { dark = false, align, flat = false, smart = false } = {},
) {
  // smart (heroes): button labels are checked against the button background too (large bold text: 3:1).
  const label = (bg, preferred) =>
    smart ? readable(k, bg, preferred, 3) : preferred;
  const row = clean([
    has(d.buttonText) &&
      has(d.buttonUrl) &&
      button(d.buttonText, d.buttonUrl, {
        background: k.accent,
        color: label(k.accent, k.white),
        size: 17,
        weight: 700,
      }),
    has(d.secondaryText) &&
      has(d.secondaryUrl) &&
      button(d.secondaryText, d.secondaryUrl, {
        background: dark ? k.white : k.primary,
        color: label(dark ? k.white : k.primary, dark ? k.primary : k.white),
        size: 17,
        weight: 700,
      }),
  ]);
  if (
    has(d.buttonText) !== has(d.buttonUrl) ||
    has(d.secondaryText) !== has(d.secondaryUrl)
  )
    fail("כפתור דורש גם טקסט (buttonText) וגם כתובת (buttonUrl)");
  // Inside a column the buttons are plain widgets (the validator allows only one level of inner containers).
  if (flat) return row;
  return row.length
    ? [
        column(
          {
            direction: "row",
            wrap: true,
            gap: 12,
            justify: align === "center" ? "center" : "start",
          },
          row,
        ),
      ]
    : [];
}
const CONTACT_ICON = {
  phone: "phone",
  email: "envelope",
  address: "location",
  hours: "clock",
  whatsapp: "whatsapp",
};
function contactLink(c) {
  const value = String(c.value).trim();
  // A value that is still a placeholder "(להשלים: ...)" stays plain text: there is no real number or address to link yet.
  if (/^\(להשלים:/.test(value)) return undefined;
  if (c.type === "phone") return `tel:${value.replace(/[^\d+]/g, "")}`;
  if (c.type === "email") return `mailto:${value}`;
  if (c.type === "whatsapp") return `https://wa.me/${value.replace(/\D/g, "")}`;
  return undefined;
}
function contactWidgets(contacts, k) {
  return contacts.map((c) => {
    if (!c || !CONTACT_ICON[c.type] || !has(c.value))
      fail(
        "איש קשר חייב לכלול type (phone, email, address, hours, whatsapp) ו־value",
      );
    const label = has(c.label) ? `${c.label}: ${c.value}` : String(c.value);
    const url = contactLink(c);
    return {
      type: "icon-list",
      icon: CONTACT_ICON[c.type],
      color: k.text,
      size: 16,
      items: [url ? { text: label, url } : { text: label }],
    };
  });
}

const PATTERNS = {
  // 1. Header-like hero with a background image and a dark overlay.
  "hero-image": {
    label: "פתיח עם תמונת רקע",
    build(d, k) {
      need(d, "title", "hero-image");
      if (!Number.isInteger(d.mediaId))
        fail(
          "התבנית hero-image: חסר mediaId של תמונת רקע מספריית המדיה (העלו אותה קודם)",
        );
      return [
        {
          width: "full",
          direction: "column",
          justify: "center",
          gap: 20,
          paddingX: 24,
          paddingY: 120,
          minHeight: 520,
          background: k.dark,
          backgroundImage: d.mediaId,
          overlay: k.dark,
          // 65% of a near-black overlay keeps white text readable even on a white photo (about 6:1).
          overlayOpacity: 65,
          children: [
            ...intro(d, k, { dark: true, level: 1 }),
            ...(has(d.text)
              ? [text(d.text, { color: k.white, size: 18 })]
              : []),
            ...buttons(d, k, { dark: true, smart: true }),
          ],
        },
      ];
    },
  },
  // 2. Simple hero (no image), centered.
  "hero-simple": {
    label: "פתיח פשוט",
    build(d, k) {
      need(d, "title", "hero-simple");
      const dark = d.tone === "dark";
      // The background must be a color whose brightness is known; an unknown global falls back to the kit's own dark color.
      let bg = dark ? k.primary : k.light;
      if (!k.known(bg)) bg = k.dark;
      const onBg = bg === k.light ? false : dark || bg === k.dark;
      return [
        {
          width: "full",
          direction: "column",
          align: "center",
          gap: 18,
          paddingX: 24,
          paddingY: 96,
          background: bg,
          children: [
            ...intro(d, k, {
              align: "center",
              dark: onBg,
              level: 1,
              on: bg,
            }),
            ...(has(d.text)
              ? [
                  text(d.text, {
                    color: readable(k, bg, onBg ? k.white : k.text),
                    size: 18,
                    align: "center",
                  }),
                ]
              : []),
            ...buttons(d, k, {
              dark: onBg,
              align: "center",
              smart: true,
            }),
          ],
        },
      ];
    },
  },
  // 3. Text next to an image; reverse swaps the sides.
  "text-image": {
    label: "טקסט ותמונה",
    build(d, k) {
      need(d, "title", "text-image");
      if (!Number.isInteger(d.mediaId))
        fail("התבנית text-image: חסר mediaId של התמונה");
      const copy = column({ widthPercent: 48, direction: "column", gap: 16 }, [
        ...intro(d, k),
        ...(has(d.text) ? [text(d.text, { color: k.text, size: 17 })] : []),
        ...buttons(d, k, { flat: true }),
      ]);
      const picture = column(
        { widthPercent: 48, direction: "column", align: "center" },
        [{ type: "image", mediaId: d.mediaId, width: 100 }],
      );
      return [
        {
          direction: "row",
          wrap: true,
          gap: 40,
          align: "center",
          justify: "between",
          paddingX: 24,
          paddingY: 72,
          children: d.reverse ? [picture, copy] : [copy, picture],
        },
      ];
    },
  },
  // 4. Services as 3-5 cards.
  "services-cards": {
    label: "כרטיסי שירותים",
    build(d, k) {
      const items = list(d, "items", "services-cards", 3, 5);
      const width = { 3: 31, 4: 23, 5: 18 }[items.length];
      const cards = items.map((item, i) => {
        if (!item || !has(item.title))
          fail(`services-cards: לפריט ${i + 1} חסרה כותרת (title)`);
        return column(
          {
            widthPercent: width,
            direction: "column",
            gap: 12,
            paddingX: 24,
            paddingY: 28,
            background: k.white,
            radius: 12,
          },
          clean([
            Number.isInteger(item.mediaId) && {
              type: "image",
              mediaId: item.mediaId,
              width: 100,
            },
            heading(item.title, 3, { color: k.primary, size: 22, weight: 700 }),
            has(item.text) && text(item.text, { color: k.text, size: 16 }),
            has(item.url) &&
              has(item.buttonText) &&
              button(item.buttonText, item.url, {
                background: k.primary,
                color: k.white,
                size: 15,
              }),
          ]),
        );
      });
      const head = intro(d, k, { align: "center" });
      return [
        {
          width: "full",
          direction: "row",
          wrap: true,
          gap: 24,
          justify: "center",
          paddingX: 24,
          paddingY: 72,
          background: k.light,
          children: [
            ...(head.length
              ? [
                  column(
                    { widthPercent: 100, direction: "column", gap: 12 },
                    head,
                  ),
                ]
              : []),
            ...cards,
          ],
        },
      ];
    },
  },
  // 5. Features: title and text beside a checklist.
  "features-list": {
    label: "רשימת יתרונות",
    build(d, k) {
      need(d, "title", "features-list");
      const items = list(d, "items", "features-list", 2, 10);
      const rows = items.map((item, i) => {
        if (!item || !(has(item.title) || has(item.text)))
          fail(`features-list: לפריט ${i + 1} חסר טקסט (title או text)`);
        return {
          type: "icon-list",
          icon: "check",
          color: k.text,
          size: 18,
          items: [
            {
              text:
                has(item.title) && has(item.text)
                  ? `${item.title} — ${item.text}`
                  : item.title || item.text,
            },
          ],
        };
      });
      return [
        {
          direction: "row",
          wrap: true,
          gap: 40,
          justify: "between",
          paddingX: 24,
          paddingY: 72,
          children: [
            column({ widthPercent: 40, direction: "column", gap: 14 }, [
              ...intro(d, k),
              ...(has(d.text)
                ? [text(d.text, { color: k.text, size: 17 })]
                : []),
            ]),
            column({ widthPercent: 55, direction: "column", gap: 10 }, rows),
          ],
        },
      ];
    },
  },
  // 6. Testimonials, 1-4 cards.
  testimonials: {
    label: "המלצות",
    build(d, k) {
      const items = list(d, "items", "testimonials", 1, 4);
      const width = { 1: 60, 2: 48, 3: 31, 4: 23 }[items.length];
      const cards = items.map((item, i) => {
        if (!item || !has(item.text))
          fail(`testimonials: להמלצה ${i + 1} חסר טקסט (text)`);
        return column(
          {
            widthPercent: width,
            direction: "column",
            gap: 10,
            paddingX: 24,
            paddingY: 28,
            background: k.white,
            radius: 12,
          },
          clean([
            {
              type: "text-editor",
              html: `<p><em>${esc(item.text.trim())}</em></p>`,
              color: k.text,
              size: 17,
            },
            has(item.name) &&
              heading(item.name, 4, {
                color: k.primary,
                size: 18,
                weight: 700,
              }),
            has(item.role) && text(item.role, { color: k.text, size: 14 }),
          ]),
        );
      });
      const head = intro(d, k, { align: "center" });
      return [
        {
          width: "full",
          direction: "row",
          wrap: true,
          gap: 24,
          justify: "center",
          paddingX: 24,
          paddingY: 72,
          background: k.light,
          children: [
            ...(head.length
              ? [
                  column(
                    { widthPercent: 100, direction: "column", gap: 12 },
                    head,
                  ),
                ]
              : []),
            ...cards,
          ],
        },
      ];
    },
  },
  // 7. Call-to-action band.
  "cta-band": {
    label: "פס קריאה לפעולה",
    build(d, k) {
      need(d, "title", "cta-band");
      need(d, "buttonText", "cta-band");
      need(d, "buttonUrl", "cta-band");
      return [
        {
          width: "full",
          direction: "column",
          align: "center",
          gap: 16,
          paddingX: 24,
          paddingY: 64,
          background: k.primary,
          children: [
            ...intro({ ...d, eyebrow: undefined }, k, {
              align: "center",
              dark: true,
            }),
            ...buttons(
              { buttonText: d.buttonText, buttonUrl: d.buttonUrl },
              k,
              { dark: true, align: "center" },
            ),
          ],
        },
      ];
    },
  },
  // 8. Contact details beside an image or a short text.
  "contact-details": {
    label: "פרטי יצירת קשר",
    build(d, k) {
      need(d, "title", "contact-details");
      const contacts = contactWidgets(
        list(d, "contacts", "contact-details", 1, 8),
        k,
      );
      const side = Number.isInteger(d.mediaId)
        ? [{ type: "image", mediaId: d.mediaId, width: 100 }]
        : has(d.text)
          ? [text(d.text, { color: k.text, size: 17 })]
          : [];
      return [
        {
          direction: "row",
          wrap: true,
          gap: 40,
          justify: "between",
          paddingX: 24,
          paddingY: 72,
          children: clean([
            column({ widthPercent: 48, direction: "column", gap: 12 }, [
              ...intro(d, k),
              ...contacts,
              ...buttons(d, k, { flat: true }),
            ]),
            side.length &&
              column(
                { widthPercent: 48, direction: "column", align: "center" },
                side,
              ),
          ]),
        },
      ];
    },
  },
  // 9. FAQ: each question is an h4 with its answer in one text widget.
  faq: {
    label: "שאלות ותשובות",
    build(d, k) {
      const items = list(d, "faq", "faq", 1, 12);
      const rows = items.flatMap((qa, i) => {
        if (!qa || !has(qa.question) || !has(qa.answer))
          fail(`faq: לשאלה ${i + 1} חסרה שאלה (question) או תשובה (answer)`);
        return [
          {
            type: "text-editor",
            html: `<h4>${esc(qa.question.trim())}</h4>${toHtml(qa.answer)}`,
            color: k.text,
            size: 17,
          },
          { type: "divider", color: "#d9dee5", thickness: 1 },
        ];
      });
      return [
        {
          direction: "column",
          gap: 14,
          paddingX: 24,
          paddingY: 72,
          children: [...intro(d, k, { align: "center" }), ...rows],
        },
      ];
    },
  },
  // 10. Footer-like closing section (about, links, contacts, copyright). A page section, not the theme footer.
  "footer-section": {
    label: "אזור תחתון (פוטר)",
    build(d, k) {
      const links = Array.isArray(d.links) ? d.links : [];
      if (links.length > 12) fail("footer-section: עד 12 קישורים");
      const contacts = Array.isArray(d.contacts) ? d.contacts : [];
      if (contacts.length > 8) fail("footer-section: עד 8 אנשי קשר");
      const cols = clean([
        (has(d.title) || has(d.text)) &&
          column(
            { widthPercent: 31, direction: "column", gap: 10 },
            clean([
              has(d.title) &&
                heading(d.title, 4, { color: k.white, size: 20, weight: 700 }),
              has(d.text) && text(d.text, { color: k.white, size: 15 }),
            ]),
          ),
        links.length &&
          column({ widthPercent: 31, direction: "column", gap: 10 }, [
            heading("ניווט", 4, { color: k.white, size: 20, weight: 700 }),
            {
              type: "icon-list",
              icon: "circle",
              color: k.white,
              size: 15,
              items: links.map((l, i) => {
                if (!l || !has(l.text) || !has(l.url))
                  fail(`footer-section: לקישור ${i + 1} חסר text או url`);
                return { text: l.text, url: l.url };
              }),
            },
          ]),
        contacts.length &&
          column({ widthPercent: 31, direction: "column", gap: 10 }, [
            heading("יצירת קשר", 4, { color: k.white, size: 20, weight: 700 }),
            ...contactWidgets(contacts, { ...k, text: k.white }),
          ]),
        has(d.copyright) &&
          column({ widthPercent: 100, direction: "column", gap: 8 }, [
            { type: "divider", color: "#ffffff", thickness: 1 },
            text(d.copyright, { color: k.white, size: 13, align: "center" }),
          ]),
      ]);
      if (!cols.length)
        fail(
          "footer-section: אין תוכן (נדרש title, text, links, contacts או copyright)",
        );
      return [
        {
          width: "full",
          direction: "row",
          wrap: true,
          gap: 32,
          justify: "between",
          paddingX: 24,
          paddingY: 56,
          background: k.secondary,
          children: cols,
        },
      ];
    },
  },
};
const PATTERN_NAMES = Object.keys(PATTERNS);

// ---- Theme Builder templates (Elementor Pro): header and footer ----------------------------------------------------------------
// Same colors, contrast rules, validator and builder as the page patterns. Not part of PATTERNS (they are not page sections).
// Data (already validated by validateTemplate): logo {source: "site"|"media", mediaId, alt, width}, navigation "menu"|"links"|"none",
// menuSlug (resolved by the app from the site's menu), menuLinks, buttons, text, contacts, footerLinks, copyright, tone.
function surface(k, tone, dark) {
  let bg = (tone || (dark ? "dark" : "light")) === "dark" ? k.primary : k.white;
  if (!k.known(bg)) bg = k.dark; // an unknown global is never trusted: the kit's own dark color keeps the text readable
  const b = k.known(bg);
  const isDark = luminance(b) < 0.4;
  return {
    bg,
    isDark,
    ink: readable(k, bg, isDark ? k.white : k.text),
    strong: readable(k, bg, isDark ? k.white : k.primary),
  };
}
function logoWidget(logo, widthPercent) {
  if (!logo) return null;
  const w = logo.width ?? 140;
  return logo.source === "site"
    ? { type: "site-logo", width: w }
    : {
        type: "image",
        mediaId: logo.mediaId,
        ...(has(logo.alt) ? { alt: logo.alt } : {}),
        width: widthPercent ?? Math.min(40, Math.max(8, Math.round(w / 12))),
      };
}
function buildHeader(d, k) {
  const { bg, isDark, ink } = surface(k, d.tone, false);
  const links = Array.isArray(d.menuLinks) ? d.menuLinks : [];
  const nav =
    d.navigation === "menu"
      ? { type: "nav-menu", menuSlug: d.menuSlug, align: "center", color: ink }
      : d.navigation === "links" && links.length
        ? column(
            { direction: "row", wrap: true, gap: 20, align: "center" },
            links.map((l) =>
              heading(l.text, 6, {
                color: ink,
                size: 16,
                weight: 600,
                url: l.url,
              }),
            ),
          )
        : null;
  const buttons = Array.isArray(d.buttons) ? d.buttons : [];
  const actions = buttons.length
    ? column(
        { direction: "row", wrap: true, gap: 10, align: "center" },
        buttons.map((b, i) => {
          const fill = i === 0 ? k.accent : isDark ? k.white : k.primary;
          return button(b.text, b.url, {
            background: fill,
            color: readable(
              k,
              fill,
              i === 0 || !isDark ? k.white : k.primary,
              3,
            ),
            size: 16,
            weight: 700,
          });
        }),
      )
    : null;
  const children = clean([logoWidget(d.logo), nav, actions]);
  if (!children.length)
    fail("header: אין תוכן (נדרש logo, navigation או buttons)");
  return [
    {
      width: "full",
      direction: "row",
      justify: "between",
      align: "center",
      wrap: true,
      gap: 20,
      paddingX: 24,
      paddingY: 14,
      background: bg,
      children,
    },
  ];
}
function buildFooter(d, k) {
  const { bg, ink, strong } = surface(k, d.tone, true);
  const links = Array.isArray(d.footerLinks) ? d.footerLinks : [];
  const contacts = Array.isArray(d.contacts) ? d.contacts : [];
  const cols = clean([
    (d.logo || has(d.text)) &&
      column(
        { widthPercent: 31, direction: "column", gap: 10 },
        clean([
          logoWidget(d.logo),
          has(d.text) && text(d.text, { color: ink, size: 15 }),
        ]),
      ),
    links.length &&
      column({ widthPercent: 31, direction: "column", gap: 10 }, [
        heading(d.linksTitle || "ניווט", 4, {
          color: strong,
          size: 20,
          weight: 700,
        }),
        {
          type: "icon-list",
          icon: "circle",
          color: ink,
          size: 15,
          items: links.map((l) => ({ text: l.text, url: l.url })),
        },
      ]),
    contacts.length &&
      column({ widthPercent: 31, direction: "column", gap: 10 }, [
        heading(d.contactsTitle || "יצירת קשר", 4, {
          color: strong,
          size: 20,
          weight: 700,
        }),
        ...contactWidgets(contacts, { ...k, text: ink }),
      ]),
    has(d.copyright) &&
      column({ widthPercent: 100, direction: "column", gap: 8 }, [
        { type: "divider", color: ink, thickness: 1 },
        text(d.copyright, { color: ink, size: 13, align: "center" }),
      ]),
  ]);
  if (!cols.length)
    fail(
      "footer: אין תוכן (נדרש logo, text, footerLinks, contacts או copyright)",
    );
  return [
    {
      width: "full",
      direction: "row",
      wrap: true,
      gap: 32,
      justify: "between",
      paddingX: 24,
      paddingY: 56,
      background: bg,
      children: cols,
    },
  ];
}
function buildTemplate(type, data, { palette = null, values = null } = {}) {
  const k = colors(palette, values);
  if (type === "header") return buildHeader(data, k);
  if (type === "footer") return buildFooter(data, k);
  fail('type: "header" או "footer"');
}

// patterns: [{pattern, data}] -> container list. palette: hex map when the site cannot offer global colors.
function expandPatterns(patterns, { palette = null, values = null } = {}) {
  if (!Array.isArray(patterns) || patterns.length > 12)
    fail("patterns: עד 12 תבניות בעמוד");
  const k = colors(palette, values);
  return patterns.flatMap((entry, i) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      fail(`patterns[${i}]: חייב להיות אובייקט עם pattern ו־data`);
    const def = Object.hasOwn(PATTERNS, entry.pattern)
      ? PATTERNS[entry.pattern]
      : null;
    if (!def)
      fail(
        `patterns[${i}]: תבנית לא מוכרת "${String(entry.pattern).slice(0, 40)}". מותרות: ${PATTERN_NAMES.join(", ")}`,
      );
    const data =
      entry.data && typeof entry.data === "object" && !Array.isArray(entry.data)
        ? entry.data
        : {};
    return def.build(data, k);
  });
}

// ---- schema the model sees --------------------------------------------------------------------------------------------------------
const schema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = { type: "string" };
function patternsSchema(idSchema) {
  const item = schema({
    title: str,
    text: str,
    mediaId: idSchema,
    url: str,
    buttonText: str,
    name: str,
    role: str,
  });
  return {
    type: "array",
    maxItems: 12,
    items: schema(
      {
        pattern: { type: "string", enum: PATTERN_NAMES },
        data: schema({
          eyebrow: str,
          title: str,
          subtitle: str,
          text: str,
          buttonText: str,
          buttonUrl: str,
          secondaryText: str,
          secondaryUrl: str,
          mediaId: idSchema,
          reverse: { type: "boolean" },
          tone: { type: "string", enum: ["light", "dark"] },
          items: { type: "array", maxItems: 10, items: item },
          contacts: {
            type: "array",
            maxItems: 8,
            items: schema(
              {
                type: { type: "string", enum: Object.keys(CONTACT_ICON) },
                label: str,
                value: str,
              },
              ["type", "value"],
            ),
          },
          faq: {
            type: "array",
            maxItems: 12,
            items: schema({ question: str, answer: str }, [
              "question",
              "answer",
            ]),
          },
          links: {
            type: "array",
            maxItems: 12,
            items: schema({ text: str, url: str }, ["text", "url"]),
          },
          copyright: str,
        }),
      },
      ["pattern", "data"],
    ),
  };
}
const DATA_KEYS = [
  "eyebrow",
  "title",
  "subtitle",
  "text",
  "buttonText",
  "buttonUrl",
  "secondaryText",
  "secondaryUrl",
  "mediaId",
  "reverse",
  "tone",
  "items",
  "contacts",
  "faq",
  "links",
  "copyright",
];
module.exports = {
  PATTERNS,
  PATTERN_NAMES,
  expandPatterns,
  patternsSchema,
  DEFAULT_PALETTE,
  DATA_KEYS,
  toHtml,
  buildTemplate,
};
