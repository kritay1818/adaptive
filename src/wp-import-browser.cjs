"use strict";
const https = require("node:https");
const net = require("node:net");
const { randomUUID } = require("node:crypto");
const { imageURL } = require("./wordpress.cjs");

// Executed in an isolated world with no preload, Node, or application bridge.
// Extract data, never source HTML, source scripts, handlers, or instructions.
function extractRenderedPage() {
  const clip = (value, max = 600) => String(value || "").trim().slice(0, max);
  const url = (value) => {
    try { const u = new URL(value, location.href); u.hash = ""; return u.protocol === "https:" && !u.username && !u.password && u.href.length <= 2048 ? u.href : ""; } catch { return ""; }
  };
  const visible = (el) => { const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0" && !el.closest('[hidden],[aria-hidden="true"]'); };
  const images = [], links = [], sections = [];
  const imageKeys = new Set(), linkKeys = new Set();
  let imageChars = 0, linkChars = 0;
  const addImage = (src, alt) => { src = url(src); if (src && !imageKeys.has(src) && images.length < 40 && imageChars + src.length < 10000) { imageChars += src.length; imageKeys.add(src); images.push({ url: src, alt: clip(alt, 300) }); } };
  let visited = 0, chars = 0, truncated = false;
  const walk = (el, depth, parent) => {
    if (++visited > 2500 || sections.length >= 100 || chars > 18000) { truncated = true; return; }
    if (depth > 24 || !visible(el) || ["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "TEXTAREA", "SELECT", "SVG", "CANVAS"].includes(el.tagName)) return;
    const style = getComputedStyle(el), rect = el.getBoundingClientRect();
    if (el.tagName === "IMG") addImage(el.currentSrc || el.src, el.alt);
    for (const match of style.backgroundImage.matchAll(/url\(["']?(.*?)["']?\)/g)) addImage(match[1], "");
    if (el.tagName === "A") {
      const href = url(el.href), label = clip(el.innerText, 200);
      if (href && label && !linkKeys.has(href) && links.length < 80 && linkChars + href.length < 10000) {
        linkChars += href.length; linkKeys.add(href); links.push({ url: href, label, navigation: !!el.closest('nav,header,[role="navigation"]') });
      }
    }
    const semantic = /^(H[1-6]|P|LI|BLOCKQUOTE|A|BUTTON|IMG|SECTION|ARTICLE|HEADER|FOOTER|MAIN|NAV)$/.test(el.tagName);
    const directText = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim();
    const text = clip(/^(H[1-6]|P|LI|BLOCKQUOTE|A|BUTTON)$/.test(el.tagName) ? el.innerText : directText, 1200);
    if (rect.width > 0 && rect.height > 0 && (semantic || text || ["flex", "grid"].includes(style.display))) {
      const index = sections.length;
      chars += text.length;
      sections.push({ parent, tag: el.tagName.toLowerCase(), text, ...(el.tagName === "IMG" ? { image: url(el.currentSrc || el.src), alt: clip(el.alt, 300) } : {}),
        ...(el.tagName === "A" ? { href: url(el.href) } : {}),
        box: { x: Math.round(rect.x), y: Math.round(rect.y + scrollY), width: Math.round(rect.width), height: Math.round(rect.height) },
        style: { color: style.color, backgroundColor: style.backgroundColor, fontSize: style.fontSize, fontWeight: style.fontWeight, textAlign: style.textAlign,
          display: style.display, direction: style.direction, gap: style.gap, padding: style.padding, margin: style.margin, minHeight: style.minHeight, borderRadius: style.borderRadius, gridTemplateColumns: clip(style.gridTemplateColumns, 100) } });
      parent = index;
    }
    for (const child of el.children) {
      if (visited >= 2500 || sections.length >= 100 || chars > 18000) { truncated = true; break; }
      walk(child, depth + 1, parent);
    }
  };
  if (document.body) walk(document.body, 0, null);
  return { url: location.href, title: clip(document.title, 300), description: clip(document.querySelector('meta[name="description"]')?.content, 500),
    language: clip(document.documentElement.lang, 20), direction: getComputedStyle(document.documentElement).direction,
    viewport: { width: innerWidth, height: innerHeight }, sections, images, links, truncated,
    omitted: { forms: document.forms.length, frames: document.querySelectorAll("iframe").length, canvases: document.querySelectorAll("canvas").length } };
}

// All HTTPS responses, including scripts/styles/API reads, pass through a main-owned
// pinned IPv4 transport. Browser headers, cookies and credentials are never forwarded.
function publicGet(wp, value, signal, budget) {
  return (async () => {
    const url = imageURL(value);
    if (++budget.requests > 180) throw Error("request limit");
    const target = await wp.publicTarget(url, signal);
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const req = https.request(url, { method: "GET", agent: false, signal,
        headers: { Accept: "*/*", "Accept-Encoding": "identity", "User-Agent": "Mozilla/5.0 SiteImport/1.0" },
        lookup: (_host, options, cb) => options.all ? cb(null, [target]) : cb(null, target.address, target.family),
      }, (res) => {
        if (res.statusCode !== 200 || (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")) {
          res.destroy(); reject(Error("redirect or unsupported response")); return;
        }
        const chunks = []; let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length; budget.bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024 || budget.bytes > 40 * 1024 * 1024) res.destroy(Error("size limit"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => resolve({ body: Buffer.concat(chunks), type: res.headers["content-type"] || "application/octet-stream" }));
      });
      req.setTimeout(10000, () => req.destroy(Error("timeout")));
      req.on("error", reject); req.end();
    });
  })();
}
const CSP = "default-src https: data:; script-src https: 'unsafe-inline' 'unsafe-eval'; style-src https: 'unsafe-inline'; img-src https: data:; font-src https: data:; connect-src https:; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; form-action 'none'; base-uri 'none'";
function createImportReader({ BrowserWindow, session }, wp) {
  return async (value, outerSignal) => {
    const source = imageURL(value);
    const controller = new AbortController();
    const signal = AbortSignal.any([outerSignal, controller.signal, AbortSignal.timeout(16000)]);
    signal.throwIfAborted();
    const isolated = session.fromPartition(`site-import-${randomUUID()}`, { cache: false });
    // A real deny-only local proxy avoids relying on an allegedly unused port.
    const denyProxy = net.createServer((socket) => socket.destroy());
    let window;
    const budget = { requests: 0, bytes: 0 }, blocked = { count: 0 };
    const stop = () => { if (window && !window.isDestroyed()) window.destroy(); };
    try {
      // Any Chromium network path not serviced by our protocol handler has no direct
      // route. This includes WebRTC, WebSockets, speculative loads and DNS rebinding.
      await new Promise((resolve, reject) => { denyProxy.once("error", reject); denyProxy.listen(0, "127.0.0.1", resolve); });
      await isolated.setProxy({ mode: "fixed_servers", proxyRules: `127.0.0.1:${denyProxy.address().port}`, proxyBypassRules: "<-loopback>" });
      isolated.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
      isolated.setPermissionCheckHandler(() => false);
      isolated.on("will-download", (event) => event.preventDefault());
      isolated.webRequest.onBeforeRequest((details, callback) => {
        let cancel = true;
        try { cancel = !["https:", "data:"].includes(new URL(details.url).protocol) || ["webSocket", "subFrame"].includes(details.resourceType); } catch { /* Deny malformed URLs. */ }
        callback({ cancel });
      });
      await isolated.protocol.handle("https", async (request) => {
        try {
          if (request.method !== "GET") throw Error("read only");
          const data = await publicGet(wp, request.url, signal, budget);
          return new Response(data.body, { status: 200, headers: { "Content-Type": data.type, "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
        } catch { blocked.count++; return new Response("Blocked import resource", { status: 502, headers: { "Content-Type": "text/plain", "Content-Security-Policy": "default-src 'none'" } }); }
      });
      window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: {
        session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false,
        backgroundThrottling: false, navigateOnDragDrop: false, devTools: false, disableDialogs: true,
      } });
      window.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.on("will-redirect", (event) => event.preventDefault());
      window.webContents.on("will-attach-webview", (event) => event.preventDefault());
      window.webContents.on("login", (event) => event.preventDefault());
      signal.addEventListener("abort", stop, { once: true });
      signal.throwIfAborted();
      await window.loadURL(source.href);
      // Bounded settling and scrolling trigger common lazy-loaded content without clicks.
      await window.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `(async () => { for (let i=0;i<4;i++) { await new Promise(r=>setTimeout(r,350)); scrollTo(0,Math.min(document.body.scrollHeight,i*900)); } scrollTo(0,0); })()` }]);
      signal.throwIfAborted();
      const result = await window.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `(${extractRenderedPage.toString()})()` }]);
      signal.throwIfAborted();
      if (new URL(result.url).origin !== source.origin || !result.sections?.some((s) => s.text || s.image) || result.sections.some((s) => s.text === "Blocked import resource")) throw Error("empty or blocked page");
      return { ...result, blockedResources: blocked.count };
    } catch { throw new Error("לא ניתן לקרוא את העמוד המרונדר. ייתכן שנדרשת כניסה, שהאתר חוסם קריאה או שהכתובת מפנה לכתובת אחרת. לא בוצעה כתיבה."); }
    finally {
      signal.removeEventListener("abort", stop); controller.abort(); stop();
      try { isolated.protocol.unhandle("https"); } catch { /* Setup may have failed before registration. */ }
      await isolated.closeAllConnections().catch(() => {});
      await isolated.clearStorageData().catch(() => {});
      if (denyProxy.listening) await new Promise((resolve) => denyProxy.close(resolve));
    }
  };
}
module.exports = { createImportReader, extractRenderedPage, publicGet };
