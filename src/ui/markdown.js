"use strict";
// Basic, safe markdown for chat bubbles. parse() is pure (testable in Node); render() builds DOM nodes with createElement /
// createTextNode only: never innerHTML, no links, no images, no HTML. Supported: **bold**, __bold__, *italic*, _italic_,
// `inline code`, bullet lists (- * •), numbered lists (1. 1)), line breaks. Everything else stays literal text.
(function (root) {
  const INLINE =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\s][^*\n]*\*|(?<![\p{L}\p{N}])_[^_\s][^_\n]*_(?![\p{L}\p{N}]))/gu;
  function inline(text) {
    const nodes = [];
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
      if (m.index > last)
        nodes.push({ t: "text", text: text.slice(last, m.index) });
      const raw = m[0];
      if (raw.startsWith("`"))
        nodes.push({ t: "code", text: raw.slice(1, -1) });
      else if (raw.startsWith("**") || raw.startsWith("__"))
        nodes.push({ t: "strong", children: inline(raw.slice(2, -2)) });
      else nodes.push({ t: "em", children: inline(raw.slice(1, -1)) });
      last = m.index + raw.length;
    }
    if (last < text.length) nodes.push({ t: "text", text: text.slice(last) });
    return nodes;
  }
  function parse(source) {
    const blocks = [];
    let list = null,
      para = null;
    for (const line of String(source).replace(/\r\n?/g, "\n").split("\n")) {
      const item = /^\s*(?:([-*•])|(\d{1,3})[.)])\s+(.*)$/.exec(line);
      if (item) {
        para = null;
        const type = item[1] ? "ul" : "ol";
        if (!list || list.type !== type)
          blocks.push((list = { type, items: [] }));
        list.items.push(inline(item[3]));
      } else if (!line.trim()) {
        para = null;
        list = null;
      } else {
        list = null;
        if (!para) blocks.push((para = { type: "p", lines: [] }));
        para.lines.push(inline(line));
      }
    }
    return blocks;
  }
  function appendInline(doc, parent, nodes) {
    for (const n of nodes) {
      if (n.t === "text") parent.append(doc.createTextNode(n.text));
      else {
        const el = doc.createElement(
          n.t === "code" ? "code" : n.t === "strong" ? "strong" : "em",
        );
        if (n.t === "code") el.textContent = n.text;
        else appendInline(doc, el, n.children);
        parent.append(el);
      }
    }
  }
  function render(doc, source) {
    const box = doc.createElement("div");
    box.className = "md";
    for (const block of parse(source)) {
      if (block.type === "p") {
        const p = doc.createElement("p");
        p.dir = "auto";
        block.lines.forEach((nodes, i) => {
          if (i) p.append(doc.createElement("br"));
          appendInline(doc, p, nodes);
        });
        box.append(p);
      } else {
        const list = doc.createElement(block.type);
        for (const nodes of block.items) {
          const li = doc.createElement("li");
          li.dir = "auto";
          appendInline(doc, li, nodes);
          list.append(li);
        }
        box.append(list);
      }
    }
    return box;
  }
  const api = { parse, render };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.adMarkdown = api;
})(typeof window !== "undefined" ? window : globalThis);
