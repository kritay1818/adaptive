"use strict";
const { text } = require("./core.cjs");

const BLOCKS = new Set("image gallery columns column group cover buttons button separator spacer heading paragraph list list-item quote".split(" "));
const TAGS = new Set("p h1 h2 h3 h4 h5 h6 div section span ul ol li strong em b i br hr a figure figcaption img blockquote cite".split(" "));
const VOID = new Set(["br", "hr", "img"]);
const fail = () => { throw new Error("תוכן העמוד כולל בלוק, מאפיין או עיצוב שאינם מורשים"); };
const plain = (v) => typeof v === "string" && v.length <= 2048 && !/[<>\x00-\x1f\x7f]/.test(v);
const slug = (v) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const choice = (...values) => (v) => values.includes(v);
const number = (min, max) => (v) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const integer = (min, max) => (v) => Number.isInteger(v) && number(min, max)(v);
const bool = (v) => typeof v === "boolean";
const preset = /^var\(--wp--preset--(?:spacing|font-size|color|font-family)--[a-z0-9-]+\)$/i;
const length = (v) => (typeof v === "number" && number(0, 10000)(v)) ||
  (typeof v === "string" && (/^(?:0|(?:\d{1,5}(?:\.\d{1,3})?|\.\d{1,3})(?:px|rem|em|vh|vw|%))$/.test(v) || preset.test(v) || /^var:preset\|(?:spacing|font-size)\|[a-z0-9-]+$/i.test(v)));
const color = (v) => typeof v === "string" && (/^(?:#[a-f0-9]{3,8}|[a-z]{1,30}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%/+-]+\))$/i.test(v) || preset.test(v));
const dimension = (v) => length(v) || choice("auto", "fit-content", "max-content")(v);
const alignment = choice("left", "center", "right", "wide", "full");
const positiveId = integer(1, 1000000000);

function contentURL(value, fragment = false) {
  if (!plain(value) || /[\s\\]/.test(value)) return false;
  if (fragment && /^#[a-zA-Z][\w-]*$/.test(value)) return true;
  try {
    const u = new URL(value);
    return value.startsWith("https://") && u.protocol === "https:" && !u.username && !u.password;
  } catch { return false; }
}
function object(value, rules) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, v]) => Object.hasOwn(rules, key) && rules[key](v));
}
const sides = (v) => length(v) || object(v, { top: length, right: length, bottom: length, left: length });
const layout = (v) => object(v, {
  type: choice("default", "constrained", "flex", "grid"),
  contentSize: length, wideSize: length,
  justifyContent: choice("left", "center", "right", "space-between", "stretch"),
  orientation: choice("horizontal", "vertical"), flexWrap: choice("wrap", "nowrap"),
  verticalAlignment: choice("top", "center", "bottom", "stretch"),
  columnCount: integer(1, 12), minimumColumnWidth: length,
});
const style = (v) => object(v, {
  color: (v) => object(v, { text: color, background: color }),
  spacing: (v) => object(v, { padding: sides, margin: sides, blockGap: (v) => length(v) || object(v, { top: length, left: length }) }),
  typography: (v) => object(v, {
    fontSize: length, lineHeight: (v) => number(0.5, 5)(v) || (typeof v === "string" && /^(?:[0-4](?:\.\d{1,3})?|5)$/.test(v)),
    fontWeight: (v) => /^(?:[1-9]00|normal|bold)$/.test(String(v)),
    fontStyle: choice("normal", "italic"), letterSpacing: length,
    textTransform: choice("none", "uppercase", "lowercase", "capitalize"),
    textDecoration: choice("none", "underline", "line-through"),
  }),
  dimensions: (v) => object(v, { minHeight: length, aspectRatio: (v) => typeof v === "string" && /^(?:auto|\d{1,4}\s*\/\s*\d{1,4})$/.test(v) }),
  border: (v) => object(v, { color, width: length, style: choice("none", "solid", "dashed", "dotted"), radius: sides }),
});
const common = {
  className: (v) => typeof v === "string" && /^[a-zA-Z0-9 _-]{0,300}$/.test(v),
  anchor: (v) => typeof v === "string" && /^[a-zA-Z][\w-]{0,100}$/.test(v),
  align: alignment, textAlign: choice("left", "center", "right"),
  textColor: slug, backgroundColor: slug, fontSize: slug, fontFamily: slug,
  style, layout,
};
const imageAttrs = {
  id: positiveId, url: contentURL, alt: plain,
  width: dimension, height: dimension, aspectRatio: (v) => typeof v === "string" && /^(?:auto|\d{1,4}\s*\/\s*\d{1,4})$/.test(v),
  scale: choice("cover", "contain"), sizeSlug: slug,
  linkDestination: choice("none", "media", "custom"), href: contentURL,
  linkTarget: choice("_blank", "_self"), rel: (v) => typeof v === "string" && /^(?:(?:noopener|noreferrer|nofollow)\s*)+$/.test(v),
};
const attributes = {
  image: imageAttrs,
  gallery: { columns: integer(1, 12), imageCrop: bool, linkTo: choice("none", "media"), sizeSlug: slug, ids: (v) => Array.isArray(v) && v.length <= 100 && v.every(positiveId) },
  columns: { isStackedOnMobile: bool, verticalAlignment: choice("top", "center", "bottom") },
  column: { width: length, verticalAlignment: choice("top", "center", "bottom") },
  group: { tagName: choice("div", "section") },
  cover: { id: positiveId, url: contentURL, alt: plain, dimRatio: number(0, 100),
    overlayColor: slug, customOverlayColor: color, isUserOverlayColor: bool,
    backgroundType: choice("image"), isDark: bool, hasParallax: bool, isRepeated: bool,
    minHeight: number(0, 10000), minHeightUnit: choice("px", "vh", "vw", "em", "rem"),
    contentPosition: choice("top left", "top center", "top right", "center left", "center center", "center right", "bottom left", "bottom center", "bottom right"),
    focalPoint: (v) => object(v, { x: number(0, 1), y: number(0, 1) }),
  },
  buttons: {}, button: { width: choice(25, 50, 75, 100), tagName: choice("a") },
  separator: { opacity: choice("alpha-channel", "css") },
  spacer: { height: length, width: length },
  heading: { level: integer(1, 6) }, paragraph: { dropCap: bool },
  list: { ordered: bool, start: integer(1, 100000), reversed: bool },
  "list-item": {}, quote: {},
};
const cssRules = {
  color, "background-color": color, "font-size": length,
  "font-family": (v) => preset.test(v),
  "font-weight": (v) => /^(?:[1-9]00|normal|bold)$/.test(v),
  "font-style": choice("normal", "italic"),
  "line-height": (v) => /^(?:[0-4](?:\.\d{1,3})?|5)$/.test(v) || length(v),
  "letter-spacing": length, "text-align": choice("left", "center", "right"),
  "text-transform": choice("none", "uppercase", "lowercase", "capitalize"),
  "text-decoration": choice("none", "underline", "line-through"),
  width: dimension, height: dimension, "min-height": length, "min-width": length,
  "max-width": dimension, "max-height": dimension, "flex-basis": dimension,
  "aspect-ratio": (v) => /^(?:auto|\d{1,4}\s*\/\s*\d{1,4})$/.test(v),
  "object-fit": choice("cover", "contain", "fill", "none", "scale-down"),
  "object-position": (v) => /^(?:\d{1,3}(?:\.\d+)?%|left|center|right|top|bottom)(?: (?:\d{1,3}(?:\.\d+)?%|left|center|right|top|bottom))?$/.test(v),
  opacity: (v) => /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(v),
  display: choice("flex", "grid", "block", "inline-block"),
  "flex-direction": choice("row", "column"), "flex-wrap": choice("wrap", "nowrap"),
  "justify-content": choice("flex-start", "center", "flex-end", "space-between"),
  "align-items": choice("flex-start", "center", "flex-end", "stretch"), gap: length,
  "border-color": color, "border-width": length, "border-style": choice("none", "solid", "dashed", "dotted"), "border-radius": length,
};
for (const name of ["padding", "margin"]) {
  cssRules[name] = (v) => v.split(/\s+/).length <= 4 && v.split(/\s+/).every(length);
  for (const side of ["top", "right", "bottom", "left"]) cssRules[`${name}-${side}`] = length;
}
function css(value) {
  // No CSS escapes, comments, arbitrary functions, URL fetches or declarations.
  if (/[\\<>@!]|\/\*|\*\//.test(value)) return false;
  return value.split(";").every((part) => {
    if (!part.trim()) return true;
    const colon = part.indexOf(":");
    const key = part.slice(0, colon).trim().toLowerCase();
    return colon > 0 && Object.hasOwn(cssRules, key) && cssRules[key](part.slice(colon + 1).trim());
  });
}
function decode(value) {
  return value.replace(/&(?:#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (entity) => {
    const m = /^&#(x[0-9a-f]+|\d+);?$/i.exec(entity);
    if (m) {
      const n = m[1][0].toLowerCase() === "x" ? parseInt(m[1].slice(1), 16) : Number(m[1]);
      if (!n || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) fail();
      return String.fromCodePoint(n);
    }
    const named = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
    if (!Object.hasOwn(named, entity)) fail();
    return named[entity];
  });
}
function htmlAttribute(tag, key, value) {
  if (/^on/i.test(key) || /[\x00-\x1f\x7f]/.test(value)) return false;
  if (key === "class") return common.className(value);
  if (key === "id") return common.anchor(value);
  if (key === "style") return css(value);
  if (key === "title" || key === "aria-label") return plain(value);
  if (key === "dir") return ["rtl", "ltr", "auto"].includes(value);
  if (key === "aria-hidden") return ["true", "false"].includes(value);
  if (tag === "img") {
    if (key === "src") return contentURL(value);
    if (key === "alt") return plain(value);
    if (["width", "height"].includes(key)) return /^\d{1,5}$/.test(value);
    if (key === "loading") return ["lazy", "eager"].includes(value);
    if (key === "decoding") return ["async", "sync", "auto"].includes(value);
  }
  if (tag === "a") {
    if (key === "href") return contentURL(value, true);
    if (key === "target") return ["_blank", "_self"].includes(value);
    if (key === "rel") return imageAttrs.rel(value);
  }
  if (tag === "ol" && key === "start") return /^\d{1,6}$/.test(value);
  return false;
}
function safeHTML(source) {
  text(source, 60000);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(source)) fail();
  // WordPress expands shortcodes (including embed/form plugins) outside the block parser.
  if (/\[\/?[a-zA-Z][\w-]*(?=[\s/\]])/.test(source)) fail();
  const blocks = [], tags = [];
  let offset = 0;
  while (offset < source.length) {
    if (source[offset] !== "<") { offset++; continue; }
    if (source.startsWith("<!--", offset)) {
      const end = source.indexOf("-->", offset + 4);
      if (end < 0) fail();
      const comment = source.slice(offset + 4, end).trim();
      const m = /^(\/?)wp:(?:core\/)?([a-z-]+)(?:\s+(\{[\s\S]*\}))?\s*(\/?)$/.exec(comment);
      if (!m || !BLOCKS.has(m[2])) fail();
      if (m[1]) {
        if (m[3] || m[4] || blocks.pop() !== m[2]) fail();
      } else {
        if (m[3]) {
          let attrs;
          try { attrs = JSON.parse(m[3]); } catch { fail(); }
          if (!object(attrs, { ...common, ...attributes[m[2]] })) fail();
        }
        if (!m[4]) blocks.push(m[2]);
        if (blocks.length > 40) fail();
      }
      offset = end + 3;
      continue;
    }
    const m = /^<(\/?)([a-z][a-z0-9]*)(?=\s|\/?>)/i.exec(source.slice(offset));
    if (!m || !TAGS.has(m[2].toLowerCase())) fail();
    const tag = m[2].toLowerCase();
    offset += m[0].length;
    if (m[1]) {
      const close = /^\s*>/.exec(source.slice(offset));
      if (!close || VOID.has(tag) || tags.pop() !== tag) fail();
      offset += close[0].length;
      continue;
    }
    const seen = new Set();
    while (true) {
      const close = /^\s*(\/?)>/.exec(source.slice(offset));
      if (close) {
        if (close[1] && !VOID.has(tag)) fail();
        offset += close[0].length;
        break;
      }
      const attr = /^\s+([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/.exec(source.slice(offset));
      if (!attr) fail();
      const key = attr[1].toLowerCase();
      if (seen.has(key) || !htmlAttribute(tag, key, decode(attr[2] ?? attr[3]))) fail();
      seen.add(key);
      offset += attr[0].length;
    }
    if (tag === "img" && !seen.has("src")) fail();
    if (!VOID.has(tag)) tags.push(tag);
    if (tags.length > 80) fail();
  }
  if (tags.length || blocks.length) fail();
  return source;
}
module.exports = { safeHTML, contentURL };
