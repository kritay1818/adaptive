"use strict";
// Built-in design kit: a tested base stylesheet and section patterns rendered to validator-clean block HTML.
// The model supplies data (text, image references, links, brand values); the app produces the markup, so pages cannot
// come out broken, and a whole page costs a few hundred output tokens instead of thousands.
const BASE_CSS = require("./base.css.cjs");
const { contentLink, contactLink } = require("../wp-content.cjs");

const fail = (message) => {
  throw new Error(message);
};
const esc = (v) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (v) =>
  esc(String(v).replace(/[<>"'\x00-\x1f]/g, " ")).replace(/"/g, "&quot;");
// Block-comment JSON: keep it free of < > & so it can never close the comment.
const json = (v) =>
  JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
const REF_ID = /^\{\{[a-z][a-z0-9_]{0,39}\.id\}\}$/;
const REF_URL = /^\{\{[a-z][a-z0-9_]{0,39}\.url\}\}$/;

function text(v, name, { max = 2000, required = false } = {}) {
  if (v === undefined || v === null || v === "") {
    if (required) fail(`חסר שדה חובה: ${name}`);
    return "";
  }
  if (typeof v !== "string") fail(`השדה ${name} חייב להיות טקסט`);
  if (v.length > max)
    fail(`השדה ${name} ארוך מדי (${v.length} תווים, המקסימום ${max})`);
  return v;
}
function url(v, name, { required = false } = {}) {
  const value = text(v, name, { max: 2048, required });
  if (value && !contentLink(value, true) && !contactLink(value))
    fail(
      `${name}: קישור לא מורשה "${value.slice(0, 60)}" (מותר https, נתיב יחסי כמו /contact/, #עוגן, tel: או mailto: תקין)`,
    );
  return value;
}
function imageUrl(v, name, required) {
  const value = text(v, name, { max: 2048, required });
  if (value && !REF_URL.test(value) && !/^https:\/\/[^\s\\<>"']+$/.test(value))
    fail(
      `${name}: כתובת תמונה חייבת להיות https או הפניה {{key.url}} להעלאה קודמת`,
    );
  return value;
}
function imageId(v, name) {
  if (v === undefined || v === null || v === "") return "";
  if (Number.isSafeInteger(v) && v > 0) return String(v);
  if (typeof v === "string" && REF_ID.test(v)) return v;
  fail(`${name}: מזהה תמונה חייב להיות מספר או הפניה {{key.id}} להעלאה קודמת`);
}
function list(v, name, min, max) {
  if (!Array.isArray(v) || v.length < min || v.length > max)
    fail(
      `${name} חייב להיות מערך של ${min}${max === min ? "" : `–${max}`} פריטים`,
    );
  return v;
}
const optionalList = (v, name, max) =>
  v === undefined ? [] : list(v, name, 0, max);

// ---- block builders -------------------------------------------------------------------------------------------
const heading = (level, value, center = false) =>
  `<!-- wp:heading ${json({ level, ...(center ? { textAlign: "center" } : {}) })} --><h${level} class="wp-block-heading${center ? " has-text-align-center" : ""}">${esc(value)}</h${level}><!-- /wp:heading -->`;
const paragraph = (value, cls = "") =>
  `<!-- wp:paragraph${cls ? " " + json({ className: cls }) : ""} --><p${cls ? ` class="${cls}"` : ""}>${esc(value)}</p><!-- /wp:paragraph -->`;
function buttons(items) {
  const rows = items.filter((b) => b.label && b.url);
  if (!rows.length) return "";
  return `<!-- wp:buttons ${json({ className: "ad-actions", layout: { type: "flex", justifyContent: "center" } })} --><div class="wp-block-buttons ad-actions">${rows.map((b) => `<!-- wp:button ${json({ className: "ad-btn" })} --><div class="wp-block-button ad-btn"><a class="wp-block-button__link wp-element-button" href="${escAttr(b.url)}">${esc(b.label)}</a></div><!-- /wp:button -->`).join("")}</div><!-- /wp:buttons -->`;
}
function image({ url: src, id, alt }, cls) {
  const attrs = `{${id ? `"id":${id},` : ""}"sizeSlug":"large","className":${json(cls)}}`;
  return `<!-- wp:image ${attrs} --><figure class="wp-block-image size-large ${cls}"><img src="${escAttr(src)}" alt="${escAttr(alt || "")}"${id ? ` class="wp-image-${id}"` : ""}/></figure><!-- /wp:image -->`;
}
const column = (inner, basis = "") =>
  `<!-- wp:column${basis ? " " + json({ width: basis }) : ""} --><div class="wp-block-column"${basis ? ` style="flex-basis:${basis}"` : ""}>${inner}</div><!-- /wp:column -->`;
const columns = (cols, cls) =>
  `<!-- wp:columns ${json({ className: cls, isStackedOnMobile: true })} --><div class="wp-block-columns ${cls}">${cols.join("")}</div><!-- /wp:columns -->`;
const card = (inner) =>
  `<!-- wp:group ${json({ className: "ad-card" })} --><div class="wp-block-group ad-card">${inner}</div><!-- /wp:group -->`;
function section(inner, cls, tone) {
  const t = tone === "tint" ? " ad-tint" : tone === "dark" ? " ad-dark" : "";
  return `<!-- wp:group ${json({ align: "full", className: `ad-section ${cls}${t}`, layout: { type: "constrained", contentSize: "1140px" } })} --><div class="wp-block-group alignfull ad-section ${cls}${t}">${inner}</div><!-- /wp:group -->`;
}
const tone = (d, fallback) =>
  ["light", "tint", "dark"].includes(d.tone) ? d.tone : fallback;
const action = (d) => [
  {
    label: text(d.buttonLabel, "buttonLabel"),
    url: url(d.buttonUrl, "buttonUrl"),
  },
];
const headLead = (d) =>
  (d.heading ? heading(2, text(d.heading, "heading"), true) : "") +
  (d.text ? paragraph(text(d.text, "text"), "ad-lead") : "");

// ---- patterns ---------------------------------------------------------------------------------------------------
const PATTERNS = {
  "hero-image": {
    about:
      "Full-width hero with a background image (cover), heading, subheading and one button. Fields: heading*, imageUrl*, imageId*, alt, subheading, buttonLabel+buttonUrl.",
    render(d) {
      const src = imageUrl(d.imageUrl, "imageUrl", true),
        id = imageId(d.imageId, "imageId") || fail("חסר שדה חובה: imageId");
      const inner =
        heading(1, text(d.heading, "heading", { required: true }), true) +
        (d.subheading
          ? paragraph(text(d.subheading, "subheading"), "has-text-align-center")
          : "") +
        buttons(action(d));
      return `<!-- wp:cover ${json({ url: src, id: "__ID__", dimRatio: 55, overlayColor: "black", minHeight: 560, isDark: true, align: "full", className: "ad-hero site-hero" }).replace('"__ID__"', id)} --><div class="wp-block-cover alignfull ad-hero site-hero is-dark" style="min-height:560px"><span aria-hidden="true" class="wp-block-cover__background has-black-background-color has-background-dim-50 has-background-dim"></span><img class="wp-block-cover__image-background wp-image-${id}" alt="${escAttr(d.alt || "")}" src="${escAttr(src)}" data-object-fit="cover"/><div class="wp-block-cover__inner-container">${inner}</div></div><!-- /wp:cover -->`;
    },
  },
  "hero-simple": {
    about:
      "Full-width colored hero without an image. Fields: heading*, subheading, buttonLabel+buttonUrl.",
    render: (d) =>
      section(
        heading(1, text(d.heading, "heading", { required: true }), true) +
          (d.subheading
            ? paragraph(
                text(d.subheading, "subheading"),
                "has-text-align-center",
              )
            : "") +
          buttons(action(d)),
        "ad-hero ad-hero--simple site-hero",
        "dark",
      ),
  },
  "text-image": {
    about:
      'Text next to an image. Fields: paragraphs*(1-6 strings), imageUrl*, imageId, alt, imageSide* (visual side on screen: "right"|"left"), heading, buttonLabel+buttonUrl, tone.',
    render(d) {
      const side =
        d.imageSide === "left"
          ? "left"
          : d.imageSide === "right"
            ? "right"
            : fail(
                "imageSide חייב להיות right או left (הצד הוויזואלי של התמונה במסך)",
              );
      const body =
        (d.heading ? heading(2, text(d.heading, "heading")) : "") +
        list(d.paragraphs, "paragraphs", 1, 6)
          .map((p, i) =>
            paragraph(text(p, `paragraphs[${i}]`, { required: true })),
          )
          .join("") +
        buttons(action(d));
      const img = image(
        {
          url: imageUrl(d.imageUrl, "imageUrl", true),
          id: imageId(d.imageId, "imageId"),
          alt: text(d.alt, "alt", { max: 300 }),
        },
        "ad-media",
      );
      return section(
        columns(
          [column(body, "50%"), column(img, "50%")],
          `ad-split ad-side-${side}`,
        ),
        "ad-text-image",
        tone(d, "light"),
      );
    },
  },
  "services-grid": {
    about:
      "3-5 cards side by side, each with a title, short text and an optional icon/image. Fields: items*(3-5 of {title*, text*, imageUrl, imageId, alt}), heading, text (lead), tone. Items in reading order.",
    render(d) {
      const items = list(d.items, "items", 3, 5);
      const cols = items.map((it, i) =>
        column(
          card(
            (it.imageUrl
              ? image(
                  {
                    url: imageUrl(it.imageUrl, `items[${i}].imageUrl`),
                    id: imageId(it.imageId, `items[${i}].imageId`),
                    alt: text(it.alt, "alt", { max: 300 }),
                  },
                  "ad-icon",
                )
              : "") +
              heading(
                3,
                text(it.title, `items[${i}].title`, { required: true }),
              ) +
              paragraph(text(it.text, `items[${i}].text`, { required: true })),
          ),
        ),
      );
      return section(
        headLead(d) + columns(cols, "ad-grid"),
        "ad-services",
        tone(d, "tint"),
      );
    },
  },
  "features-list": {
    about:
      "2-8 short features in two columns. Fields: items*(2-8 of {title*, text}), heading, text (lead), tone.",
    render(d) {
      const items = list(d.items, "items", 2, 8).map(
        (it, i) =>
          `<!-- wp:group ${json({ className: "ad-feature" })} --><div class="wp-block-group ad-feature">${heading(3, text(it.title, `items[${i}].title`, { required: true }))}${it.text ? paragraph(text(it.text, `items[${i}].text`)) : ""}</div><!-- /wp:group -->`,
      );
      return section(
        headLead(d) +
          columns(
            [
              column(items.filter((_, i) => i % 2 === 0).join("")),
              column(items.filter((_, i) => i % 2 === 1).join("")),
            ],
            "ad-grid",
          ),
        "ad-features",
        tone(d, "light"),
      );
    },
  },
  testimonials: {
    about:
      "1-3 customer quotes. Fields: items*(1-3 of {quote*, name*, role}), heading, tone.",
    render(d) {
      const cols = list(d.items, "items", 1, 3).map((it, i) =>
        column(
          `<!-- wp:quote ${json({ className: "ad-quote" })} --><blockquote class="wp-block-quote ad-quote">${paragraph(text(it.quote, `items[${i}].quote`, { required: true }))}<cite>${esc([text(it.name, `items[${i}].name`, { required: true }), text(it.role, "role", { max: 200 })].filter(Boolean).join(", "))}</cite></blockquote><!-- /wp:quote -->`,
        ),
      );
      return section(
        headLead(d) + columns(cols, "ad-grid"),
        "ad-testimonials",
        tone(d, "tint"),
      );
    },
  },
  "cta-band": {
    about:
      "Closing call-to-action band. Fields: heading*, buttonLabel*, buttonUrl*, text.",
    render(d) {
      const label = text(d.buttonLabel, "buttonLabel", { required: true }),
        link = url(d.buttonUrl, "buttonUrl", { required: true });
      return section(
        heading(2, text(d.heading, "heading", { required: true }), true) +
          (d.text
            ? paragraph(text(d.text, "text"), "has-text-align-center")
            : "") +
          buttons([{ label, url: link }]),
        "ad-cta",
        "light",
      );
    },
  },
  "contact-details": {
    about:
      "Address, phone, hours, email as a row of items. Fields: items*(1-6 of {label*, value*, url}), heading, buttonLabel+buttonUrl, tone. Use tel:/mailto: urls for phone/email.",
    render(d) {
      const cols = list(d.items, "items", 1, 6).map((it, i) => {
        const value = text(it.value, `items[${i}].value`, { required: true }),
          link = url(it.url, `items[${i}].url`);
        return column(
          `<!-- wp:group ${json({ className: "ad-contact-item" })} --><div class="wp-block-group ad-contact-item"><!-- wp:paragraph --><p><strong>${esc(text(it.label, `items[${i}].label`, { required: true }))}</strong>${link ? `<a href="${escAttr(link)}">${esc(value)}</a>` : esc(value)}</p><!-- /wp:paragraph --></div><!-- /wp:group -->`,
        );
      });
      return section(
        (d.heading ? heading(2, text(d.heading, "heading"), true) : "") +
          columns(cols, "ad-grid") +
          buttons(action(d)),
        "ad-contact",
        tone(d, "light"),
      );
    },
  },
  "video-section": {
    about:
      "A video the user uploaded to the media library. Fields: videoUrl* ({{key.url}} of the upload step), videoId ({{key.id}}), posterUrl, caption, heading, text (lead), controls (default true), autoplay (muted loop), tone.",
    render(d) {
      const src = imageUrl(d.videoUrl, "videoUrl", true);
      const id = imageId(d.videoId, "videoId");
      const poster = imageUrl(d.posterUrl, "posterUrl", false);
      const autoplay = d.autoplay === true;
      const muted = autoplay || d.muted === true;
      const loop = autoplay || d.loop === true;
      const controls = d.controls !== false;
      const flags = {
        ...(controls ? { controls: true } : {}),
        ...(autoplay ? { autoplay: true } : {}),
        ...(muted ? { muted: true } : {}),
        ...(loop ? { loop: true } : {}),
        playsInline: true,
      };
      const attrs = `{${id ? `"id":${id},` : ""}${json({ src, ...(poster ? { poster } : {}), ...flags, className: "ad-video" }).slice(1)}`;
      const bare = [
        controls && "controls",
        autoplay && "autoplay",
        muted && "muted",
        loop && "loop",
        "playsinline",
      ]
        .filter(Boolean)
        .join(" ");
      const caption = d.caption
        ? `<figcaption class="wp-element-caption">${esc(text(d.caption, "caption", { max: 300 }))}</figcaption>`
        : "";
      const video = `<!-- wp:video ${attrs} --><figure class="wp-block-video ad-video"><video ${bare} src="${escAttr(src)}"${poster ? ` poster="${escAttr(poster)}"` : ""}></video>${caption}</figure><!-- /wp:video -->`;
      return section(headLead(d) + video, "ad-video-section", tone(d, "light"));
    },
  },
  header: {
    template: true,
    about:
      'Site header (header template part): logo, site title (showTitle), main navigation bound to the menu step (menuKey, default "menu"), contact buttons. Fields: logoWidth, showTitle, menuKey, links (buttons: {label*, url*}).',
    render(d) {
      const key = text(d.menuKey || "menu", "menuKey", { max: 40 });
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(key))
        fail("menuKey חייב להיות מפתח של שלב התפריט (אותיות קטנות באנגלית)");
      const width =
        d.logoWidth === undefined
          ? 120
          : Number.isInteger(d.logoWidth) &&
              d.logoWidth >= 24 &&
              d.logoWidth <= 400
            ? d.logoWidth
            : fail("logoWidth חייב להיות מספר שלם בין 24 ל־400");
      const btns = optionalList(d.links, "links", 3).map((b, i) => ({
        label: text(b.label, `links[${i}].label`, { required: true }),
        url: url(b.url, `links[${i}].url`, { required: true }),
      }));
      return `<!-- wp:group ${json({ className: "ad-header", layout: { type: "flex", justifyContent: "space-between", flexWrap: "wrap" } })} --><div class="wp-block-group ad-header"><!-- wp:site-logo ${json({ width })} /-->${d.showTitle ? `<!-- wp:site-title ${json({ level: 0 })} /-->` : ""}<!-- wp:navigation {"ref":{{${key}.id}},"overlayMenu":"mobile"} /-->${buttons(btns)}</div><!-- /wp:group -->`;
    },
  },
  footer: {
    template: true,
    about:
      "Site footer (footer template part). Fields: paragraphs (source footer text, exact), links ({label*,url*}), contacts ({label*,url*}), social ({service*,url*} https), copyright.",
    render(d) {
      const links = (title, rows, name) =>
        rows.length
          ? `<!-- wp:heading ${json({ level: 3 })} --><h3 class="wp-block-heading">${esc(title)}</h3><!-- /wp:heading -->` +
            rows
              .map(
                (r, i) =>
                  `<!-- wp:paragraph --><p><a href="${escAttr(url(r.url, `${name}[${i}].url`, { required: true }))}">${esc(text(r.label, `${name}[${i}].label`, { required: true }))}</a></p><!-- /wp:paragraph -->`,
              )
              .join("")
          : "";
      const texts = optionalList(d.paragraphs, "paragraphs", 8)
        .map((p, i) =>
          paragraph(text(p, `paragraphs[${i}]`, { required: true })),
        )
        .join("");
      const nav = optionalList(d.links, "links", 10),
        contact = optionalList(d.contacts, "contacts", 6),
        social = optionalList(d.social, "social", 8);
      const socialHtml = social.length
        ? `<!-- wp:social-links --><ul class="wp-block-social-links">${social
            .map((s, i) => {
              const link = text(s.url, `social[${i}].url`, {
                max: 2048,
                required: true,
              });
              if (!/^https:\/\/[^\s\\<>"']+$/.test(link))
                fail(`social[${i}].url חייב להיות https`);
              return `<!-- wp:social-link ${json({ url: link, service: text(s.service, `social[${i}].service`, { required: true }) })} /-->`;
            })
            .join("")}</ul><!-- /wp:social-links -->`
        : "";
      const cols = [
        texts + socialHtml,
        links("קישורים", nav, "links"),
        links("יצירת קשר", contact, "contacts"),
      ]
        .filter(Boolean)
        .map((c) => column(c));
      return `<!-- wp:group ${json({ className: "ad-footer", align: "full", layout: { type: "constrained", contentSize: "1140px" } })} --><div class="wp-block-group alignfull ad-footer">${cols.length ? columns(cols, "ad-grid") : ""}${d.copyright ? paragraph(text(d.copyright, "copyright", { max: 300 })) : ""}</div><!-- /wp:group -->`;
    },
  },
};

const ALLOWED_BRAND = [
  "primary",
  "accent",
  "dark",
  "light",
  "text",
  "fontHeading",
  "fontBody",
  "radius",
];
const COLOR =
  /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*(?:,\s*\d{1,3}\s*){2}(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/;
const FONT = /^[A-Za-z0-9 \u0590-\u05ff'-]{1,40}$/;
// :root variables from the brand, then the base stylesheet, then a small custom addition (max 3 KB).
function kitCss(brand = {}, extra = "") {
  if (!brand || typeof brand !== "object" || Array.isArray(brand))
    fail("brand חייב להיות אובייקט");
  const vars = [];
  for (const [k, v] of Object.entries(brand)) {
    if (!ALLOWED_BRAND.includes(k)) fail(`שדה brand לא מוכר: ${k}`);
    if (v === undefined || v === null || v === "") continue;
    const map = {
      primary: "--ad-primary",
      accent: "--ad-accent",
      dark: "--ad-dark",
      light: "--ad-light",
      text: "--ad-text",
    };
    if (map[k]) {
      if (!COLOR.test(String(v)))
        fail(`brand.${k}: צבע חייב להיות hex או rgb (למשל #1f4e79)`);
      vars.push(`${map[k]}:${v}`);
    } else if (k === "radius") {
      if (!/^\d{1,2}px$/.test(String(v)))
        fail("brand.radius חייב להיות בפורמט 12px");
      vars.push(`--ad-radius:${v}`);
    } else {
      if (!FONT.test(String(v))) fail(`brand.${k}: שם פונט לא תקין`);
      vars.push(
        `${k === "fontHeading" ? "--ad-font-heading" : "--ad-font-body"}:"${v}",system-ui,-apple-system,"Segoe UI",Arial,sans-serif`,
      );
    }
  }
  extra = extra || "";
  if (typeof extra !== "string") fail("extraCss חייב להיות טקסט");
  if (Buffer.byteLength(extra) > 3072)
    fail(
      `extraCss גדול מדי (${Buffer.byteLength(extra)} בתים, המקסימום 3072): תוספות CSS קטנות בלבד מעל ערכת העיצוב`,
    );
  return `${vars.length ? `:root{${vars.join(";")}}\n` : ""}${BASE_CSS}${extra ? "\n/* additions */\n" + extra : ""}`;
}
function renderPattern(name, data) {
  const pattern =
    PATTERNS[name] ||
    fail(
      `תבנית לא מוכרת: ${name}. התבניות: ${Object.keys(PATTERNS).join(", ")}`,
    );
  if (!data || typeof data !== "object" || Array.isArray(data))
    fail(`data של התבנית ${name} חייב להיות אובייקט`);
  try {
    return pattern.render(data);
  } catch (e) {
    throw new Error(`תבנית ${name}: ${e.message}`);
  }
}
// Turns a plan step written with kit arguments into a normal step (content / css) before validation. Other steps pass through.
function expandStep(step) {
  if (
    !step ||
    typeof step !== "object" ||
    !step.args ||
    typeof step.args !== "object"
  )
    return step;
  const a = { ...step.args };
  if (
    /^wp_prepare_(?:create|update)_(?:page|post)$/.test(step.tool) &&
    a.sections !== undefined
  ) {
    if (a.content !== undefined)
      fail("בשלב עמוד יש לתת או content או sections, לא שניהם");
    const sections = list(a.sections, "sections", 1, 20).map((s, i) => {
      if (!s || typeof s !== "object")
        fail(`sections[${i}] חייב להיות {pattern, data}`);
      if (PATTERNS[s.pattern]?.template)
        fail(`התבנית ${s.pattern} מיועדת לשלבי כותרת/תחתית, לא לעמוד`);
      return renderPattern(s.pattern, s.data);
    });
    delete a.sections;
    a.content = sections.join("\n");
  } else if (
    ["wp_prepare_header", "wp_prepare_footer"].includes(step.tool) &&
    a.pattern !== undefined
  ) {
    if (a.content !== undefined)
      fail("בשלב כותרת/תחתית יש לתת או content או pattern");
    const want = step.tool === "wp_prepare_header" ? "header" : "footer";
    if (a.pattern !== want)
      fail(`בשלב ${step.tool} התבנית חייבת להיות ${want}`);
    a.content = renderPattern(a.pattern, a.data);
    delete a.pattern;
    delete a.data;
  } else if (
    step.tool === "wp_prepare_site_css" &&
    (a.brand !== undefined || a.extraCss !== undefined)
  ) {
    if (a.css !== undefined) fail("בשלב CSS יש לתת או css או brand/extraCss");
    a.css = kitCss(a.brand, a.extraCss);
    delete a.brand;
    delete a.extraCss;
  }
  return { ...step, args: a };
}
const describeKit = () =>
  Object.entries(PATTERNS)
    .map(
      ([name, p]) =>
        `${name}${p.template ? " (template part)" : ""}: ${p.about}`,
    )
    .join(" | ");
module.exports = {
  BASE_CSS,
  PATTERNS,
  kitCss,
  renderPattern,
  expandStep,
  describeKit,
};
