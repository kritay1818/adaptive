const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  WordPress,
  siteURL,
  publicAddress,
  request,
} = require("../src/wordpress.cjs");
const key = crypto.randomBytes(32);
const storage = {
  isEncryptionAvailable: () => true,
  encryptString(s) {
    const iv = crypto.randomBytes(12),
      c = crypto.createCipheriv("aes-256-gcm", key, iv);
    return Buffer.concat([iv, c.update(s), c.final(), c.getAuthTag()]);
  },
  decryptString(b) {
    const c = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    c.setAuthTag(b.subarray(-16));
    return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString();
  },
};
const candidate = {
  site: "https://public.example/blog",
  username: "editor",
  password: "public-dummy-application-password",
};
test("injected WP authenticated read stores encrypted project credentials, redacted and isolated", async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "wp-test-"));
  try {
    let request;
    const wp = new WordPress(dir, storage, {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (url, options) => {
        request = { url, options };
        return {
          status: 200,
          body: JSON.stringify({ id: 7, name: "Fixture" }),
        };
      },
    });
    await wp.connect("a", candidate);
    assert.equal(request.url.pathname, "/blog/index.php");
    assert.equal(
      request.url.search,
      "?rest_route=%2Fwp%2Fv2%2Fusers%2Fme&context=edit",
    );
    assert.equal(request.url.searchParams.get("rest_route"), "/wp/v2/users/me");
    assert.equal(request.options.method, "GET");
    assert.equal(wp.status("a").connected, true);
    assert.equal(wp.status("b").connected, false);
    assert.ok(!JSON.stringify(wp.status("a")).includes(candidate.password));
    assert.ok(!fs.readFileSync(wp.file, "utf8").includes(candidate.password));
    assert.equal(new WordPress(dir, storage).status("a").connected, true);
    wp.disconnect("a");
    assert.equal(wp.status("a").connected, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("query REST endpoint preserves root and subdirectory installation bases without rewrite routes", async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "wp-query-"));
  try {
    let captured;
    const wp = new WordPress(dir, storage, {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async (url, options) => {
        captured = { url, options };
        return { status: 200, body: '{"id":7}' };
      },
    });
    for (const [site, base] of [
      ["https://public.example", "/"],
      ["https://public.example/", "/"],
      ["https://public.example/blog", "/blog/"],
      ["https://public.example/blog/", "/blog/"],
      ["https://public.example/nested/site/", "/nested/site/"],
    ]) {
      await wp.connect("a", { ...candidate, site });
      assert.equal(captured.url.origin, "https://public.example");
      assert.equal(captured.url.pathname, base + "index.php");
      assert.deepEqual(
        [...captured.url.searchParams],
        [
          ["rest_route", "/wp/v2/users/me"],
          ["context", "edit"],
        ],
      );
      assert.equal(captured.options.address, "93.184.216.34");
      assert.equal(captured.options.family, 4);
      assert.equal(captured.options.method, "GET");
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("non-REST HTML gives a friendly error without exposing body or replacing credentials", async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "wp-html-"));
  try {
    const wp = new WordPress(dir, storage, {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => ({ status: 200, body: '{"id":7}' }),
    });
    await wp.connect("a", candidate);
    const before = fs.readFileSync(wp.file, "utf8");
    wp.request = async () => ({
      status: 200,
      contentType: "text/html; charset=UTF-8",
      body: "<!doctype html><html>PRIVATE_SERVER_BODY</html>",
    });
    await assert.rejects(wp.connect("a", candidate), (e) => {
      assert.match(e.message, /האתר החזיר דף אינטרנט במקום תשובת WordPress/);
      assert.doesNotMatch(e.message, /PRIVATE_SERVER_BODY/);
      return true;
    });
    assert.equal(fs.readFileSync(wp.file, "utf8"), before);
    assert.equal(wp.status("a").connected, true);
    wp.request = async () => ({
      status: 200,
      body: "  <html>PRIVATE_SERVER_BODY</html>",
    });
    await assert.rejects(wp.connect("a", candidate), /האתר החזיר דף אינטרנט/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("URL guard rejects private, ambiguous and embedded credential URLs before DNS", () => {
  for (const url of [
    "http://public.example",
    "https://user:pass@public.example",
    "https://@public.example",
    "https://public.example?",
    "https://public.example#",
    "https://public.example/?secret=x",
    "https://public.example/#x",
    "https://127.1",
    "https://2130706433",
    "https://0x7f000001",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://localhost",
    "https://public.example:8443",
    "https://public.example.",
  ])
    assert.throws(() => siteURL(url), undefined, url);
  assert.equal(
    siteURL("https://public.example/subsite").href,
    "https://public.example/subsite/",
  );
});
test("SSRF guard denies reserved/private/link-local/mapped addresses", () => {
  for (const ip of [
    "0.1.2.3",
    "10.2.3.4",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:8.8.8.8",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("93.184.216.34"), true);
});
test("fail closed encryption, DNS filtering, auth/redirect/size/parse failures preserve old encrypted data", async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "wp-security-"));
  try {
    let calls = 0,
      addresses = [{ address: "93.184.216.34", family: 4 }],
      response = { status: 200, body: '{"id":7}' };
    const deps = {
      lookup: async () => addresses,
      request: async () => {
        calls++;
        return response;
      },
    };
    const wp = new WordPress(dir, storage, deps);
    await wp.connect("a", candidate);
    await wp.connect("b", candidate);
    const before = fs.readFileSync(wp.file, "utf8");
    for (const result of [
      { status: 301, body: "" },
      { status: 302, body: "" },
      { status: 307, body: "" },
      { status: 308, body: "" },
      { status: 401, body: candidate.password },
      { status: 403, body: "" },
      { status: 500, body: "" },
      { status: 200, body: "<html>secret</html>" },
      { status: 200, body: '{"id":0}' },
      { status: 200, body: "x".repeat(262145) },
    ]) {
      response = result;
      const count = calls;
      await assert.rejects(
        wp.connect("a", { ...candidate, password: "replacement-public-dummy" }),
        (e) => !e.message.includes(candidate.password),
      );
      assert.equal(calls, count + 1, "single request, no redirect retries");
      assert.equal(fs.readFileSync(wp.file, "utf8"), before);
      assert.equal(wp.status("a").connected, true);
    }
    for (const denied of [
      [{ address: "127.0.0.1", family: 4 }],
      [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
      [],
      [{ address: "::ffff:93.184.216.34", family: 6 }],
    ]) {
      addresses = denied;
      const count = calls;
      await assert.rejects(wp.connect("a", candidate));
      assert.equal(calls, count);
    }
    for (const badStorage of [
      { ...storage, isEncryptionAvailable: () => false },
      { ...storage, getSelectedStorageBackend: () => "basic_text" },
    ]) {
      const blocked = new WordPress(dir, badStorage, deps);
      const count = calls;
      await assert.rejects(blocked.connect("a", candidate), /הצפנה/);
      assert.equal(calls, count);
      assert.equal(fs.readFileSync(wp.file, "utf8"), before);
    }
    addresses = [{ address: "93.184.216.34", family: 4 }];
    response = { status: 200, body: '{"id":7}' };
    const failedStore = new WordPress(
      dir,
      {
        ...storage,
        encryptString: () => {
          throw new Error(candidate.password);
        },
      },
      deps,
    );
    await assert.rejects(
      failedStore.connect("a", candidate),
      (e) => !e.message.includes(candidate.password),
    );
    assert.equal(fs.readFileSync(wp.file, "utf8"), before);
    wp.disconnect("a");
    assert.equal(wp.status("b").connected, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("production HTTPS transport pins vetted DNS result, preserves TLS hostname, rejects redirects without following", async (t) => {
  const https = require("node:https"),
    { EventEmitter } = require("node:events");
  let calls = 0,
    options,
    requested;
  t.mock.method(https, "request", (url, opts, cb) => {
    calls++;
    options = opts;
    requested = url;
    const req = new EventEmitter();
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 302;
      res.headers = { location: "https://attacker.example/collect" };
      res.destroy = () => {};
      cb(res);
    };
    return req;
  });
  const result = await request(
    new URL(
      "https://public.example/index.php?rest_route=%2Fwp%2Fv2%2Fusers%2Fme&context=edit",
    ),
    {
      address: "93.184.216.34",
      family: 4,
      authorization: "Basic PUBLIC_FIXTURE",
      signal: AbortSignal.timeout(1000),
    },
  );
  assert.equal(result.status, 302);
  assert.equal(calls, 1);
  assert.equal(options.agent, false);
  assert.equal(options.method, "GET");
  assert.equal(requested.hostname, "public.example");
  assert.equal(
    options.rejectUnauthorized,
    undefined,
    "TLS verification remains enabled by default",
  );
  await new Promise((resolve, reject) =>
    options.lookup("public.example", {}, (err, address, family) => {
      try {
        assert.equal(err, null);
        assert.equal(address, "93.184.216.34");
        assert.equal(family, 4);
        resolve();
      } catch (e) {
        reject(e);
      }
    }),
  );
});

test("production HTTPS HTML content type reaches the friendly non-REST error", async (t) => {
  const https = require("node:https"),
    { EventEmitter } = require("node:events");
  t.mock.method(https, "request", (_url, _options, callback) => {
    const req = new EventEmitter();
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = { "content-type": "text/html; charset=UTF-8" };
      callback(res);
      // Even an otherwise valid user-shaped body must not masquerade as REST.
      res.emit("data", Buffer.from('{"id":7}'));
      res.emit("end");
    };
    return req;
  });
  const dir = fs.mkdtempSync(
    path.join(process.env.TMPDIR, "wp-html-transport-"),
  );
  try {
    const wp = new WordPress(dir, storage, {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    await assert.rejects(wp.connect("a", candidate), /האתר החזיר דף אינטרנט/);
    assert.equal(fs.existsSync(wp.file), false);
    assert.equal(wp.status("a").connected, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("production DNS requests only IPv4, enabling dual-stack hosts without permitting IPv6 sockets", async (t) => {
  const dns = require("node:dns").promises;
  let options;
  t.mock.method(dns, "lookup", async (_host, opts) => {
    options = opts;
    return [{ address: "93.184.216.34", family: 4 }];
  });
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "wp-dns-"));
  try {
    const wp = new WordPress(dir, storage, {
      request: async () => ({ status: 200, body: '{"id":7}' }),
    });
    await wp.connect("a", candidate);
    assert.equal(options.family, 4);
    assert.equal(options.all, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("production HTTPS body limit aborts oversized streams without parsing", async (t) => {
  const https = require("node:https"),
    { EventEmitter } = require("node:events");
  let destroyed = false;
  t.mock.method(https, "request", (_url, _options, callback) => {
    const req = new EventEmitter();
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.destroy = (error) => {
        destroyed = true;
        res.emit("error", error);
      };
      callback(res);
      res.emit("data", Buffer.alloc(262145));
    };
    return req;
  });
  await assert.rejects(
    request(new URL("https://public.example"), {
      address: "93.184.216.34",
      family: 4,
      authorization: "PUBLIC TEST FIXTURE",
      signal: AbortSignal.timeout(1000),
    }),
    /size/,
  );
  assert.equal(destroyed, true);
});
test("DNS timeout releases busy lock, never sends auth, and keeps previous connection", async (t) => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "wp-timeout-"));
  try {
    const wp = new WordPress(dir, storage, {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => ({ status: 200, body: '{"id":7}' }),
    });
    await wp.connect("a", candidate);
    const before = fs.readFileSync(wp.file, "utf8");
    const controller = new AbortController();
    let milliseconds;
    t.mock.method(AbortSignal, "timeout", (ms) => {
      milliseconds = ms;
      return controller.signal;
    });
    wp.lookup = () => new Promise(() => {});
    wp.request = () => {
      throw new Error("must not send auth");
    };
    const pending = wp.connect("a", candidate);
    controller.abort();
    await assert.rejects(pending, /15/);
    assert.equal(milliseconds, 15000);
    assert.equal(wp.busy.size, 0);
    assert.equal(fs.readFileSync(wp.file, "utf8"), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("atomic write failure preserves previous connection in memory and disk", async (t) => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, "wp-disk-"));
  try {
    const wp = new WordPress(dir, storage, {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => ({ status: 200, body: '{"id":7}' }),
    });
    await wp.connect("a", candidate);
    const before = fs.readFileSync(wp.file, "utf8"),
      status = wp.status("a");
    t.mock.method(fs, "renameSync", () => {
      throw new Error(candidate.password);
    });
    await assert.rejects(
      wp.connect("a", { ...candidate, site: "https://other.example" }),
      (e) => !e.message.includes(candidate.password),
    );
    assert.deepEqual(wp.status("a"), status);
    assert.equal(fs.readFileSync(wp.file, "utf8"), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
