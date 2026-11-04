"use strict";
// Elementor global colors and fonts (Site Settings / Kit): validation and shaping, pure (no network).
// Colors are hex values. Fonts must be Google Fonts names or the system fonts Elementor offers, so a page can never reference a
// font Elementor would not load. The list is curated (the popular Google Fonts plus every Google Font with Hebrew support);
// a font that is not listed is refused with the list of suggestions.
const { createHash } = require("node:crypto");

const fail = (message) => {
  throw Object.assign(new Error(message), { infra: true, elementor: true });
};
const SYSTEM_IDS = ["primary", "secondary", "text", "accent"];
// Elementor's "System" font group.
const SYSTEM_FONTS = [
  "Arial",
  "Tahoma",
  "Verdana",
  "Helvetica",
  "Times New Roman",
  "Trebuchet MS",
  "Georgia",
];
// Google Fonts with Hebrew glyphs (good for Hebrew sites).
const HEBREW_FONTS = [
  "Alef",
  "Amatic SC",
  "Arimo",
  "Assistant",
  "Bellefair",
  "Cousine",
  "David Libre",
  "Frank Ruhl Libre",
  "Heebo",
  "IBM Plex Sans Hebrew",
  "Karantina",
  "Miriam Libre",
  "Noto Rashi Hebrew",
  "Noto Sans Hebrew",
  "Noto Serif Hebrew",
  "Open Sans",
  "Playpen Sans Hebrew",
  "Rubik",
  "Secular One",
  "Suez One",
  "Tinos",
  "Varela Round",
];
const LATIN_FONTS = [
  "Abril Fatface",
  "Alegreya",
  "Alegreya Sans",
  "Almarai",
  "Anton",
  "Archivo",
  "Arvo",
  "Asap",
  "Baloo 2",
  "Barlow",
  "Be Vietnam Pro",
  "Bebas Neue",
  "Bitter",
  "Cabin",
  "Cairo",
  "Catamaran",
  "Caveat",
  "Cinzel",
  "Comfortaa",
  "Cormorant Garamond",
  "Crimson Text",
  "DM Sans",
  "DM Serif Display",
  "Dancing Script",
  "Domine",
  "Dosis",
  "EB Garamond",
  "Epilogue",
  "Exo 2",
  "Fira Sans",
  "Fredoka",
  "Great Vibes",
  "Hind",
  "IBM Plex Mono",
  "IBM Plex Sans",
  "IBM Plex Serif",
  "Inter",
  "Josefin Sans",
  "Kanit",
  "Karla",
  "Lato",
  "Lexend",
  "Libre Baskerville",
  "Lobster",
  "Lora",
  "Manrope",
  "Maven Pro",
  "Merriweather",
  "Montserrat",
  "Mukta",
  "Mulish",
  "Noto Sans",
  "Noto Sans Display",
  "Noto Serif",
  "Nunito",
  "Nunito Sans",
  "Oswald",
  "Outfit",
  "Overpass",
  "Pacifico",
  "Playfair Display",
  "Plus Jakarta Sans",
  "Poppins",
  "Prompt",
  "PT Sans",
  "PT Serif",
  "Public Sans",
  "Quicksand",
  "Raleway",
  "Red Hat Display",
  "Roboto",
  "Roboto Condensed",
  "Roboto Mono",
  "Roboto Slab",
  "Rajdhani",
  "Sarabun",
  "Sora",
  "Source Sans 3",
  "Space Grotesk",
  "Spectral",
  "Tajawal",
  "Teko",
  "Titillium Web",
  "Ubuntu",
  "Urbanist",
  "Vollkorn",
  "Work Sans",
  "Yanone Kaffeesatz",
  "Zilla Slab",
];
const FONTS = [...new Set([...SYSTEM_FONTS, ...HEBREW_FONTS, ...LATIN_FONTS])];
const FONT_BY_LOWER = new Map(FONTS.map((f) => [f.toLowerCase(), f]));
const WEIGHTS = [
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "normal",
  "bold",
];
const HEX6 = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CUSTOM_ID = /^[a-z0-9]{3,12}$/;
const object = (v) => v && typeof v === "object" && !Array.isArray(v);

const schema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = { type: "string" };
const globalsSchema = {
  globalColors: {
    type: "array",
    maxItems: 12,
    items: schema({ id: str, title: str, value: str }, ["value"]),
  },
  globalFonts: {
    type: "array",
    maxItems: 12,
    items: schema(
      {
        id: str,
        title: str,
        family: str,
        weight: { type: "string", enum: WEIGHTS },
      },
      ["family"],
    ),
  },
};
const GLOBALS_TOOL = "wp_prepare_elementor_globals";
const globalsTools = [
  {
    name: "wp_read_elementor_globals",
    description:
      "Read-only. The site's current Elementor global colors and fonts (Site Settings): ids, titles, hex values, font families and weights, and whether this Elementor version allows changing them from here. Read it before wp_prepare_elementor_globals.",
    parameters: schema({}),
  },
  {
    name: GLOBALS_TOOL,
    description:
      "Prepare a change of Elementor global colors and fonts (Site Settings). System ids: primary, secondary, text, accent (colors and fonts). A custom global needs a title (new) or its id (existing). Colors are hex (#RRGGBB). Fonts: Google Fonts or Elementor system fonts only. Affects the whole site; custom globals created here cannot be deleted remotely. Nothing is written before the user approves the review card.",
    parameters: schema(globalsSchema),
  },
];

const clean = (s, max, label) => {
  if (
    typeof s !== "string" ||
    !s.trim() ||
    s.length > max ||
    /[<>\x00-\x1f\x7f]/.test(s)
  )
    fail(`${label}: טקסט רגיל עד ${max} תווים, בלי HTML`);
  return s.trim();
};
function validateGlobals(args) {
  if (!object(args)) fail("ארגומנטים לא תקינים");
  for (const key of Object.keys(args))
    if (!["globalColors", "globalFonts"].includes(key))
      fail(`המאפיין "${key}" אינו מוכר. מותרים: globalColors, globalFonts`);
  const colors = args.globalColors ?? [],
    fonts = args.globalFonts ?? [];
  if (!Array.isArray(colors) || !Array.isArray(fonts))
    fail("globalColors ו־globalFonts חייבים להיות מערכים");
  if (!colors.length && !fonts.length) fail("לא התבקש שינוי בצבעים או בגופנים");
  if (colors.length > 12 || fonts.length > 12)
    fail("עד 12 צבעים ו־12 גופנים בבקשה");
  const seen = new Set();
  const idOf = (item, label) => {
    if (item.id === undefined) return undefined;
    if (
      typeof item.id !== "string" ||
      !(SYSTEM_IDS.includes(item.id) || CUSTOM_ID.test(item.id))
    )
      fail(
        `${label}.id: primary/secondary/text/accent או מזהה של גלובלי מותאם קיים`,
      );
    return item.id;
  };
  const outColors = colors.map((c, i) => {
    const label = `globalColors[${i}]`;
    if (!object(c)) fail(`${label}: אובייקט עם value`);
    for (const k of Object.keys(c))
      if (!["id", "title", "value"].includes(k))
        fail(`${label}: המאפיין "${k}" אינו מוכר`);
    if (typeof c.value !== "string" || !HEX6.test(c.value))
      fail(`${label}.value: צבע בפורמט #RRGGBB`);
    const id = idOf(c, label);
    const title =
      c.title === undefined ? undefined : clean(c.title, 40, `${label}.title`);
    if (id === undefined && title === undefined)
      fail(`${label}: צבע מותאם חדש דורש title (או id של קיים)`);
    const key = `c:${id ?? title.toLowerCase()}`;
    if (seen.has(key)) fail(`${label}: כפילות`);
    seen.add(key);
    return { id, title, value: c.value.toUpperCase() };
  });
  const outFonts = fonts.map((f, i) => {
    const label = `globalFonts[${i}]`;
    if (!object(f)) fail(`${label}: אובייקט עם family`);
    for (const k of Object.keys(f))
      if (!["id", "title", "family", "weight"].includes(k))
        fail(`${label}: המאפיין "${k}" אינו מוכר`);
    const family = FONT_BY_LOWER.get(String(f.family).toLowerCase());
    if (!family)
      fail(
        `${label}.family: הגופן "${String(f.family).slice(0, 40)}" אינו ברשימת הגופנים המותרים (Google Fonts נפוצים וגופני המערכת של Elementor). לאתר בעברית מומלצים: ${HEBREW_FONTS.slice(0, 10).join(", ")}.`,
      );
    if (f.weight !== undefined && !WEIGHTS.includes(f.weight))
      fail(`${label}.weight: אחד מ־${WEIGHTS.join(", ")}`);
    const id = idOf(f, label);
    const title =
      f.title === undefined ? undefined : clean(f.title, 40, `${label}.title`);
    if (id === undefined && title === undefined)
      fail(`${label}: גופן מותאם חדש דורש title (או id של קיים)`);
    const key = `f:${id ?? title.toLowerCase()}`;
    if (seen.has(key)) fail(`${label}: כפילות`);
    seen.add(key);
    return { id, title, family, weight: f.weight };
  });
  return { globalColors: outColors, globalFonts: outFonts };
}
// New custom globals get a short stable id (Elementor uses 7 hex characters).
function newId(kind, title, taken) {
  for (let n = 0; ; n++) {
    const id = createHash("sha1")
      .update(`adactive:${kind}:${title}:${n}`)
      .digest("hex")
      .slice(0, 7);
    if (!taken.has(id)) return id;
  }
}
// Keep only typography keys we understand, with scalar or {unit,size,sizes} values.
const FONT_VALUE_KEY =
  /^typography_(?:typography|font_family|font_weight|font_size|font_style|text_transform|text_decoration|line_height|letter_spacing|word_spacing)(?:_tablet|_mobile)?$/;
function fontValue(value) {
  const out = {};
  if (!object(value)) return out;
  for (const [k, v] of Object.entries(value)) {
    if (!FONT_VALUE_KEY.test(k)) continue;
    if (["string", "number"].includes(typeof v)) out[k] = v;
    else if (object(v) && ["unit", "size", "sizes"].every((x) => x in v))
      out[k] = {
        unit: String(v.unit),
        size: v.size,
        sizes: Array.isArray(v.sizes) ? v.sizes : [],
      };
  }
  return out;
}
module.exports = {
  globalsSchema,
  SYSTEM_IDS,
  SYSTEM_FONTS,
  HEBREW_FONTS,
  FONTS,
  WEIGHTS,
  GLOBALS_TOOL,
  globalsTools,
  validateGlobals,
  newId,
  fontValue,
  HEX6,
};
