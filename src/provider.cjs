"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { randomUUID } = require("node:crypto");
const { atomic, text } = require("./core.cjs");
const diag = require("./diag.cjs");
const {
  adapter,
  catalog,
  headers,
  generation,
  output,
  listing,
  listed,
} = require("./provider-adapters.cjs");
const validModel = (id) =>
  typeof id === "string" && /^[-a-zA-Z0-9._:]{1,200}$/.test(id);
const slot = (provider, region) => provider + (region ? ":" + region : "");
function redact(text, key) {
  let out = String(text);
  if (key) out = out.split(key).join("[redacted]");
  return out.replace(
    /(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{10,}|Bearer\s+\S+)/g,
    "[redacted]",
  );
}
// Only claim "no image support" when the provider's own error text says so; otherwise show the real error.
function visionError(messages, e) {
  const d = e?.detail || "";
  if (
    messages.some((m) => m.images?.length) &&
    /image|vision|multimodal|modalit/i.test(d) &&
    /not support|unsupported|does not support|doesn't support|cannot|can't|not allowed|not available/i.test(
      d,
    )
  ) {
    const error = new Error(
      "המודל לא תומך בתמונות. בחרו מודל עם קלט תמונה ושלחו שוב, או שלחו בלי תמונה.",
    );
    error.detail = d;
    return error;
  }
  return e;
}
class Provider {
  constructor(dir, storage, fetcher = fetch) {
    this.file = path.join(dir, "connection.json");
    this.storage = storage;
    this.fetch = fetcher;
    this.saved = { version: 2, active: null, records: {} };
    this.busy = false;
    this.pending = null;
    this.pendingTimer = null;
    this.discoveryEpoch = 0;
    this.loadError = false;
    if (fs.existsSync(this.file)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
        let loaded;
        if (
          data.version === 2 &&
          data.records &&
          typeof data.records === "object"
        )
          loaded = data;
        else if (typeof data.encrypted === "string" && validModel(data.model)) {
          // Lazy, lossless migration: original ciphertext remains until a successful save.
          loaded = {
            version: 2,
            active: { slot: "openai", model: data.model },
            records: {
              openai: {
                provider: "openai",
                region: "",
                model: data.model,
                models: [data.model],
                encrypted: data.encrypted,
              },
            },
          };
        } else throw new Error();
        for (const [id, r] of Object.entries(loaded.records)) {
          adapter(r.provider, r.region);
          if (
            id !== slot(r.provider, r.region) ||
            !validModel(r.model) ||
            !Array.isArray(r.models) ||
            !r.models.every(validModel) ||
            typeof r.encrypted !== "string"
          )
            throw new Error();
        }
        if (
          loaded.active &&
          !loaded.records[loaded.active.slot]?.models.includes(
            loaded.active.model,
          )
        )
          throw new Error();
        this.saved = loaded;
      } catch {
        this.loadError = true;
      }
    }
  }
  secure() {
    return (
      this.storage.isEncryptionAvailable() &&
      (!this.storage.getSelectedStorageBackend ||
        this.storage.getSelectedStorageBackend() !== "basic_text")
    );
  }
  guard() {
    if (!this.secure())
      throw new Error("הצפנה מאובטחת אינה זמינה. המפתח לא יישמר ולא יישלח.");
    if (this.loadError)
      throw new Error(
        "קובץ החיבור אינו תקין. נשמר ללא שינוי; נדרש שחזור מגיבוי.",
      );
    if (this.busy) throw new Error("בקשה אחרת עדיין מתבצעת");
  }
  active() {
    return this.saved.records[this.saved.active?.slot];
  }
  status() {
    const r = this.active();
    let connected = !!r && this.secure() && !this.loadError;
    if (connected) {
      try {
        this.key(r);
      } catch {
        connected = false;
      }
    }
    return {
      connected,
      provider: connected ? adapter(r.provider, r.region).label : null,
      providerId: connected ? r.provider : null,
      region: connected ? r.region : null,
      model: connected ? this.saved.active.model : null,
      encryptionAvailable: this.secure(),
      providers: catalog(),
      saved: Object.entries(this.saved.records).map(([id, r]) => ({
        slot: id,
        provider: r.provider,
        region: r.region,
        label: adapter(r.provider, r.region).label,
        models: r.models,
      })),
      loadError: this.loadError,
    };
  }
  key(r) {
    try {
      return this.storage.decryptString(Buffer.from(r.encrypted, "base64"));
    } catch {
      throw new Error(
        "לא ניתן לפענח מפתח שמור. הזינו מפתח חדש; הקובץ הקיים לא השתנה.",
      );
    }
  }
  // timeoutMs: 60 s default (discovery, connection test); tool-using steps pass a longer limit.
  async transport(a, key, url, body, signal, timeoutMs = 60000) {
    // URLs are generated by reviewed adapters only; no redirect can carry credentials.
    const allowed = new Set([
      new URL(a.base).origin,
      ...(a.listBase ? [new URL(a.listBase).origin] : []),
    ]);
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !allowed.has(parsed.origin) ||
      parsed.username ||
      parsed.password
    )
      throw new Error("יעד ספק אינו מורשה");
    let r;
    const timeout = AbortSignal.timeout(timeoutMs);
    const slow = () =>
      Object.assign(
        new Error("המודל לקח יותר מדי זמן — נסו לבקש פחות עמודים בכל פעם"),
        { kind: "timeout" },
      );
    try {
      r = await this.fetch(url, {
        method: body ? "POST" : "GET",
        redirect: "error",
        headers: headers(a, key),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (cause) {
      if (timeout.aborted && !signal?.aborted) throw slow();
      // fetch hides the reason in error.cause: keep the error CODE (never the message) so a certificate problem is visible.
      const code = String(cause?.cause?.code || cause?.code || "");
      const cert = diag.CERT_CODES.has(code);
      throw Object.assign(
        new Error(
          cert
            ? "אימות תעודת האבטחה (TLS) של הספק נכשל. ייתכן שתוכנת אנטי־וירוס או חומת אש מיירטת את חיבור ה־HTTPS."
            : `לא ניתן להגיע לספק (רשת / הפניה / מגבלת זמן: ${Math.round(timeoutMs / 1000)} שניות).`,
        ),
        { kind: "network", detail: code ? `קוד שגיאה: ${code}` : "" },
      );
    }
    if (!r.ok) {
      let detail = "";
      try {
        const raw = (await r.text()).slice(0, 4000);
        let msg = raw;
        try {
          const j = JSON.parse(raw);
          msg =
            j?.error?.message ??
            (typeof j?.error === "string" ? j.error : j?.message) ??
            raw;
        } catch {
          /* plain text body */
        }
        detail = redact(String(msg), key).slice(0, 1500);
      } catch {
        /* no body */
      }
      const error = new Error(
        `${a.label} החזיר ${Number(r.status)}. בדקו מפתח, אזור, הרשאות מודל ויתרה.`,
      );
      error.detail = detail;
      error.status = Number(r.status);
      error.kind = "http";
      throw error;
    }
    try {
      return await r.json();
    } catch {
      if (timeout.aborted && !signal?.aborted) throw slow();
      throw new Error("תשובה לא תקינה מהספק");
    }
  }
  async request(
    key,
    model,
    messages,
    validation = false,
    provider = "openai",
    region = "",
  ) {
    const a = adapter(provider, region),
      spec = generation(a, model, messages, validation);
    const result = await this.transport(a, key, spec.url, spec.body);
    const content = output(a, result);
    if (typeof content !== "string" || !content.trim())
      throw new Error(
        "המודל לא החזיר טקסט. ייתכן סינון תוכן, מגבלת טוקנים או מודל שאינו תומך בשיחה. לא ננסה שוב אוטומטית.",
      );
    return text(content, 100000);
  }
  async discover({ provider = "openai", region = "", key = "" } = {}) {
    this.guard();
    const a = adapter(provider, region);
    this.cancelDiscovery();
    const epoch = this.discoveryEpoch;
    if (!key) {
      const r = this.saved.records[slot(provider, region)];
      if (!r) throw new Error("בדקו מפתח API — אין מפתח שמור לספק ולאזור הזה");
      key = this.key(r);
    }
    if (
      typeof key !== "string" ||
      key.length < 10 ||
      key.length > 512 ||
      /\s/.test(key)
    )
      throw new Error("בדקו את מפתח ה־API");
    this.busy = true;
    try {
      let models = [],
        cursor = null;
      const seen = new Set();
      for (let page = 0; page < 20; page++) {
        const r = listed(a, await this.transport(a, key, listing(a, cursor)));
        if (epoch !== this.discoveryEpoch)
          throw new Error("טעינת המודלים בוטלה");
        models.push(
          ...r.models
            .filter((m) => validModel(m.id))
            .map((m) => ({
              id: m.id,
              label: typeof m.label === "string" ? m.label.slice(0, 200) : m.id,
            })),
        );
        cursor = r.next;
        if (!cursor) break;
        if (seen.has(String(cursor)) || page === 19)
          throw new Error(
            "רשימת המודלים לא הושלמה. נסו שוב; לא נשמרה רשימה חלקית.",
          );
        seen.add(String(cursor));
      }
      models = Array.from(new Map(models.map((m) => [m.id, m])).values());
      if (!models.length)
        throw new Error(
          "לא נמצאו מודלים מתאימים לשיחת טקסט במפתח ובאזור שנבחרו",
        );
      const token = randomUUID();
      this.pending = {
        token,
        key,
        provider,
        region,
        models,
        expires: Date.now() + 10 * 60 * 1000,
      };
      this.pendingTimer = setTimeout(
        () => this.cancelDiscovery(),
        10 * 60 * 1000,
      );
      this.pendingTimer.unref();
      return {
        token,
        models,
        source: "provider",
        note: "רשימה מהספק, לא אימות שיחה. התאמה והרשאות יאומתו רק בבדיקה באישורכם.",
      };
    } finally {
      this.busy = false;
    }
  }
  cancelDiscovery() {
    this.discoveryEpoch++;
    clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.pending = null;
  }
  async connect({ token, model, consent } = {}) {
    this.guard();
    if (consent !== true)
      throw new Error("נדרש אישור לבדיקה קצרה שעשויה לחייב את חשבון ה־API");
    const p = this.pending;
    if (!p || p.token !== token || p.expires < Date.now())
      throw new Error("טענו מחדש את רשימת המודלים");
    if (!p.models.some((m) => m.id === model))
      throw new Error("בחרו מודל מהרשימה שהוחזרה מהספק");
    this.busy = true;
    try {
      await this.request(
        p.key,
        model,
        [{ role: "user", content: "Reply with OK." }],
        true,
        p.provider,
        p.region,
      );
      // Closing/resetting the native dialog revokes this candidate even if
      // the already-authorized remote validation finishes later.
      if (this.pending !== p)
        throw new Error("החיבור בוטל. החיבור הקודם נשמר.");
      const id = slot(p.provider, p.region),
        old = this.saved.records[id];
      let same = false;
      if (old) {
        try {
          same = this.key(old) === p.key;
        } catch {}
      }
      let encrypted;
      try {
        encrypted = this.storage.encryptString(p.key).toString("base64");
      } catch {
        throw new Error("הצפנת המפתח נכשלה. החיבור הקודם נשמר.");
      }
      const record = {
        provider: p.provider,
        region: p.region,
        model,
        models: [...new Set([...(same ? old.models : []), model])],
        encrypted,
      };
      const next = {
        version: 2,
        active: { slot: id, model },
        records: { ...this.saved.records, [id]: record },
      };
      atomic(this.file, next);
      this.saved = next;
      this.cancelDiscovery();
      return this.status();
    } finally {
      this.busy = false;
    }
  }
  select({ slot: id, model, consent } = {}) {
    this.guard();
    if (consent !== true) throw new Error("נדרש אישור להחלפת המודל הפעיל");
    const r = this.saved.records[id];
    if (!r || !r.models.includes(model))
      throw new Error("המודל לא אומת. טענו רשימה ובדקו אותו בהגדרות.");
    this.key(r);
    const next = { ...this.saved, active: { slot: id, model } };
    atomic(this.file, next);
    this.saved = next;
    return this.status();
  }
  async step(messages, tools, signal) {
    this.guard();
    const r = this.active();
    if (!r) throw new Error("אין מודל מחובר");
    this.busy = true;
    try {
      const { toolGeneration, toolOutput } = require("./tool-adapters.cjs");
      const a = adapter(r.provider, r.region);
      const spec = toolGeneration(a, this.saved.active.model, messages, tools);
      return toolOutput(
        a,
        await this.transport(
          a,
          this.key(r),
          spec.url,
          spec.body,
          signal,
          300000,
        ),
      );
    } catch (e) {
      throw visionError(messages, e);
    } finally {
      this.busy = false;
    }
  }
  async reply(messages) {
    this.guard();
    const r = this.active();
    if (!r) throw new Error("אין מודל מחובר. חברו ספק כדי להתחיל.");
    this.busy = true;
    try {
      return await this.request(
        this.key(r),
        this.saved.active.model,
        messages,
        false,
        r.provider,
        r.region,
      );
    } catch (e) {
      throw visionError(messages, e);
    } finally {
      this.busy = false;
    }
  }
  disconnect() {
    this.guard();
    const records = { ...this.saved.records };
    delete records[this.saved.active?.slot];
    const next = { version: 2, active: null, records };
    atomic(this.file, next);
    this.saved = next;
    this.cancelDiscovery();
    return this.status();
  }
}
module.exports = { Provider };
