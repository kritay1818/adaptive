"use strict";
// Document files the user attaches in the chat (.docx .pdf .txt .md, up to 20 MB): type check by magic bytes, then text and
// structure extraction in main. No dependency for zip/docx (a small bounded reader); PDF text uses unpdf (pdf.js).
// Output is a list of blocks, handed to the model as UNTRUSTED content (data, never instructions).
//   {t:"h", level, text} {t:"p", text} {t:"list", ordered, items:[{text, level}]} {t:"table", rows:[[text]]}
//   {t:"img", url?, file?, alt}   (file = a name inside the docx; main turns it into a held fileId)
const zlib = require("node:zlib");

const DOC_LIMIT = 20 * 1024 * 1024;
const MAX_CHARS = 200000; // text kept per document
const IMAGE_LIMIT = 10 * 1024 * 1024;
const fail = (message) => {
  throw new Error(message);
};

// ---- markdown-ish text for the model --------------------------------------------------------------------------------------
function blocksToMarkdown(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.t === "h")
      out.push(`${"#".repeat(Math.min(6, Math.max(1, b.level)))} ${b.text}`);
    else if (b.t === "p") out.push(b.text);
    else if (b.t === "list")
      out.push(
        b.items
          .map(
            (it, i) =>
              `${"  ".repeat(it.level || 0)}${b.ordered ? `${i + 1}.` : "-"} ${it.text}`,
          )
          .join("\n"),
      );
    else if (b.t === "table")
      out.push(b.rows.map((r) => `| ${r.join(" | ")} |`).join("\n"));
    else if (b.t === "img")
      out.push(
        `![${b.alt || ""}](${b.url || (b.fileId ? "fileId:" + b.fileId : b.file || "")})`,
      );
  }
  return out.join("\n\n");
}
// Cap the total text; returns {blocks, truncated}.
function capBlocks(blocks, max = MAX_CHARS) {
  let size = 0;
  const kept = [];
  for (const b of blocks) {
    const len = JSON.stringify(b).length;
    if (size + len > max) return { blocks: kept, truncated: true };
    size += len;
    kept.push(b);
  }
  return { blocks: kept, truncated: false };
}

// ---- minimal bounded ZIP reader (stored + deflate) --------------------------------------------------------------------------
function readZip(
  buf,
  {
    maxEntries = 3000,
    maxTotal = 150 * 1024 * 1024,
    maxEntry = 60 * 1024 * 1024,
  } = {},
) {
  if (
    !Buffer.isBuffer(buf) ||
    buf.length < 22 ||
    buf.readUInt32LE(0) !== 0x04034b50
  )
    fail("הקובץ אינו קובץ ZIP/DOCX תקין");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) fail("מבנה ה־ZIP פגום");
  const count = buf.readUInt16LE(eocd + 10),
    cdSize = buf.readUInt32LE(eocd + 12),
    cdOffset = buf.readUInt32LE(eocd + 16);
  if (count > maxEntries || cdOffset + cdSize > buf.length)
    fail("מבנה ה־ZIP חשוד או פגום");
  const entries = new Map();
  let pos = cdOffset,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50)
      fail("מבנה ה־ZIP פגום");
    const flags = buf.readUInt16LE(pos + 8),
      method = buf.readUInt16LE(pos + 10),
      comp = buf.readUInt32LE(pos + 20),
      size = buf.readUInt32LE(pos + 24);
    const n = buf.readUInt16LE(pos + 28),
      m = buf.readUInt16LE(pos + 30),
      k = buf.readUInt16LE(pos + 32),
      offset = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + n);
    total += size;
    if (total > maxTotal) fail("הקובץ מכיל יותר מדי נתונים אחרי פריסה");
    if (!(flags & 1)) entries.set(name, { method, comp, size, offset });
    pos += 46 + n + m + k;
  }
  const read = (name) => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.size > maxEntry) fail("אחד הרכיבים בקובץ גדול מדי");
    if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50)
      fail("מבנה ה־ZIP פגום");
    const start =
      e.offset +
      30 +
      buf.readUInt16LE(e.offset + 26) +
      buf.readUInt16LE(e.offset + 28);
    const data = buf.subarray(start, start + e.comp);
    if (e.method === 0) return Buffer.from(data);
    if (e.method === 8) {
      try {
        return zlib.inflateRawSync(data, {
          maxOutputLength: Math.min(e.size + 1, maxEntry),
        });
      } catch {
        fail("רכיב בקובץ אינו ניתן לפריסה (פגום או חשוד)");
      }
    }
    return fail("שיטת דחיסה לא נתמכת בקובץ");
  };
  return { has: (n) => entries.has(n), names: () => [...entries.keys()], read };
}

// ---- .docx --------------------------------------------------------------------------------------------------------------------
const ent = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (named[e.toLowerCase()]) return named[e.toLowerCase()];
    const n =
      e[1].toLowerCase() === "x"
        ? parseInt(e.slice(2), 16)
        : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
      ? String.fromCodePoint(n)
      : "";
  });
const attr = (tag, name) => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return m ? ent(m[1]) : "";
};
const on = (tag) => !/w:val="(?:0|false|off|none)"/.test(tag);
function docxMaps(zip) {
  const rels = new Map();
  const relsXml = zip.read("word/_rels/document.xml.rels");
  if (relsXml)
    for (const m of relsXml
      .toString("utf8")
      .matchAll(/<Relationship\b[^>]*>/g)) {
      const t = m[0],
        id = attr(t, "Id"),
        target = attr(t, "Target");
      if (id && target)
        rels.set(id, { target, external: /TargetMode="External"/.test(t) });
    }
  const styles = new Map();
  const stylesXml = zip.read("word/styles.xml");
  if (stylesXml)
    for (const m of stylesXml
      .toString("utf8")
      .matchAll(
        /<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>[\s\S]*?<w:name w:val="([^"]+)"/g,
      ))
      styles.set(m[1], m[2].toLowerCase());
  const numFmt = new Map(); // numId -> Map(ilvl -> fmt)
  const numXml = zip.read("word/numbering.xml");
  if (numXml) {
    const xml = numXml.toString("utf8");
    const abstract = new Map();
    for (const m of xml.matchAll(
      /<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g,
    )) {
      const levels = new Map();
      for (const l of m[2].matchAll(
        /<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>[\s\S]*?<w:numFmt w:val="([^"]+)"/g,
      ))
        levels.set(Number(l[1]), l[2]);
      abstract.set(m[1], levels);
    }
    for (const m of xml.matchAll(
      /<w:num\b[^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/g,
    ))
      numFmt.set(m[1], abstract.get(m[2]) || new Map());
  }
  return { rels, styles, numFmt };
}
function extractDocx(buf) {
  const zip = readZip(buf);
  const documentXml = zip.read("word/document.xml");
  if (!documentXml) fail("הקובץ אינו מסמך Word תקין (חסר word/document.xml)");
  const { rels, styles, numFmt } = docxMaps(zip);
  const xml = documentXml.toString("utf8");
  const blocks = [],
    images = [];
  const imageName = (rid) => {
    const r = rels.get(rid);
    if (!r || r.external || !/^media\//i.test(r.target)) return null;
    return "word/" + r.target.replace(/^\/+/, "");
  };
  let para = null,
    cell = null,
    row = null,
    table = null,
    listBlock = null;
  const flushList = () => {
    listBlock = null;
  };
  const startPara = () => {
    para = { text: "", style: "", numId: null, ilvl: 0, imgs: [] };
  };
  let bold = false,
    italic = false,
    link = null,
    linkText = "",
    inRun = false;
  const emit = (text) => {
    if (!para) return;
    let t = text;
    if (link) {
      linkText += t;
      return;
    }
    if (bold && italic && t.trim())
      t = `***${t.trim()}***${/\s$/.test(t) ? " " : ""}`;
    else if (bold && t.trim()) t = `**${t.trim()}**${/\s$/.test(t) ? " " : ""}`;
    else if (italic && t.trim()) t = `*${t.trim()}*${/\s$/.test(t) ? " " : ""}`;
    para.text += t;
  };
  const closeLink = () => {
    if (link && linkText.trim()) para.text += `[${linkText.trim()}](${link})`;
    else if (link) para.text += linkText;
    link = null;
    linkText = "";
  };
  const endPara = () => {
    if (!para) return;
    closeLink();
    const text = para.text
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ ]+/g, "\n")
      .trim();
    const p = para;
    para = null;
    if (cell) {
      cell.push(text);
      for (const f of p.imgs) images.push(f);
      return;
    }
    const imgBlocks = p.imgs.map((file) => ({ t: "img", file, alt: "" }));
    const name = styles.get(p.style) || p.style.toLowerCase();
    const h = /^heading\s*(\d)$/.exec(name) || /^(?:כותרת)\s*(\d)$/.exec(name);
    if (text && (h || name === "title")) {
      flushList();
      blocks.push({ t: "h", level: h ? Number(h[1]) : 1, text });
    } else if (text && p.numId !== null && p.numId !== "0") {
      const fmt = numFmt.get(p.numId)?.get(p.ilvl);
      const ordered = !!fmt && !["bullet", "none"].includes(fmt);
      if (!listBlock || listBlock.numId !== p.numId) {
        listBlock = { t: "list", ordered, items: [], numId: p.numId };
        blocks.push(listBlock);
      }
      listBlock.items.push({ text, level: p.ilvl });
    } else if (text) {
      flushList();
      blocks.push({ t: "p", text });
    }
    for (const b of imgBlocks) {
      flushList();
      blocks.push(b);
    }
  };
  for (const m of xml.matchAll(
    /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<(\/?)(w:[A-Za-z]+|a:blip|v:imagedata)\b([^>]*?)(\/?)>/g,
  )) {
    if (m[1] !== undefined) {
      emit(ent(m[1]));
      continue;
    }
    const [, , close, name, rest, selfClose] = m;
    const tag = `<${name} ${rest}`;
    switch (name) {
      case "w:p":
        if (!close) {
          endPara();
          startPara();
        } else endPara();
        break;
      case "w:pStyle":
        if (para) para.style = attr(tag, "w:val");
        break;
      case "w:ilvl":
        if (para) para.ilvl = Number(attr(tag, "w:val")) || 0;
        break;
      case "w:numId":
        if (para) para.numId = attr(tag, "w:val");
        break;
      case "w:r":
        if (!close) {
          inRun = !selfClose;
          bold = false;
          italic = false;
        } else {
          inRun = false;
        }
        break;
      case "w:b":
        if (inRun) bold = on(tag);
        break;
      case "w:i":
        if (inRun) italic = on(tag);
        break;
      case "w:tab":
        emit(" ");
        break;
      case "w:br":
      case "w:cr":
        emit("\n");
        break;
      case "w:hyperlink":
        if (!close && !selfClose) {
          const r = rels.get(attr(tag, "r:id"));
          link =
            r?.external && /^(?:https?:|mailto:)/i.test(r.target)
              ? r.target
              : null;
          linkText = "";
        } else if (close) closeLink();
        break;
      case "a:blip":
      case "v:imagedata": {
        const file = imageName(attr(tag, "r:embed") || attr(tag, "r:id"));
        if (file && para) para.imgs.push(file);
        break;
      }
      case "w:tbl":
        if (!close) {
          endPara();
          flushList();
          table = [];
        } else if (table) {
          blocks.push({ t: "table", rows: table });
          table = null;
        }
        break;
      case "w:tr":
        if (!close) row = [];
        else if (table && row) {
          table.push(row);
          row = null;
        }
        break;
      case "w:tc":
        if (!close) cell = [];
        else if (cell && row) {
          row.push(cell.filter(Boolean).join(" ").trim());
          cell = null;
        }
        break;
      default:
        break;
    }
  }
  endPara();
  // Images: bytes checked by magic and bounded; unsupported formats (emf/wmf/svg) are dropped.
  const found = new Map();
  for (const b of blocks) if (b.t === "img") found.set(b.file, null);
  for (const file of found.keys()) {
    let bytes = null;
    try {
      bytes = zip.read(file);
    } catch {
      bytes = null;
    }
    const mime =
      bytes && bytes.length <= IMAGE_LIMIT ? sniffRaster(bytes) : null;
    if (mime && found.size <= 60)
      found.set(file, { name: file.split("/").pop(), mime, bytes });
  }
  const usable = [];
  const outBlocks = blocks.filter((b) => b.t !== "img" || found.get(b.file));
  for (const b of outBlocks)
    if (b.t === "img" && !usable.includes(b.file)) usable.push(b.file);
  for (const b of outBlocks) if (b.t === "list") delete b.numId;
  const { blocks: capped, truncated } = capBlocks(outBlocks);
  return {
    format: "docx",
    blocks: capped,
    truncated,
    images: usable.map((f) => found.get(f)),
    imageFiles: usable,
  };
}
function sniffRaster(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6)))
    return "image/gif";
  return null;
}

// ---- .pdf (unpdf / pdf.js; text only) ---------------------------------------------------------------------------------------
async function extractPdf(buf) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const work = (async () => {
    const doc = await getDocumentProxy(new Uint8Array(buf), {
      isEvalSupported: false,
    });
    const pages = Math.min(doc.numPages, 100);
    const { text } = await extractText(doc, { mergePages: false });
    return {
      pages,
      total: doc.numPages,
      text: (Array.isArray(text) ? text : [text]).slice(0, pages),
    };
  })();
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("קריאת ה־PDF ארכה יותר מדי")),
      30000,
    );
  });
  let out;
  try {
    out = await Promise.race([work, guard]);
  } catch (e) {
    fail(
      /ארכה/.test(e.message)
        ? e.message
        : "לא ניתן לקרוא את ה־PDF (פגום, מוגן בסיסמה או בפורמט לא נתמך)",
    );
  } finally {
    clearTimeout(timer);
  }
  const blocks = [];
  out.text.forEach((pageText, i) => {
    for (const para of String(pageText)
      .replace(/\r\n?/g, "\n")
      .split(/\n{2,}/)) {
      const text = para
        .replace(/[ \t]+/g, " ")
        .replace(/\n+/g, "\n")
        .trim();
      if (text) blocks.push({ t: "p", text });
    }
  });
  if (!blocks.length) fail("לא נמצא טקסט ב־PDF (ייתכן שהוא סרוק כתמונה)");
  const { blocks: capped, truncated } = capBlocks(blocks);
  return {
    format: "pdf",
    blocks: capped,
    truncated: truncated || out.total > out.pages,
    pages: out.total,
    images: [],
    imageFiles: [],
  };
}

// ---- .txt / .md ----------------------------------------------------------------------------------------------------------------
function decodeText(buf) {
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe)
    text = buf.subarray(2).toString("utf16le");
  else if (buf[0] === 0xfe && buf[1] === 0xff)
    text = Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        buf.subarray(
          buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0,
        ),
      );
    } catch {
      return null;
    }
  }
  return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) ? null : text;
}
function markdownBlocks(text) {
  const blocks = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let para = [],
    list = null,
    table = null;
  const flush = () => {
    if (para.length) blocks.push({ t: "p", text: para.join("\n") });
    para = [];
  };
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line),
      li = /^(\s*)(?:([-*+•])|(\d{1,3})[.)])\s+(.*)$/.exec(line),
      row = /^\s*\|(.+)\|\s*$/.exec(line);
    if (row) {
      flush();
      list = null;
      if (/^[\s|:-]+$/.test(row[1])) continue;
      if (!table) blocks.push((table = { t: "table", rows: [] }));
      table.rows.push(row[1].split("|").map((c) => c.trim()));
      continue;
    }
    table = null;
    if (h) {
      flush();
      list = null;
      blocks.push({ t: "h", level: h[1].length, text: h[2] });
    } else if (li) {
      flush();
      const ordered = !!li[3];
      if (!list || list.ordered !== ordered)
        blocks.push((list = { t: "list", ordered, items: [] }));
      list.items.push({ text: li[4], level: Math.floor(li[1].length / 2) });
    } else if (!line.trim()) {
      flush();
      list = null;
    } else {
      list = null;
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}
function extractTextFile(buf, kind) {
  const text = decodeText(buf);
  if (text === null)
    fail("הקובץ אינו קובץ טקסט תקין (UTF-8/UTF-16 ללא תווי בקרה)");
  const blocks =
    kind === "md"
      ? markdownBlocks(text)
      : text
          .replace(/\r\n?/g, "\n")
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => ({ t: "p", text: p }));
  if (!blocks.length) fail("הקובץ ריק");
  const { blocks: capped, truncated } = capBlocks(blocks);
  return {
    format: kind,
    blocks: capped,
    truncated,
    images: [],
    imageFiles: [],
  };
}

// ---- type by magic bytes (the extension must agree) --------------------------------------------------------------------------
function detectDocument(buf, filename) {
  const ext = /\.([A-Za-z0-9]+)$/
    .exec(String(filename || ""))?.[1]
    ?.toLowerCase();
  if (!Buffer.isBuffer(buf) || !buf.length || buf.length > DOC_LIMIT)
    return null;
  const pdf = buf.subarray(0, 1024).toString("latin1").includes("%PDF-");
  const zip = buf.readUInt32LE(0) === 0x04034b50;
  if (ext === "pdf") return pdf ? "pdf" : null;
  if (ext === "docx") {
    if (!zip) return null;
    try {
      return readZip(buf).has("word/document.xml") ? "docx" : null;
    } catch {
      return null;
    }
  }
  if (ext === "txt" || ext === "md" || ext === "markdown")
    return pdf || zip || decodeText(buf) === null
      ? null
      : ext === "txt"
        ? "txt"
        : "md";
  return null;
}
async function extractDocument(buf, filename) {
  const kind = detectDocument(buf, filename);
  if (!kind)
    fail(
      "סוג הקובץ אינו נתמך או שתוכנו אינו תואם לסיומת (מותר DOCX, PDF, TXT, MD)",
    );
  if (kind === "docx") return extractDocx(buf);
  if (kind === "pdf") return extractPdf(buf);
  return extractTextFile(buf, kind);
}
module.exports = {
  DOC_LIMIT,
  blocksToMarkdown,
  capBlocks,
  readZip,
  extractDocx,
  extractPdf,
  extractTextFile,
  detectDocument,
  extractDocument,
  markdownBlocks,
  sniffRaster,
};
