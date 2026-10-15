"use strict";
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const dns = require("node:dns").promises;
const net = require("node:net");
const { randomUUID, createHash } = require("node:crypto");
const { atomic, text } = require("./core.cjs");
// Conservative IPv4-only transport: deny all IPv6 rather than risk mapped,
// transition, scoped, or newly reserved IPv6 ranges. No proxy or redirect support.
function publicAddress(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
function siteURL(value) {
  text(value, 2048);
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error("כתובת האתר אינה תקינה");
  }
  if (
    !value.startsWith("https://") ||
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    value.slice(8).split("/")[0].includes("@") ||
    u.search ||
    u.hash ||
    value.includes("?") ||
    value.includes("#") ||
    /[\\\s]/.test(value) ||
    (u.port && u.port !== "443") ||
    u.hostname.endsWith(".") ||
    !u.hostname.includes(".") ||
    (net.isIP(u.hostname) && !publicAddress(u.hostname))
  )
    throw new Error(
      "נדרשת כתובת HTTPS ציבורית ללא פרטי כניסה, פרמטרים או הפניות",
    );
  u.pathname = u.pathname.replace(/\/+$/, "") + "/";
  return u;
}
function request(
  url,
  { address, family, authorization, signal, method = "GET", body,
    contentType = "application/json", binary = false, maxBytes = 262144,
    acceptedStatuses = [200, 201] },
) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        agent: false,
        signal,
        headers: {
          ...(authorization ? { Authorization: authorization } : {}),
          Accept: binary ? "image/jpeg,image/png,image/webp,image/gif" : "application/json",
          ...(body
            ? {
                "Content-Type": contentType,
                "Content-Length": Buffer.byteLength(body),
              }
            : {}),
          "Accept-Encoding": "identity",
        },
        lookup: (_host, opts, cb) => {
          if (opts.all) cb(null, [{ address, family }]);
          else cb(null, address, family);
        },
      },
      (res) => {
        let length = 0;
        const chunks = [];
        // Node HTTPS never follows Location; do not consume redirect/error payloads.
        if (!acceptedStatuses.includes(res.statusCode) || (res.statusCode >= 300 && res.statusCode < 400)) {
          resolve({ status: res.statusCode, body: "" });
          res.destroy();
          return;
        }
        res.on("data", (chunk) => {
          length += chunk.length;
          if (length > maxBytes) {
            res.destroy(new Error("size"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            contentType: res.headers?.["content-type"] || "",
            body: binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
const IMAGE_LIMIT = 10 * 1024 * 1024;
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
function imageURL(value) {
  text(value, 2048);
  let url;
  try { url = new URL(value); } catch { throw new Error("כתובת תמונה אינה תקינה"); }
  // Reuse the site URL policy, but image query strings are allowed (e.g. CDN sizing).
  siteURL(url.origin);
  if (!value.startsWith("https://") || url.username || url.password || value.includes("#") || value.slice(8).split(/[/?#]/)[0].includes("@") || /[\\\s\x00-\x1f]/.test(value))
    throw new Error("נדרשת כתובת תמונה ציבורית ב־HTTPS ללא פרטי כניסה");
  return url;
}
function imageType(bytes, mime) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > IMAGE_LIMIT || !Object.hasOwn(IMAGE_TYPES, mime))
    throw new Error("מותרות תמונות JPEG, PNG, WebP או GIF בלבד, עד 10 MB. SVG אינו מורשה.");
  const valid = mime === "image/jpeg" ? bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mime === "image/png" ? bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString("ascii", 12, 16) === "IHDR"
    : mime === "image/webp" ? bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
    : bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
  if (!valid) throw new Error("תוכן הקובץ אינו תואם לסוג התמונה");
}
function imageFields({ url, fileName, alt }) {
  imageURL(url);
  text(fileName, 120);
  text(alt, 1000);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.(?:jpe?g|png|webp|gif)$/i.test(fileName) || /[<>\x00-\x1f\x7f]/.test(alt))
    throw new Error("נדרשים שם קובץ בטוח עם סיומת תמונה וטקסט חלופי ללא HTML");
}
const imageDigest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function mediaSummary(m) {
  if (!Number.isSafeInteger(m?.id) || m.id <= 0 || m.media_type !== "image" ||
      !Object.hasOwn(IMAGE_TYPES, m.mime_type) || typeof m.title?.raw !== "string" ||
      typeof m.alt_text !== "string" || typeof m.source_url !== "string" ||
      m.title.raw.length > 1000 || m.alt_text.length > 1000)
    throw new Error("נתוני תמונה לא תקינים");
  const source = imageURL(m.source_url).href;
  let original = source;
  // WordPress may scale large images; verify the retained original bytes.
  const originalName = m.media_details?.original_image;
  if (originalName !== undefined) {
    if (typeof originalName !== "string" || !/^[a-zA-Z0-9_.-]+\.(?:jpe?g|png|webp|gif)$/i.test(originalName))
      throw new Error("שם תמונה מקורית אינו תקין");
    original = imageURL(new URL(originalName, source).href).href;
  }
  return { id: m.id, title: m.title.raw, alt: m.alt_text, mime: m.mime_type,
    source, original, status: m.status, modified: typeof m.modified === "string" ? m.modified.slice(0, 40) : "" };
}
class WordPress {
  constructor(dir, storage, deps = {}) {
    this.file = path.join(dir, "wordpress-connections.json");
    this.storage = storage;
    this.lookup =
      deps.lookup ||
      ((host) => dns.lookup(host, { all: true, verbatim: true, family: 4 }));
    this.request = deps.request || request;
    this.busy = new Set();
    this.data = {};
    if (fs.existsSync(this.file))
      this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
  }
  secure() {
    return (
      this.storage.isEncryptionAvailable() &&
      (!this.storage.getSelectedStorageBackend ||
        this.storage.getSelectedStorageBackend() !== "basic_text")
    );
  }
  status(id) {
    let value;
    if (this.secure() && this.data[id]) {
      try {
        value = JSON.parse(
          this.storage.decryptString(Buffer.from(this.data[id], "base64")),
        );
      } catch {}
    }
    return {
      connected: !!value,
      site: value?.site || null,
      verifiedAt: value?.verifiedAt || null,
      capabilities: value?.capabilities || null,
      encryptionAvailable: this.secure(),
    };
  }
  async connect(id, { site, username, password }) {
    if (this.busy.has(id)) throw new Error("בדיקת חיבור עדיין מתבצעת");
    if (!this.secure())
      throw new Error("הצפנה מאובטחת אינה זמינה. הסיסמה לא תישמר ולא תישלח.");
    const url = siteURL(site);
    text(username, 256);
    text(password, 512);
    if (
      !username.trim() ||
      /[:\r\n\x00-\x1f]/.test(username) ||
      !password.trim() ||
      /[\r\n\x00-\x1f]/.test(password)
    )
      throw new Error("יש להזין שם משתמש ו־Application Password תקינים");
    this.busy.add(id);
    try {
      const signal = AbortSignal.timeout(15000);
      const addresses = await new Promise((resolve, reject) => {
        const abort = () => reject(new Error("timeout"));
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve(this.lookup(url.hostname))
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", abort));
      });
      if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
        throw new Error("target");
      // WordPress's query route also works without pretty permalinks/rewrite rules.
      // Keep the installation base and use the same vetted, pinned HTTPS target.
      const endpoint = new URL("index.php", url);
      endpoint.searchParams.set("rest_route", "/wp/v2/users/me");
      endpoint.searchParams.set("context", "edit");
      const result = await this.request(endpoint, {
        ...addresses[0],
        method: "GET",
        authorization:
          "Basic " + Buffer.from(username + ":" + password).toString("base64"),
        signal,
      });
      if (result.status >= 300 && result.status < 400)
        throw new Error("redirect");
      if (result.status === 401 || result.status === 403)
        throw new Error("auth");
      if (result.status !== 200 || Buffer.byteLength(result.body) > 262144)
        throw new Error("response");
      if (
        /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(
          result.contentType || "",
        ) ||
        /^\s*</.test(result.body)
      )
        throw new Error("non-rest");
      const user = JSON.parse(result.body);
      if (!Number.isSafeInteger(user.id) || user.id <= 0)
        throw new Error("response");
      const encrypted = this.storage
        .encryptString(
          JSON.stringify({
            site: url.href,
            capabilities: reportedCapabilities(user),
            username,
            password,
            verifiedAt: new Date().toISOString(),
          }),
        )
        .toString("base64");
      const next = { ...this.data, [id]: encrypted };
      atomic(this.file, next);
      this.data = next;
      return this.status(id);
    } catch (e) {
      const errors = {
        auth: "האימות נכשל. בדקו שם משתמש, Application Password והרשאות REST.",
        "non-rest":
          "האתר החזיר דף אינטרנט במקום תשובת WordPress. בדקו שזו כתובת התקנת WordPress ושגישה לממשק האתר אינה חסומה. החיבור הקודם לא הוחלף.",
        redirect:
          "האתר הפנה לכתובת אחרת. מטעמי אבטחה לא נשלחו פרטים ליעד ההפניה; הזינו את כתובת האתר הסופית.",
        target:
          "הכתובת אינה יעד אינטרנט ציבורי נתמך. כתובות פרטיות ו־IPv6 חסומות.",
      };
      throw new Error(
        errors[e.message] ||
          "בדיקת WordPress נכשלה. בדקו כתובת, REST API וחיבור רשת (עד 15 שניות). החיבור הקודם לא הוחלף.",
      );
    } finally {
      this.busy.delete(id);
    }
  }
  // Internal scoped REST capability: never receives an arbitrary URL or route.
  async pageRequest(
    id,
    pageId,
    payload,
    query = {},
    signal,
    resource = "pages",
  ) {
    if (
      !["pages", "posts", "media", "settings", "users/me"].includes(resource) ||
      (payload !== undefined && !["pages", "posts"].includes(resource))
    )
      throw new Error("משאב WordPress אינו מורשה");
    if (!this.secure() || !this.data[id])
      throw new Error("אין חיבור WordPress מאובטח לפרויקט");
    if (pageId !== null && (!Number.isSafeInteger(pageId) || pageId <= 0))
      throw new Error("מזהה עמוד לא תקין");
    const write = payload !== undefined;
    if (
      write &&
      (!payload ||
        Object.keys(payload).some(
          (k) => !["title", "content", "status"].includes(k),
        ) ||
        (payload.status !== undefined &&
          !["draft", "trash"].includes(payload.status)))
    )
      throw new Error("פעולת WordPress אינה מורשית");
    if (
      Object.keys(query).some(
        (k) => !["search", "page", "per_page"].includes(k),
      )
    )
      throw new Error("שאילתה אינה מורשית");
    const deadline = AbortSignal.timeout(15000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      const credential = JSON.parse(
        this.storage.decryptString(Buffer.from(this.data[id], "base64")),
      );
      const base = siteURL(credential.site);
      const addresses = await new Promise((resolve, reject) => {
        const abort = () => reject(new Error("timeout"));
        combined.addEventListener("abort", abort, { once: true });
        if (combined.aborted) return abort();
        Promise.resolve(this.lookup(base.hostname))
          .then(resolve, reject)
          .finally(() => combined.removeEventListener("abort", abort));
      });
      if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
        throw new Error("target");
      combined.throwIfAborted();
      const url = new URL("index.php", base);
      url.searchParams.set(
        "rest_route",
        "/wp/v2/" + resource + (pageId === null ? "" : "/" + pageId),
      );
      url.searchParams.set("context", "edit");
      for (const [k, v] of Object.entries(query))
        url.searchParams.set(k, String(v));
      const result = await this.request(url, {
        ...addresses[0],
        authorization:
          "Basic " +
          Buffer.from(credential.username + ":" + credential.password).toString(
            "base64",
          ),
        method: write ? "POST" : "GET",
        ...(write ? { body: JSON.stringify(payload) } : {}),
        signal: combined,
      });
      if (
        ![200, 201].includes(result.status) ||
        typeof result.body !== "string" ||
        Buffer.byteLength(result.body) > 262144 ||
        /^(?:text\/html|application\/xhtml)/i.test(result.contentType || "")
      )
        throw new Error("response");
      return JSON.parse(result.body);
    } catch {
      // Never reflect transport errors, server payloads, Authorization or credentials.
      throw new Error(
        write
          ? "תוצאת הכתיבה אינה ידועה. אין ניסיון חוזר אוטומטי; בדקו באתר לפני פעולה נוספת."
          : "קריאת WordPress נכשלה (רשת, הרשאות, הפניה או תשובה לא תקינה).",
      );
    }
  }
  async pages(id, query = {}, signal, resource = "pages") {
    const result = await this.pageRequest(
      id,
      null,
      undefined,
      { per_page: 20, page: 1, ...query },
      signal,
      resource,
    );
    if (!Array.isArray(result) || result.length > 100)
      throw new Error("רשימת עמודים לא תקינה");
    return result.map(pageSummary);
  }
  async page(id, pageId, signal, resource = "pages") {
    const result = pageSummary(
      await this.pageRequest(id, pageId, undefined, {}, signal, resource),
    );
    if (result.id !== pageId) throw new Error("האתר החזיר עמוד אחר");
    return result;
  }
  async publicTarget(url, signal) {
    signal.throwIfAborted();
    const addresses = await new Promise((resolve, reject) => {
      const abort = () => reject(new Error("timeout"));
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(this.lookup(url.hostname)).then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some((a) => a.family !== 4 || !publicAddress(a.address)))
      throw new Error("הכתובת אינה יעד IPv4 ציבורי מורשה");
    return addresses[0];
  }
  async downloadImage(value, signal) {
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
    try {
      const url = imageURL(value);
      const target = await this.publicTarget(url, combined);
      // No WordPress Authorization, cookies or redirect following on image hosts.
      const result = await this.request(url, { ...target, signal: combined, method: "GET", binary: true, maxBytes: IMAGE_LIMIT });
      combined.throwIfAborted();
      const mime = (result.contentType || "").split(";")[0].trim().toLowerCase();
      if (result.status !== 200) throw new Error("response");
      imageType(result.body, mime);
      return { bytes: result.body, mime, sha256: imageDigest(result.body) };
    } catch {
      throw new Error("הורדת התמונה נכשלה. נדרשת תמונת JPEG/PNG/WebP/GIF ציבורית ב־HTTPS, ללא הפניה, עד 10 MB (ללא SVG).");
    }
  }
  async mediaRequest(id, mediaId, method, signal, upload) {
    if (!this.secure() || !this.data[id] || !["GET", "POST", "DELETE"].includes(method) ||
        (method === "POST" ? mediaId !== null : !Number.isSafeInteger(mediaId) || mediaId <= 0))
      throw new Error("פעולת מדיה אינה מורשית");
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
    try {
      const credential = JSON.parse(this.storage.decryptString(Buffer.from(this.data[id], "base64")));
      const base = siteURL(credential.site);
      const target = await this.publicTarget(base, combined);
      const url = new URL("index.php", base);
      url.searchParams.set("rest_route", "/wp/v2/media" + (mediaId === null ? "" : "/" + mediaId));
      url.searchParams.set("context", "edit");
      if (method === "DELETE") url.searchParams.set("force", "true");
      const result = await this.request(url, {
        ...target, method, signal: combined,
        authorization: "Basic " + Buffer.from(credential.username + ":" + credential.password).toString("base64"),
        ...(upload ? { body: upload.body, contentType: upload.contentType } : {}),
        acceptedStatuses: method === "GET" ? [200, 404] : [200, 201],
      });
      combined.throwIfAborted();
      if (typeof result.body !== "string" || Buffer.byteLength(result.body) > 262144 ||
          /^(?:text\/html|application\/xhtml)/i.test(result.contentType || "")) throw new Error("response");
      const data = JSON.parse(result.body);
      if (method === "GET" && result.status === 404 && data?.code === "rest_post_invalid_id" && data?.data?.status === 404)
        return null;
      if ((method === "GET" ? result.status !== 200 : ![200, 201].includes(result.status)) ||
          !data || typeof data !== "object" || Array.isArray(data)) throw new Error("response");
      return data;
    } catch {
      throw new Error(method === "GET" ? "קריאת המדיה נכשלה; אין אימות לתוצאה." : "תוצאת שינוי המדיה אינה ידועה. אין ניסיון חוזר אוטומטי.");
    }
  }
  async mediaItem(id, mediaId, signal) {
    const data = await this.mediaRequest(id, mediaId, "GET", signal);
    if (!data) return null;
    const item = mediaSummary(data);
    if (item.id !== mediaId) throw new Error("האתר החזיר פריט מדיה אחר");
    return item;
  }
  async uploadImage(id, image, fields, signal) {
    imageFields(fields);
    imageType(image.bytes, image.mime);
    const extension = fields.fileName.split(".").pop().toLowerCase().replace("jpeg", "jpg");
    if (extension !== IMAGE_TYPES[image.mime]) throw new Error("סיומת הקובץ אינה תואמת לתמונה");
    const boundary = "ADActive" + randomUUID().replaceAll("-", "");
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="alt_text"\r\n\r\n${fields.alt}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${fields.fileName}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fields.fileName}"\r\nContent-Type: ${image.mime}\r\n\r\n`),
      image.bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return mediaSummary(await this.mediaRequest(id, null, "POST", signal, { body, contentType: `multipart/form-data; boundary=${boundary}` }));
  }
  async deleteMedia(id, mediaId, signal) {
    const result = await this.mediaRequest(id, mediaId, "DELETE", signal);
    if (result?.deleted !== true || result.previous?.id !== mediaId)
      throw new Error("מחיקת המדיה לא אומתה");
  }
  async capabilities(id, signal) {
    return reportedCapabilities(
      await this.pageRequest(id, null, undefined, {}, signal, "users/me"),
    );
  }
  async media(id, query = {}, signal) {
    const data = await this.pageRequest(
      id,
      null,
      undefined,
      { per_page: 20, page: 1, ...query },
      signal,
      "media",
    );
    if (!Array.isArray(data) || data.length > 100)
      throw new Error("רשימת מדיה לא תקינה");
    return data.map((m) => {
      if (!Number.isSafeInteger(m.id) || m.id <= 0)
        throw new Error("מדיה לא תקינה");
      return {
        id: m.id,
        title:
          typeof m.title?.rendered === "string"
            ? m.title.rendered.slice(0, 300)
            : "",
        type:
          typeof m.media_type === "string" ? m.media_type.slice(0, 100) : "",
        source:
          typeof m.source_url === "string" ? m.source_url.slice(0, 2048) : "",
        alt: typeof m.alt_text === "string" ? m.alt_text.slice(0, 1000) : "",
        mime: typeof m.mime_type === "string" ? m.mime_type.slice(0, 100) : "",
      };
    });
  }
  async settings(id, signal) {
    const data = await this.pageRequest(
      id,
      null,
      undefined,
      {},
      signal,
      "settings",
    );
    const result = {};
    for (const key of [
      "title",
      "description",
      "timezone",
      "date_format",
      "time_format",
      "start_of_week",
      "language",
      "use_smilies",
      "default_category",
      "default_post_format",
      "posts_per_page",
    ])
      if (["string", "number", "boolean"].includes(typeof data?.[key]))
        result[key] = data[key];
    return result;
  }
  disconnect(id) {
    if (this.busy.has(id)) throw new Error("יש להמתין לסיום הבדיקה");
    const next = { ...this.data };
    delete next[id];
    atomic(this.file, next);
    this.data = next;
    return this.status(id);
  }
}
function reportedCapabilities(user) {
  const result = {};
  for (const key of [
    "edit_pages",
    "edit_published_pages",
    "publish_pages",
    "edit_others_pages",
    "edit_posts",
    "edit_published_posts",
    "publish_posts",
    "edit_others_posts",
    "upload_files",
    "manage_options",
  ])
    result[key] = user?.capabilities?.[key] === true;
  return result;
}
function pageSummary(p) {
  if (
    !Number.isSafeInteger(p?.id) ||
    p.id <= 0 ||
    !["draft", "publish", "pending", "private", "future", "trash"].includes(
      p.status,
    ) ||
    typeof p.title?.raw !== "string" ||
    typeof p.content?.raw !== "string" ||
    p.content.raw.length > 100000
  )
    throw new Error("נתוני עמוד לא תקינים או ארוכים מדי");
  return {
    id: p.id,
    status: p.status,
    title: p.title.raw,
    content: p.content.raw,
    modified: typeof p.modified === "string" ? p.modified : "",
  };
}
module.exports = { WordPress, siteURL, publicAddress, request, imageURL, imageFields, imageType };
