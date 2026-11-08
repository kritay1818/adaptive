"use strict";
// Public Google Docs / Sheets links (read only, no login, no cookies). Only "anyone with the link" documents work.
// The export request goes to docs.google.com; its redirect may only go to https://*.googleusercontent.com. Every hop passes
// the same public-IPv4 check, size limit and timeout as other public fetches. The result is UNTRUSTED data for the model.
const https = require("node:https");
const diag = require("./diag.cjs");
const { capBlocks } = require("./documents.cjs");

const NOT_PUBLIC =
  "המסמך לא פתוח לצפייה. בגוגל דוקס: שיתוף ← כל מי שיש לו את הקישור ← צופה";
const HTML_LIMIT = 8 * 1024 * 1024;
const CSV_LIMIT = 4 * 1024 * 1024;
const MAX_HOPS = 4;
const fail = (message) => {
  throw Object.assign(new Error(message), { docs: true });
};
const ID = /^[A-Za-z0-9_-]{15,120}$/;

// Hosts whose links are documents (never websites to import). Returns null for any other link.
const GOOGLE_DOC_HOSTS = new Set([
  "docs.google.com",
  "drive.google.com",
  "sheets.google.com",
  "slides.google.com",
  "drive.usercontent.google.com",
]);
function googleDocLink(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (!GOOGLE_DOC_HOSTS.has(u.hostname.toLowerCase())) return null;
  if (u.hostname === "docs.google.com") {
    if (/^\/document\//.test(u.pathname))
      return "זה מסמך Google Docs — השתמשו ב-wp_read_google_doc";
    if (/^\/spreadsheets\//.test(u.pathname))
      return "זה מסמך Google Sheets — השתמשו ב-wp_read_google_doc";
    return "זה קישור של Google Docs — השתמשו ב-wp_read_google_doc (מסמכים וגיליונות בלבד)";
  }
  return "זה קישור Google Drive — לא אתר. אם זה מסמך Google Docs פתוח לצפייה, השתמשו ב-wp_read_google_doc עם קישור המסמך עצמו (docs.google.com/document/d/…)";
}
function parseGoogleLink(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    fail("הקישור אינו כתובת תקינה");
  }
  if (u.hostname === "drive.google.com")
    fail(
      "קישורי Google Drive אינם נתמכים כאן. פתחו את המסמך ב-Google Docs ושתפו את קישור המסמך (docs.google.com/document/d/…), בהגדרה 'כל מי שיש לו את הקישור ← צופה'.",
    );
  if (
    u.protocol !== "https:" ||
    u.hostname !== "docs.google.com" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    fail(
      "נתמכים רק קישורי docs.google.com של מסמכי Google Docs או Google Sheets",
    );
  const m = /^\/(document|spreadsheets)\/(?:u\/\d+\/)?d\/([^/]+)/.exec(
    u.pathname,
  );
  if (!m || !ID.test(m[2]))
    fail("הקישור אינו קישור למסמך Google Docs או Google Sheets");
  const kind = m[1] === "document" ? "document" : "spreadsheet";
  const gid = /^\d{1,12}$/.test(u.searchParams.get("gid") || "")
    ? u.searchParams.get("gid")
    : /#gid=(\d{1,12})/.exec(u.hash || "")?.[1] || null;
  // A link into one tab of a document (?tab=t.xxx) reads that tab; without it the whole document is exported.
  const tabParam = u.searchParams.get("tab");
  const tab =
    tabParam && /^t\.[A-Za-z0-9]{1,40}$/.test(tabParam) ? tabParam : null;
  const exportUrl =
    kind === "document"
      ? `https://docs.google.com/document/d/${m[2]}/export?format=html${tab ? `&tab=${tab}` : ""}`
      : `https://docs.google.com/spreadsheets/d/${m[2]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
  return { kind, id: m[2], gid, tab, exportUrl };
}
// Redirect targets: https and *.googleusercontent.com only (at least one subdomain label), default port, no credentials.
const googleUserContent = (u) =>
  u.protocol === "https:" &&
  /^(?:[a-z0-9-]+\.)+googleusercontent\.com$/.test(u.hostname) &&
  !u.username &&
  !u.password &&
  (!u.port || u.port === "443");

// Default transport: pinned public address, no cookies, no auth, no redirect following, bounded body.
function httpsGet(url, { address, family, maxBytes, signal }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        agent: false,
        signal,
        headers: {
          Accept: "text/html,text/csv,*/*;q=0.5",
          "Accept-Encoding": "identity",
          "User-Agent": "Mozilla/5.0 ADActive/1.0",
        },
        lookup: (_h, opts, cb) =>
          opts.all
            ? cb(null, [{ address, family }])
            : cb(null, address, family),
      },
      (res) => {
        const chunks = [];
        let length = 0;
        const limit = res.statusCode === 200 ? maxBytes : 8192;
        res.on("data", (c) => {
          length += c.length;
          if (length > limit) {
            res.destroy(Object.assign(new Error("size"), { size: true }));
            return;
          }
          chunks.push(c);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

class GoogleDocs {
  // wp: provides publicTarget(url, signal) (public IPv4 check). deps.get overrides the transport (tests).
  constructor(wp, deps = {}) {
    this.wp = wp;
    this.get = deps.get || httpsGet;
  }
  async read(link, signal) {
    const parsed = parseGoogleLink(link);
    const timeout = AbortSignal.timeout(45000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let url = new URL(parsed.exportUrl);
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const target = await this.wp.publicTarget(url, combined);
      let res;
      try {
        res = await this.get(url, {
          ...target,
          maxBytes: parsed.kind === "document" ? HTML_LIMIT : CSV_LIMIT,
          signal: combined,
        });
      } catch (e) {
        diag.log("docs", {
          hop,
          host: url.hostname,
          ok: false,
          code: e.code,
          name: e.name,
        });
        if (e.size)
          fail("המסמך גדול מדי (מעל 8 MB). חלקו אותו או הדביקו קטעים.");
        fail("לא ניתן להגיע לגוגל כרגע. בדקו את החיבור לאינטרנט ונסו שוב.");
      }
      diag.log("docs", {
        hop,
        host: url.hostname,
        status: res.status,
        ok: res.status === 200,
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers?.location;
        let next;
        try {
          next = new URL(location, url);
        } catch {
          fail("גוגל החזירה הפניה לא תקינה");
        }
        // A redirect to the Google sign-in page means the document is not shared publicly.
        if (
          /^accounts\.google\./.test(next.hostname) ||
          /ServiceLogin|signin|AccountChooser/i.test(
            next.pathname + next.search,
          )
        )
          fail(NOT_PUBLIC);
        if (hop === MAX_HOPS || !googleUserContent(next))
          fail(
            `ההפניה לכתובת לא מורשית נחסמה (${next.protocol}//${next.hostname}). נתמכת רק הפניה ל־googleusercontent.com.`,
          );
        url = next;
        continue;
      }
      if ([401, 403].includes(res.status)) fail(NOT_PUBLIC);
      if (res.status === 404)
        fail("המסמך לא נמצא. בדקו את הקישור (או שהמסמך נמחק).");
      if (res.status === 429)
        fail("גוגל מגבילה כרגע את מספר הבקשות. נסו שוב בעוד דקה.");
      if (res.status !== 200) fail(`גוגל החזירה סטטוס ${res.status}`);
      const body = res.body.toString("utf8");
      const type = String(res.headers?.["content-type"] || "").toLowerCase();
      // 200 with a sign-in page instead of the export.
      if (
        /accounts\.google\.com\/(?:v3\/)?(?:signin|ServiceLogin)|<title>\s*(?:Sign in|כניסה)/i.test(
          body.slice(0, 20000),
        ) &&
        !/class="doc-content"|<body class="c\d+/.test(body.slice(0, 20000))
      )
        fail(NOT_PUBLIC);
      if (parsed.kind === "spreadsheet") {
        if (type.includes("html")) fail(NOT_PUBLIC);
        const rows = parseCsv(body);
        const { blocks, truncated } = capBlocks([
          { t: "table", rows: rows.rows },
        ]);
        return {
          source: "google-sheets",
          id: parsed.id,
          title: "",
          blocks,
          images: [],
          links: [],
          truncated: truncated || rows.truncated,
        };
      }
      if (!type.includes("html") && !/<html/i.test(body.slice(0, 2000)))
        fail("גוגל החזירה תוכן לא צפוי");
      return {
        source: "google-docs",
        id: parsed.id,
        tab: parsed.tab,
        ...htmlToBlocks(body),
      };
    }
    return fail("יותר מדי הפניות");
  }
}

// ---- HTML export -> blocks ------------------------------------------------------------------------------------------------------
const named = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rlm: "",
  lrm: "",
};
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n =
        e[1].toLowerCase() === "x"
          ? parseInt(e.slice(2), 16)
          : Number(e.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : "";
    }
    return Object.hasOwn(named, e.toLowerCase()) ? named[e.toLowerCase()] : m;
  });
const attrOf = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(
    tag,
  );
  return m ? decode(m[1] ?? m[2]) : "";
};
// Google wraps links: https://www.google.com/url?q=REAL&sa=D&... -> REAL. Only http(s) and mailto survive.
function cleanLink(href) {
  let u = href;
  try {
    const parsed = new URL(href);
    if (
      /^(?:www\.)?google\.[a-z.]+$/.test(parsed.hostname) &&
      parsed.pathname === "/url" &&
      parsed.searchParams.get("q")
    )
      u = parsed.searchParams.get("q");
  } catch {
    return "";
  }
  return /^(?:https?:\/\/|mailto:)[^\s<>"']+$/i.test(u) && u.length < 2048
    ? u
    : "";
}
function styleClasses(css) {
  const bold = new Set(),
    italic = new Set();
  for (const m of css.matchAll(/\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g)) {
    if (/font-weight\s*:\s*(?:700|bold)/i.test(m[2])) bold.add(m[1]);
    if (/font-style\s*:\s*italic/i.test(m[2])) italic.add(m[1]);
  }
  return { bold, italic };
}
function htmlToBlocks(html) {
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1])
    .join("\n");
  const { bold, italic } = styleClasses(css);
  const title = decode(
    (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "").replace(
      /<[^>]*>/g,
      "",
    ),
  ).trim();
  const body = html
    .replace(/<head\b[\s\S]*?<\/head>/i, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  const blocks = [],
    images = [],
    links = [];
  let text = "",
    kind = null,
    level = 0; // current text container: p | h | li | cell
  const lists = []; // stack of {ordered}
  let table = null,
    row = null,
    cell = null,
    listBlock = null,
    listDepthItems = null;
  let inLink = null,
    linkText = "";
  const fmt = []; // stack of {bold, italic, tag}
  let dataImages = 0;
  const flush = () => {
    if (inLink !== null) {
      text += linkText.trim() ? `[${linkText.trim()}](${inLink})` : linkText;
      inLink = null;
      linkText = "";
    }
    const t = text
      .replace(/[ \t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim();
    text = "";
    if (!t) {
      kind = null;
      return;
    }
    if (cell) {
      cell.push(t);
    } else if (kind === "h") {
      listBlock = null;
      blocks.push({ t: "h", level, text: t });
    } else if (kind === "li") {
      const cur = lists[lists.length - 1] || { ordered: false };
      if (!listBlock || listBlock.ordered !== cur.ordered) {
        listBlock = { t: "list", ordered: cur.ordered, items: [] };
        blocks.push(listBlock);
      }
      listBlock.items.push({ text: t, level: Math.max(0, lists.length - 1) });
    } else {
      listBlock = null;
      blocks.push({ t: "p", text: t });
    }
    kind = null;
  };
  const add = (s) => {
    if (!s) return;
    const f = fmt[fmt.length - 1];
    let v = s;
    if (f && kind !== "h" && /\S/.test(s)) {
      const lead = /^\s*/.exec(s)[0],
        tail = /\s*$/.exec(s)[0],
        core = s.trim();
      v =
        lead +
        (f.bold && f.italic
          ? `***${core}***`
          : f.bold
            ? `**${core}**`
            : f.italic
              ? `*${core}*`
              : core) +
        tail;
    }
    if (inLink !== null) linkText += v;
    else text += v;
  };
  for (const m of body.matchAll(
    /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g,
  )) {
    if (m[4] !== undefined) {
      if (kind || cell) add(decode(m[4]));
      continue;
    }
    const close = m[1] === "/",
      tag = m[2].toLowerCase(),
      rest = m[3],
      full = `<${tag}${rest}`;
    if (/^h[1-6]$/.test(tag)) {
      if (!close) {
        flush();
        kind = "h";
        level = Number(tag[1]);
      } else flush();
    } else if (tag === "p") {
      const inside = kind === "li" || cell;
      if (!close) {
        if (inside) {
          if (text.trim()) add("\n");
        } else {
          flush();
          const cls = attrOf(full, "class").split(/\s+/);
          kind = cls.includes("title") ? "h" : "p";
          level = 1;
        }
      } else if (!inside) flush();
    } else if (tag === "ul" || tag === "ol") {
      if (!close) {
        flush();
        lists.push({ ordered: tag === "ol" });
      } else {
        flush();
        lists.pop();
        if (!lists.length) listBlock = null;
      }
    } else if (tag === "li") {
      if (!close) {
        flush();
        kind = "li";
      } else flush();
    } else if (tag === "table") {
      if (!close) {
        flush();
        table = [];
      } else if (table) {
        blocks.push({
          t: "table",
          rows: table.slice(0, 500).map((r) => r.slice(0, 30)),
        });
        table = null;
        listBlock = null;
      }
    } else if (tag === "tr") {
      if (!close) row = [];
      else if (table && row) {
        table.push(row);
        row = null;
      }
    } else if (tag === "td" || tag === "th") {
      if (!close) {
        flush();
        cell = [];
      } else if (cell && row) {
        flush();
        row.push(cell.join(" ").replace(/\s+/g, " ").trim());
        cell = null;
      }
    } else if (tag === "a") {
      if (!close) {
        const href = cleanLink(attrOf(full, "href"));
        inLink = href || null;
        linkText = "";
        if (href) links.push(href);
        else inLink = null;
      } else if (inLink !== null) {
        text += linkText.trim() ? `[${linkText.trim()}](${inLink})` : linkText;
        inLink = null;
        linkText = "";
      }
    } else if (tag === "span") {
      if (!close) {
        const cls = attrOf(full, "class").split(/\s+/);
        const prev = fmt[fmt.length - 1] || {};
        fmt.push({
          bold: prev.bold || cls.some((c) => bold.has(c)),
          italic: prev.italic || cls.some((c) => italic.has(c)),
        });
      } else fmt.pop();
    } else if (tag === "b" || tag === "strong") {
      if (!close) fmt.push({ ...(fmt[fmt.length - 1] || {}), bold: true });
      else fmt.pop();
    } else if (tag === "i" || tag === "em") {
      if (!close) fmt.push({ ...(fmt[fmt.length - 1] || {}), italic: true });
      else fmt.pop();
    } else if (tag === "br") {
      if (kind || cell) add("\n");
    } else if (tag === "img" && !close) {
      const src = attrOf(full, "src"),
        alt = attrOf(full, "alt").slice(0, 300);
      if (/^https:\/\/[^\s<>"']+$/.test(src) && src.length < 2048) {
        flush();
        images.push({ url: src, alt });
        blocks.push({ t: "img", url: src, alt });
      } else dataImages++;
    }
  }
  flush();
  const { blocks: capped, truncated } = capBlocks(blocks);
  return {
    title,
    blocks: capped,
    images: images.slice(0, 80),
    links: [...new Set(links)].slice(0, 200),
    truncated,
    ...(dataImages ? { skippedInlineImages: dataImages } : {}),
  };
}

// ---- CSV (Sheets) ----------------------------------------------------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false,
    truncated = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && !field) quoted = true;
    else if (c === ",") {
      row.push(field.slice(0, 500));
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field.slice(0, 500));
      field = "";
      rows.push(row.slice(0, 30));
      row = [];
      if (rows.length >= 500) {
        truncated = true;
        break;
      }
    } else field += c;
  }
  if (!truncated && (field || row.length)) {
    row.push(field.slice(0, 500));
    rows.push(row.slice(0, 30));
  }
  return { rows: rows.filter((r) => r.some((c) => c !== "")), truncated };
}
module.exports = {
  GoogleDocs,
  parseGoogleLink,
  googleDocLink,
  htmlToBlocks,
  parseCsv,
  googleUserContent,
  NOT_PUBLIC,
};
