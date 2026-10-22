"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { WordPress, sniffImage } = require("../src/wordpress.cjs");

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const avif = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypavif"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("avifmif1"),
  Buffer.alloc(32),
]);
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};

test("file type comes from magic bytes, including AVIF", () => {
  assert.equal(sniffImage(png), "image/png");
  assert.equal(sniffImage(avif), "image/avif");
  assert.equal(
    sniffImage(
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>             "),
    ),
    null,
  );
  assert.equal(
    sniffImage(
      Buffer.concat([
        Buffer.from([0, 0, 0, 24]),
        Buffer.from("ftypmp42"),
        Buffer.alloc(32),
      ]),
    ),
    null,
  );
});

test("Wix transform URLs are fetched as the original, with the same network rules; AVIF is accepted by bytes", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-img-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const requested = [];
  const wp = new WordPress(dir, storage, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url) => {
      requested.push(url.href);
      return {
        status: 200,
        contentType: "image/avif",
        body: url.pathname.includes("/v1/") ? avif : png,
      };
    },
  });
  const wix =
    "https://static.wixstatic.com/media/abc123~mv2.png/v1/fill/w_1920,h_1080,al_c,q_85,enc_avif,quality_auto/hero.png";
  const original = await wp.downloadImage(wix);
  assert.deepEqual(requested, [
    "https://static.wixstatic.com/media/abc123~mv2.png",
  ]);
  assert.equal(original.mime, "image/png"); // decided by bytes, not by the AVIF header or the name
  // Any other host: AVIF bytes are accepted and typed as AVIF.
  const other = await wp.downloadImage("https://cdn.example/x/v1/pic.jpg");
  assert.equal(other.mime, "image/avif");
  // Headers cannot smuggle HTML/SVG: a non-image content type is still refused.
  wp.request = async () => ({
    status: 200,
    contentType: "text/html",
    body: png,
  });
  await assert.rejects(wp.downloadImage("https://cdn.example/a.png"));
});
