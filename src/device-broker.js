import { DurableObject } from "cloudflare:workers";

const RECORD_TTL_MS = 5 * 60 * 1000;
const ALLOWED_ACTIONS = new Set([
  "ping",
  "get_battery",
  "get_device_info",
  "set_volume",
  "set_brightness",
  "launch_app",
  "termux_script"
]);

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class DeviceBroker extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/dispatch") {
      return this.dispatch(request);
    }
    if (request.method === "POST" && url.pathname === "/result") {
      return this.acceptResult(request);
    }
    if (request.method === "GET" && url.pathname === "/result") {
      return this.getResult(url);
    }
    return json({ error: "Not found" }, 404);
  }

  async alarm() {
    const now = Date.now();
    const records = await this.ctx.storage.list();
    let nextExpiry = Number.POSITIVE_INFINITY;

    for (const [key, record] of records) {
      if (!record || typeof record.expiresAt !== "number" || record.expiresAt <= now) {
        await this.ctx.storage.delete(key);
      } else {
        nextExpiry = Math.min(nextExpiry, record.expiresAt);
      }
    }

    if (Number.isFinite(nextExpiry)) {
      await this.ctx.storage.setAlarm(nextExpiry);
    }
  }

  async readRecord(key) {
    const record = await this.ctx.storage.get(key);
    if (!record) return undefined;
    if (record.expiresAt <= Date.now()) {
      await this.ctx.storage.delete(key);
      return undefined;
    }
    return record.value;
  }

  async writeRecord(key, value) {
    const expiresAt = Date.now() + RECORD_TTL_MS;
    await this.ctx.storage.put(key, { value, expiresAt });
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || expiresAt < currentAlarm) {
      await this.ctx.storage.setAlarm(expiresAt);
    }
  }

  async dispatch(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (!isObject(body) ||
        typeof body.request_id !== "string" ||
        body.request_id.length < 10 ||
        body.request_id.length > 80 ||
        typeof body.action !== "string" ||
        !ALLOWED_ACTIONS.has(body.action) ||
        !isObject(body.parameters)) {
      return json({ error: "Invalid command" }, 400);
    }

    if (!this.env.MACRO_WEBHOOK_URL || !this.env.DEVICE_TOKEN) {
      return json({
        error: "Device bridge is not configured. Add the MACRO_WEBHOOK_URL secret and DEVICE_TOKEN secret."
      }, 503);
    }

    let webhook;
    try {
      webhook = new URL(this.env.MACRO_WEBHOOK_URL);
    } catch {
      return json({ error: "MACRO_WEBHOOK_URL is not a valid URL." }, 503);
    }
    if (webhook.protocol !== "https:" || webhook.username || webhook.password) {
      return json({ error: "MACRO_WEBHOOK_URL must be an HTTPS URL without embedded credentials." }, 503);
    }

    const pendingKey = `pending:${body.request_id}`;
    const resultKey = `result:${body.request_id}`;
    if (await this.readRecord(pendingKey) || await this.readRecord(resultKey)) {
      return json({ error: "Duplicate request_id" }, 409);
    }

    await this.writeRecord(pendingKey, body);

    try {
      const response = await fetch(webhook.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-token": this.env.DEVICE_TOKEN
        },
        body: JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        await this.ctx.storage.delete(pendingKey);
        return json({
          error: response.status >= 300 && response.status < 400
            ? "MacroDroid webhook returned a redirect; use its final HTTPS URL."
            : "MacroDroid webhook rejected the command.",
          status: response.status
        }, 502);
      }
    } catch {
      await this.ctx.storage.delete(pendingKey);
      return json({ error: "Could not reach the MacroDroid webhook." }, 502);
    }

    return json({ accepted: true, request_id: body.request_id }, 202);
  }

  async acceptResult(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (!isObject(body) ||
        typeof body.request_id !== "string" ||
        body.request_id.length < 10 ||
        body.request_id.length > 80 ||
        typeof body.success !== "boolean") {
      return json({ error: "Invalid device result" }, 400);
    }

    const pendingKey = `pending:${body.request_id}`;
    if (!await this.readRecord(pendingKey)) {
      return json({ error: "Unknown or expired request_id" }, 404);
    }

    const result = {
      request_id: body.request_id,
      success: body.success,
      ...(body.output === undefined ? {} : { output: String(body.output).slice(0, 12000) }),
      ...(body.data === undefined ? {} : { data: body.data }),
      ...(body.error === undefined ? {} : { error: String(body.error).slice(0, 2000) })
    };

    await this.writeRecord(`result:${body.request_id}`, result);
    await this.ctx.storage.delete(pendingKey);
    return json({ accepted: true });
  }

  async getResult(url) {
    const id = url.searchParams.get("request_id");
    if (!id || id.length < 10 || id.length > 80) {
      return json({ error: "A valid request_id is required." }, 400);
    }

    const result = await this.readRecord(`result:${id}`);
    if (result) return json({ result });

    const pending = await this.readRecord(`pending:${id}`);
    if (pending) return json({ pending: true, request_id: id }, 202);

    return json({ error: "Unknown or expired request_id." }, 404);
  }
}
