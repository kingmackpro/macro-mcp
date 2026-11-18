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

export class DeviceBroker {
  private state: DurableObjectState;
  private env: { MACRO_WEBHOOK_URL: string; DEVICE_TOKEN: string };

  constructor(state: DurableObjectState, env: { MACRO_WEBHOOK_URL: string; DEVICE_TOKEN: string }) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/dispatch") return this.dispatch(request);
    if (request.method === "POST" && url.pathname === "/result") return this.acceptResult(request);
    if (request.method === "GET" && url.pathname === "/result") {
      const id = url.searchParams.get("request_id");
      if (!id) return json({ error: "request_id is required" }, 400);
      const result = await this.state.storage.get<DeviceResult>(`result:${id}`);
      return result ? json({ result }) : json({ pending: true }, 202);
    }
    return json({ error: "Not found" }, 404);
  }

  private async dispatch(request: Request): Promise<Response> {
    const body = await request.json<CommandEnvelope>();
    if (!body.request_id || !body.action) return json({ error: "Invalid command" }, 400);
    if (await this.state.storage.get(`pending:${body.request_id}`) || await this.state.storage.get(`result:${body.request_id}`)) {
      return json({ error: "Duplicate request_id" }, 409);
    }
    await this.state.storage.put(`pending:${body.request_id}`, body, { expirationTtl: 300 });
    const response = await fetch(this.env.MACRO_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-token": this.env.DEVICE_TOKEN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) {
      await this.state.storage.delete(`pending:${body.request_id}`);
      return json({ error: "MacroDroid webhook rejected command", status: response.status }, 502);
    }
    return json({ accepted: true, request_id: body.request_id }, 202);
  }

  private async acceptResult(request: Request): Promise<Response> {
    const body = await request.json<DeviceResult>();
    if (!body.request_id || typeof body.success !== "boolean") return json({ error: "Invalid device result" }, 400);
    const pending = await this.state.storage.get<CommandEnvelope>(`pending:${body.request_id}`);
    if (!pending) return json({ error: "Unknown or expired request_id" }, 404);
    await this.state.storage.put(`result:${body.request_id}`, body, { expirationTtl: 300 });
    await this.state.storage.delete(`pending:${body.request_id}`);
    return json({ accepted: true });
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}