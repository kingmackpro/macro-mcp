interface CommandEnvelope {
  request_id: string;
  action: string;
  parameters: Record<string, unknown>;
}

interface DeviceResult {
  request_id: string;
  success: boolean;
  output?: string;
  data?: unknown;
  error?: string;
}

interface BrokerEnv {
  MACRO_WEBHOOK_URL: string;
  DEVICE_TOKEN: string;
}

export class DeviceBroker {
  private state: DurableObjectState;
  private env: BrokerEnv;

  constructor(state: DurableObjectState, env: BrokerEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/dispatch") {
      return this.dispatch(request);
    }
    if (request.method === "POST" && url.pathname === "/result") {
      return this.acceptResult(request);
    }
    if (request.method === "GET" && url.pathname === "/result") {
      const id = url.searchParams.get("request_id");
      if (!id) return json({ error: "request_id is required" }, 400);

      const result = await this.state.storage.get<DeviceResult>(`result:${id}`);
      return result ? json({ result }) : json({ pending: true }, 202);
    }

    return json({ error: "Not found" }, 404);
  }

  private async dispatch(request: Request): Promise<Response> {
    let body: CommandEnvelope;
    try {
      body = await request.json() as CommandEnvelope;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (
      !body ||
      typeof body.request_id !== "string" ||
      body.request_id.length < 10 ||
      body.request_id.length > 80 ||
      typeof body.action !== "string" ||
      !body.action ||
      typeof body.parameters !== "object" ||
      body.parameters === null ||
      Array.isArray(body.parameters)
    ) {
      return json({ error: "Invalid command" }, 400);
    }

    if (!this.env.MACRO_WEBHOOK_URL || !this.env.DEVICE_TOKEN) {
      return json({
        error: "Device bridge is not configured. Set MACRO_WEBHOOK_URL and DEVICE_TOKEN."
      }, 503);
    }

    const pendingKey = `pending:${body.request_id}`;
    const resultKey = `result:${body.request_id}`;
    if (
      await this.state.storage.get(pendingKey) ||
      await this.state.storage.get(resultKey)
    ) {
      return json({ error: "Duplicate request_id" }, 409);
    }

    await this.state.storage.put(pendingKey, body, { expirationTtl: 300 });

    try {
      const response = await fetch(this.env.MACRO_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-token": this.env.DEVICE_TOKEN
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        await this.state.storage.delete(pendingKey);
        return json({
          error: "MacroDroid webhook rejected command",
          status: response.status
        }, 502);
      }
    } catch {
      await this.state.storage.delete(pendingKey);
      return json({ error: "Could not reach the MacroDroid webhook" }, 502);
    }

    return json({ accepted: true, request_id: body.request_id }, 202);
  }

  private async acceptResult(request: Request): Promise<Response> {
    let body: DeviceResult;
    try {
      body = await request.json() as DeviceResult;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (
      !body ||
      typeof body.request_id !== "string" ||
      typeof body.success !== "boolean"
    ) {
      return json({ error: "Invalid device result" }, 400);
    }

    const pendingKey = `pending:${body.request_id}`;
    const pending = await this.state.storage.get<CommandEnvelope>(pendingKey);
    if (!pending) {
      return json({ error: "Unknown or expired request_id" }, 404);
    }

    await this.state.storage.put(
      `result:${body.request_id}`,
      body,
      { expirationTtl: 300 }
    );
    await this.state.storage.delete(pendingKey);
    return json({ accepted: true });
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
