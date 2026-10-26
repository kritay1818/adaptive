"use strict";
const https = require("node:https");
const net = require("node:net");
const { randomUUID } = require("node:crypto");
const { imageURL, tlsCA } = require("./wordpress.cjs");

// Executed in an isolated world with no preload, Node, or application bridge.
// Extract data, never source HTML, source scripts, handlers, or instructions.
function extractRenderedPage() {
  const clip = (value, max = 600) =>
    String(value || "")
      .trim()
      .slice(0, max);
  const url = (value) => {
    try {
      const u = new URL(value, location.href);
      u.hash = "";
      return u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        u.href.length <= 2048
        ? u.href
        : "";
    } catch {
      return "";
    }
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    return (
      s.display !== "none" &&
      s.visibility !== "hidden" &&
      s.opacity !== "0" &&
      !el.closest('[hidden],[aria-hidden="true"]')
    );
  };
  const images = [],
    links = [],
    sections = [];
  const imageKeys = new Set(),
    linkKeys = new Set();
  let imageChars = 0,
    linkChars = 0;
  const addImage = (src, alt) => {
    src = url(src);
    if (
      src &&
      !imageKeys.has(src) &&
      images.length < 40 &&
      imageChars + src.length < 10000
    ) {
      imageChars += src.length;
      imageKeys.add(src);
      images.push({ url: src, alt: clip(alt, 300) });
    }
  };
  let visited = 0,
    chars = 0,
    truncated = false;
  const walk = (el, depth, parent) => {
    if (++visited > 2500 || sections.length >= 100 || chars > 18000) {
      truncated = true;
      return;
    }
    if (
      depth > 24 ||
      !visible(el) ||
      [
        "SCRIPT",
        "STYLE",
        "NOSCRIPT",
        "IFRAME",
        "OBJECT",
        "EMBED",
        "FORM",
        "INPUT",
        "TEXTAREA",
        "SELECT",
        "SVG",
        "CANVAS",
      ].includes(el.tagName)
    )
      return;
    const style = getComputedStyle(el),
      rect = el.getBoundingClientRect();
    if (el.tagName === "IMG") addImage(el.currentSrc || el.src, el.alt);
    for (const match of style.backgroundImage.matchAll(
      /url\(["']?(.*?)["']?\)/g,
    ))
      addImage(match[1], "");
    if (el.tagName === "A") {
      const href = url(el.href),
        label = clip(el.innerText, 200);
      if (
        href &&
        label &&
        !linkKeys.has(href) &&
        links.length < 80 &&
        linkChars + href.length < 10000
      ) {
        linkChars += href.length;
        linkKeys.add(href);
        links.push({
          url: href,
          label,
          navigation: !!el.closest('nav,header,[role="navigation"]'),
        });
      }
    }
    const semantic =
      /^(H[1-6]|P|LI|BLOCKQUOTE|A|BUTTON|IMG|SECTION|ARTICLE|HEADER|FOOTER|MAIN|NAV)$/.test(
        el.tagName,
      );
    const directText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(" ")
      .trim();
    const text = clip(
      /^(H[1-6]|P|LI|BLOCKQUOTE|A|BUTTON)$/.test(el.tagName)
        ? el.innerText
        : directText,
      1200,
    );
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      (semantic || text || ["flex", "grid"].includes(style.display))
    ) {
      const index = sections.length;
      chars += text.length;
      sections.push({
        parent,
        tag: el.tagName.toLowerCase(),
        text,
        ...(el.tagName === "IMG"
          ? { image: url(el.currentSrc || el.src), alt: clip(el.alt, 300) }
          : {}),
        ...(el.tagName === "A" ? { href: url(el.href) } : {}),
        box: {
          x: Math.round(rect.x),
          y: Math.round(rect.y + scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        style: {
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          textAlign: style.textAlign,
          display: style.display,
          direction: style.direction,
          gap: style.gap,
          padding: style.padding,
          margin: style.margin,
          minHeight: style.minHeight,
          borderRadius: style.borderRadius,
          gridTemplateColumns: clip(style.gridTemplateColumns, 100),
          lineHeight: style.lineHeight,
          fontFamily: clip(
            style.fontFamily.split(",")[0].replace(/["']/g, ""),
            60,
          ),
          maxWidth: style.maxWidth,
          letterSpacing: style.letterSpacing,
          border:
            style.borderTopWidth !== "0px"
              ? `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`
              : "",
        },
      });
      parent = index;
    }
    for (const child of el.children) {
      if (visited >= 2500 || sections.length >= 100 || chars > 18000) {
        truncated = true;
        break;
      }
      walk(child, depth + 1, parent);
    }
  };
  if (document.body) walk(document.body, 0, null);
  // Exact computed values for site CSS (px) and visual order hints for rows of siblings (xRank 0 = leftmost on screen).
  const bodyStyle = document.body ? getComputedStyle(document.body) : null;
  let contentWidth = 0;
  for (const el of document.querySelectorAll(
    "main > *, main section, body > div > *",
  )) {
    const r = el.getBoundingClientRect(),
      s = getComputedStyle(el);
    if (
      r.width > 200 &&
      r.width < innerWidth - 8 &&
      r.left > 4 &&
      Math.abs(r.left - (innerWidth - r.right)) < 6
    )
      contentWidth = Math.max(contentWidth, Math.round(r.width));
    if (s.maxWidth && s.maxWidth.endsWith("px"))
      contentWidth = Math.max(
        contentWidth,
        Math.min(parseFloat(s.maxWidth), innerWidth),
      );
  }
  const metrics = {
    viewportWidth: innerWidth,
    contentWidth,
    bodyFontSize: bodyStyle?.fontSize,
    bodyLineHeight: bodyStyle?.lineHeight,
    bodyFontFamily: clip(
      bodyStyle?.fontFamily.split(",")[0].replace(/["']/g, ""),
      60,
    ),
    bodyColor: bodyStyle?.color,
    pageBackground: bodyStyle?.backgroundColor,
  };
  const byParent = new Map();
  sections.forEach((sec, i) => {
    const k = sec.parent === null ? -1 : sec.parent;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(i);
  });
  for (const indexes of byParent.values()) {
    const rows = [];
    for (const i of indexes) {
      const row = rows.find(
        (r) => Math.abs(sections[r[0]].box.y - sections[i].box.y) < 24,
      );
      if (row) row.push(i);
      else rows.push([i]);
    }
    for (const row of rows)
      if (row.length > 1)
        [...row]
          .sort((a, b) => sections[a].box.x - sections[b].box.x)
          .forEach((i, rank) => {
            sections[i].xRank = rank;
            sections[i].rowSize = row.length;
          });
  }
  // Graphics that are not normal images (inline SVG, small CSS-drawn shapes): described here, cropped from the rendered page by main.
  const graphics = [];
  const mark = (el, kind, where) => {
    if (graphics.length >= 12) return;
    const r = el.getBoundingClientRect();
    if (
      r.width < 8 ||
      r.height < 8 ||
      r.width > 600 ||
      r.height > 600 ||
      !visible(el)
    )
      return;
    const id = `g${graphics.length + 1}`;
    el.setAttribute("data-adactive-g", id);
    graphics.push({
      id,
      kind,
      where,
      label: clip(
        el.getAttribute("aria-label") || el.getAttribute("title") || "",
        80,
      ),
      box: {
        x: Math.round(r.x),
        y: Math.round(r.y + scrollY),
        width: Math.round(r.width),
        height: Math.round(r.height),
      },
    });
  };
  const place = (el) =>
    el.closest("header") ? "header" : el.closest("footer") ? "footer" : "body";
  for (const svg of document.querySelectorAll("svg"))
    if (
      !svg.querySelector("text") &&
      !svg.closest("svg svg") &&
      !svg.closest("button, a[role=button]")
    )
      mark(svg, "svg", place(svg));
  for (const el of document.querySelectorAll("body div, body span, body i")) {
    if (graphics.length >= 12) break;
    if (el.children.length || (el.textContent || "").trim()) continue;
    const s = getComputedStyle(el),
      r = el.getBoundingClientRect();
    const filled =
      s.backgroundColor &&
      s.backgroundColor !== "transparent" &&
      !/rgba\(.*,\s*0\)$/.test(s.backgroundColor);
    if (
      filled &&
      r.width >= 12 &&
      r.width <= 300 &&
      r.height >= 12 &&
      r.height <= 300 &&
      (parseFloat(s.borderTopLeftRadius) > 0 ||
        Math.abs(r.width - r.height) < 4) &&
      r.width < innerWidth * 0.8
    )
      mark(el, "shape", place(el));
  }
  // Site chrome: header (logo, name, menu, contacts), footer (text, links, contacts, social) and floating widgets.
  const chrome = (() => {
    const first = (sel) => {
      for (const s of sel) {
        const el = document.querySelector(s);
        if (el && visible(el)) return el;
      }
      return null;
    };
    const header = first([
      "header",
      '[role="banner"]',
      "#SITE_HEADER",
      '[data-testid*="header" i]',
    ]);
    const footer = first([
      "footer",
      '[role="contentinfo"]',
      "#SITE_FOOTER",
      '[data-testid*="footer" i]',
    ]);
    const contactType = (href) =>
      /^tel:/i.test(href)
        ? "phone"
        : /^mailto:/i.test(href)
          ? "email"
          : /(?:wa\.me|whatsapp\.com)/i.test(href)
            ? "whatsapp"
            : /facebook\.com/i.test(href)
              ? "facebook"
              : /instagram\.com/i.test(href)
                ? "instagram"
                : /(?:twitter\.com|x\.com)\//i.test(href)
                  ? "x"
                  : /linkedin\.com/i.test(href)
                    ? "linkedin"
                    : /youtube\.com|youtu\.be/i.test(href)
                      ? "youtube"
                      : /tiktok\.com/i.test(href)
                        ? "tiktok"
                        : "";
    const contacts = (root) => {
      const out = [],
        seen = new Set();
      for (const a of root ? root.querySelectorAll("a[href]") : []) {
        const raw = a.getAttribute("href") || "",
          type = contactType(raw);
        const href = /^(?:tel|mailto):/i.test(raw)
          ? clip(raw, 200)
          : url(a.href);
        if (type && href && !seen.has(href) && out.length < 12) {
          seen.add(href);
          out.push({
            type,
            label: clip(a.innerText || a.getAttribute("aria-label"), 80),
            url: href,
          });
        }
      }
      return out;
    };
    const menu = (root) => {
      const out = [],
        seen = new Set();
      for (const a of root
        ? root.querySelectorAll('nav a[href], [role="navigation"] a[href]')
        : []) {
        const href = url(a.href),
          label = clip(a.innerText, 80);
        if (
          href &&
          label &&
          !seen.has(href) &&
          out.length < 20 &&
          !contactType(a.getAttribute("href") || "")
        ) {
          seen.add(href);
          out.push({ label, url: href });
        }
      }
      return out;
    };
    const logoEl = header
      ? [...header.querySelectorAll("img")].find(
          (i) => visible(i) && i.getBoundingClientRect().width > 0,
        )
      : null;
    const logo = logoEl
      ? {
          url: url(logoEl.currentSrc || logoEl.src),
          alt: clip(logoEl.alt, 200),
          width: Math.round(logoEl.getBoundingClientRect().width),
          svg: /\.svg(?:$|\?)/i.test(logoEl.currentSrc || logoEl.src || ""),
        }
      : null;
    const footerText = [];
    for (const el of footer
      ? footer.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, span, div")
      : []) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join(" ")
        .trim();
      if (
        own &&
        own.length > 1 &&
        visible(el) &&
        !footerText.includes(clip(own, 300)) &&
        footerText.length < 25
      )
        footerText.push(clip(own, 300));
    }
    const floating = [];
    for (const el of document.querySelectorAll("body *")) {
      if (floating.length >= 12) break;
      const s = getComputedStyle(el);
      if (s.position !== "fixed" || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (
        r.width < 8 ||
        r.height < 8 ||
        (r.top < 100 && r.width > innerWidth * 0.5) ||
        el.contains(document.querySelector("main"))
      )
        continue;
      floating.push(
        clip(
          [
            el.id,
            el.getAttribute("aria-label"),
            el.className && typeof el.className === "string"
              ? el.className.split(" ")[0]
              : "",
            el.innerText,
          ]
            .filter(Boolean)
            .join(" · "),
          120,
        ) || el.tagName.toLowerCase(),
      );
    }
    const siteName = clip(
      header?.querySelector('a[href="/"], a[href="' + location.origin + '/"]')
        ?.innerText ||
        document.querySelector('meta[property="og:site_name"]')?.content ||
        document.title,
      120,
    );
    return {
      header: {
        logo,
        siteName,
        menu: menu(header),
        contacts: contacts(header),
      },
      footer: {
        text: footerText,
        menu: menu(footer),
        contacts: contacts(footer),
      },
      floating,
    };
  })();
  return {
    chrome,
    metrics,
    graphics,
    url: location.href,
    title: clip(document.title, 300),
    description: clip(
      document.querySelector('meta[name="description"]')?.content,
      500,
    ),
    language: clip(document.documentElement.lang, 20),
    direction: getComputedStyle(document.documentElement).direction,
    viewport: { width: innerWidth, height: innerHeight },
    sections,
    images,
    links,
    truncated,
    omitted: {
      forms: document.forms.length,
      frames: document.querySelectorAll("iframe").length,
      canvases: document.querySelectorAll("canvas").length,
    },
  };
}

// Style summary for design references: colors, fonts and component styling only (no page text).
function extractStyleSummary() {
  const add = (map, key, weight) => {
    if (key) map.set(key, (map.get(key) || 0) + weight);
  };
  const top = (map, n) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([value]) => value);
  const text = new Map(),
    bg = new Map(),
    fonts = new Map(),
    radii = new Map();
  const transparent = (c) =>
    !c || c === "transparent" || /rgba\(.*,\s*0\)$/.test(c);
  let n = 0;
  for (const el of document.querySelectorAll("body, body *")) {
    if (++n > 1500) break;
    const s = getComputedStyle(el),
      r = el.getBoundingClientRect();
    if (
      s.display === "none" ||
      s.visibility === "hidden" ||
      !r.width ||
      !r.height
    )
      continue;
    const own = Array.from(el.childNodes)
      .filter((c) => c.nodeType === 3)
      .map((c) => c.textContent.trim())
      .join("").length;
    if (own) {
      add(text, s.color, own);
      add(fonts, s.fontFamily.split(",")[0].replace(/["']/g, "").trim(), own);
    }
    if (!transparent(s.backgroundColor))
      add(bg, s.backgroundColor, Math.min(r.width * r.height, 2e6) / 1000);
    if (/^(A|BUTTON)$/.test(el.tagName) && s.borderRadius !== "0px")
      add(radii, s.borderRadius, 1);
  }
  const pick = (sel, n2) =>
    [...document.querySelectorAll(sel)].slice(0, n2).map((el) => {
      const s = getComputedStyle(el);
      return {
        fontFamily: s.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        color: s.color,
        textTransform: s.textTransform,
      };
    });
  const buttons = [
    ...document.querySelectorAll(
      'a[class*="btn" i],a[class*="button" i],button',
    ),
  ]
    .slice(0, 3)
    .map((el) => {
      const s = getComputedStyle(el);
      return {
        backgroundColor: s.backgroundColor,
        color: s.color,
        borderRadius: s.borderRadius,
        padding: s.padding,
        fontWeight: s.fontWeight,
      };
    });
  return {
    textColors: top(text, 5),
    backgroundColors: top(bg, 6),
    fonts: top(fonts, 4),
    headings: pick("h1,h2,h3", 4),
    body: pick("p", 1)[0] || null,
    buttons,
    buttonRadii: top(radii, 2),
    pageBackground: getComputedStyle(document.body).backgroundColor,
    direction: getComputedStyle(document.documentElement).direction,
  };
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
      const ca = tlsCA();
      const req = https.request(
        url,
        {
          ...(ca ? { ca } : {}),
          method: "GET",
          agent: false,
          signal,
          headers: {
            Accept: "*/*",
            "Accept-Encoding": "identity",
            "User-Agent": "Mozilla/5.0 SiteImport/1.0",
          },
          lookup: (_host, options, cb) =>
            options.all
              ? cb(null, [target])
              : cb(null, target.address, target.family),
        },
        (res) => {
          if (
            res.statusCode !== 200 ||
            (res.headers["content-encoding"] &&
              res.headers["content-encoding"] !== "identity")
          ) {
            res.destroy();
            reject(Error("redirect or unsupported response"));
            return;
          }
          const chunks = [];
          let bytes = 0;
          res.on("data", (chunk) => {
            bytes += chunk.length;
            budget.bytes += chunk.length;
            if (bytes > 8 * 1024 * 1024 || budget.bytes > 40 * 1024 * 1024)
              res.destroy(Error("size limit"));
            else chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () =>
            resolve({
              body: Buffer.concat(chunks),
              type: res.headers["content-type"] || "application/octet-stream",
            }),
          );
        },
      );
      req.setTimeout(10000, () => req.destroy(Error("timeout")));
      req.on("error", reject);
      req.end();
    });
  })();
}
const CSP =
  "default-src https: data:; script-src https: 'unsafe-inline' 'unsafe-eval'; style-src https: 'unsafe-inline'; img-src https: data:; font-src https: data:; connect-src https:; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; form-action 'none'; base-uri 'none'";
function createImportReader({ BrowserWindow, session }, wp) {
  return async (value, outerSignal, options = {}) => {
    const source = imageURL(value);
    const controller = new AbortController();
    const signal = AbortSignal.any([
      outerSignal,
      controller.signal,
      AbortSignal.timeout(
        options.screenshots ? (options.shots > 2 ? 40000 : 32000) : 16000,
      ),
    ]);
    signal.throwIfAborted();
    const isolated = session.fromPartition(`site-import-${randomUUID()}`, {
      cache: false,
    });
    // A real deny-only local proxy avoids relying on an allegedly unused port.
    const denyProxy = net.createServer((socket) => socket.destroy());
    let window;
    const budget = { requests: 0, bytes: 0 },
      blocked = { count: 0 };
    const stop = () => {
      if (window && !window.isDestroyed()) window.destroy();
    };
    try {
      // Any Chromium network path not serviced by our protocol handler has no direct
      // route. This includes WebRTC, WebSockets, speculative loads and DNS rebinding.
      await new Promise((resolve, reject) => {
        denyProxy.once("error", reject);
        denyProxy.listen(0, "127.0.0.1", resolve);
      });
      await isolated.setProxy({
        mode: "fixed_servers",
        proxyRules: `127.0.0.1:${denyProxy.address().port}`,
        proxyBypassRules: "<-loopback>",
      });
      isolated.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
      isolated.setPermissionCheckHandler(() => false);
      isolated.on("will-download", (event) => event.preventDefault());
      isolated.webRequest.onBeforeRequest((details, callback) => {
        let cancel = true;
        try {
          cancel =
            !["https:", "data:"].includes(new URL(details.url).protocol) ||
            ["webSocket", "subFrame"].includes(details.resourceType);
        } catch {
          /* Deny malformed URLs. */
        }
        callback({ cancel });
      });
      await isolated.protocol.handle("https", async (request) => {
        try {
          if (request.method !== "GET") throw Error("read only");
          const data = await publicGet(wp, request.url, signal, budget);
          return new Response(data.body, {
            status: 200,
            headers: {
              "Content-Type": data.type,
              "Content-Security-Policy": CSP,
              "X-Content-Type-Options": "nosniff",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-store",
            },
          });
        } catch {
          blocked.count++;
          return new Response("Blocked import resource", {
            status: 502,
            headers: {
              "Content-Type": "text/plain",
              "Content-Security-Policy": "default-src 'none'",
            },
          });
        }
      });
      window = new BrowserWindow({
        show: false,
        width: 1440,
        height: 1000,
        webPreferences: {
          session: isolated,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false,
          webviewTag: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
          backgroundThrottling: false,
          navigateOnDragDrop: false,
          devTools: false,
          disableDialogs: true,
        },
      });
      window.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.on("will-redirect", (event) => event.preventDefault());
      window.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      window.webContents.on("login", (event) => event.preventDefault());
      signal.addEventListener("abort", stop, { once: true });
      signal.throwIfAborted();
      await window.loadURL(source.href);
      // Bounded settling and scrolling trigger common lazy-loaded content without clicks.
      await window.webContents.executeJavaScriptInIsolatedWorld(999, [
        {
          code: `(async () => { for (let i=0;i<4;i++) { await new Promise(r=>setTimeout(r,350)); scrollTo(0,Math.min(document.body.scrollHeight,i*900)); } scrollTo(0,0); })()`,
        },
      ]);
      signal.throwIfAborted();
      const result = await window.webContents.executeJavaScriptInIsolatedWorld(
        999,
        [{ code: `(${extractRenderedPage.toString()})()` }],
      );
      signal.throwIfAborted();
      if (
        new URL(result.url).origin !== source.origin ||
        !result.sections?.some((s) => s.text || s.image) ||
        result.sections.some((s) => s.text === "Blocked import resource")
      )
        throw Error("empty or blocked page");
      if (options.screenshots) {
        // Design reference: two JPEG screenshots (top, then after scrolling) plus a style summary; page text is not returned.
        const run = (code) =>
          window.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]);
        const style = await run(`(${extractStyleSummary.toString()})()`);
        const shots = [];
        const grab = async () => {
          const image = await window.webContents.capturePage();
          if (image.isEmpty()) return;
          const size = image.getSize();
          const small =
            size.width > 1024 ? image.resize({ width: 1024 }) : image;
          shots.push({
            mime: "image/jpeg",
            data: small.toJPEG(72).toString("base64"),
          });
        };
        await grab();
        // Top of page, then up to (shots - 1) more after scrolling (1000 px steps), skipping positions past the page end.
        for (let step = 1; step < (options.shots || 2); step++) {
          const reached = await run(
            `(async () => { const y = ${step * 1000}; if (document.documentElement.scrollHeight < y + 300) return false; scrollTo(0, y); await new Promise(r => setTimeout(r, 500)); return true; })()`,
          );
          signal.throwIfAborted();
          if (!reached) break;
          await grab();
        }
        if (options.bottom) {
          // Footer: one more screenshot at the very bottom when the page is taller than what was already captured.
          const atBottom = await run(
            `(async () => { const y = Math.max(0, document.documentElement.scrollHeight - innerHeight); if (y < ${(options.shots || 2) * 1000 - 400}) return false; scrollTo(0, y); await new Promise(r => setTimeout(r, 500)); return true; })()`,
          );
          signal.throwIfAborted();
          if (atBottom) await grab();
        }
        // Import scans also need the extracted page data (text, images, links, sections) next to the screenshots.
        if (options.full) {
          // Crop each described graphic (never text) from the rendered page as a PNG.
          const graphicsData = [];
          for (const g of (result.graphics || []).slice(0, 10)) {
            const rect = await run(
              `(() => { const el = document.querySelector('[data-adactive-g="${g.id}"]'); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
            );
            signal.throwIfAborted();
            if (
              !rect ||
              rect.x < 0 ||
              rect.y < 0 ||
              rect.x + rect.width > 1440 ||
              rect.y + rect.height > 1000
            )
              continue;
            await new Promise((resolve) => setTimeout(resolve, 150));
            const image = await window.webContents.capturePage({
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.max(1, Math.round(rect.width)),
              height: Math.max(1, Math.round(rect.height)),
            });
            if (image.isEmpty()) continue;
            const png = image.toPNG();
            if (png.length <= 300 * 1024)
              graphicsData.push({
                id: g.id,
                mime: "image/png",
                data: png.toString("base64"),
              });
          }
          return {
            ...result,
            style,
            screenshots: shots,
            graphicsData,
            blockedResources: blocked.count,
          };
        }
        return {
          url: result.url,
          title: result.title,
          language: result.language,
          direction: result.direction,
          style,
          screenshots: shots,
          blockedResources: blocked.count,
        };
      }
      return { ...result, blockedResources: blocked.count };
    } catch {
      throw new Error(
        "לא ניתן לקרוא את העמוד המרונדר. ייתכן שנדרשת כניסה, שהאתר חוסם קריאה או שהכתובת מפנה לכתובת אחרת. לא בוצעה כתיבה.",
      );
    } finally {
      signal.removeEventListener("abort", stop);
      controller.abort();
      stop();
      try {
        isolated.protocol.unhandle("https");
      } catch {
        /* Setup may have failed before registration. */
      }
      await isolated.closeAllConnections().catch(() => {});
      await isolated.clearStorageData().catch(() => {});
      if (denyProxy.listening)
        await new Promise((resolve) => denyProxy.close(resolve));
    }
  };
}
module.exports = { createImportReader, extractRenderedPage, publicGet };
