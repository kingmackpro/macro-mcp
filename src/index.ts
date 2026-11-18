import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { TOOLS } from "./tools";
import { DeviceBroker } from "./device-broker";

export { DeviceBroker };

interface Env {
  BROKER: DurableObjectNamespace<DeviceBroker>;
  MCP_TOKEN: string;
  DEVICE_TOKEN: string;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function authorized(request: Request, token: string): boolean {
  const value = request.headers.get("authorization")?.replace(/^Bearer\\s+/i, "") ?? "";
  if (!value || !token || value.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < value.length; i++) diff |= value.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
function getBroker(env: Env): DurableObjectStub<DeviceBroker> {
  return env.BROKER.get(env.BROKER.idFromName("primary-device"));
}

async function mcp(request: Request, env: Env): Promise<Response> {
  const server = new McpServer({ name: "macro-mcp", version: "0.1.0" });
  const origin = new URL(request.url).origin;

  for (const tool of TOOLS) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema as never }, async (input) => {
      let parameters: Record<string, unknown>;
      try { parameters = tool.validate(input); }
      catch (error) {
        return { isError: true, content: [{ type: "text", text: `Invalid arguments: ${error instanceof Error ? error.message : "validation failed"}` }] };
      }
      const requestId = randomUUID();
      const stub = getBroker(env);
      const dispatched = await stub.fetch("https://broker.internal/dispatch", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ request_id: requestId, action: tool.action, parameters })
      });
      if (!dispatched.ok && dispatched.status !== 202) return { isError: true, content: [{ type: "text", text: await dispatched.text() }] };

      const deadline = Date.now() + 18000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 350));
        const resultResponse = await stub.fetch(`https://broker.internal/result?request_id=${requestId}`);
        if (resultResponse.status === 200) {
          const value = await resultResponse.json<{ result: DeviceResult }>();
          return { isError: !value.result.success, content: [{ type: "text", text: JSON.stringify(value.result.data ?? value.result.output ?? value.result) }] };
        }
      }
      return { content: [{ type: "text", text: JSON.stringify({ accepted: true, pending: true, request_id: requestId, message: "Device response is still pending." }) }] };
    });
  }

  server.registerTool("get_command_result", {
    description: "Retrieve the result of a previously dispatched phone command.",
    inputSchema: { request_id: { type: "string", minLength: 10, maxLength: 80 } }
  }, async ({ request_id }) => {
    if (typeof request_id !== "string") return { isError: true, content: [{ type: "text", text: "request_id is required" }] };
    const response = await getBroker(env).fetch(`https://broker.internal/result?request_id=${encodeURIComponent(request_id)}`);
    return { content: [{ type: "text", text: await response.text() }] };
  });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}

interface DeviceResult {
  request_id: string; success: boolean; output?: string; data?: unknown; error?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "macro-mcp", version: "0.1.0" });

    if (url.pathname === "/device/result" && request.method === "POST") {
      if (!authorized(request, env.DEVICE_TOKEN)) return json({ error: "Unauthorized" }, 401);
      const body = await request.json();
      return getBroker(env).fetch("https://broker.internal/result", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
      });
    }
    if (url.pathname === "/mcp") {
      if (!authorized(request, env.MCP_TOKEN)) return json({ error: "Unauthorized" }, 401);
      if (!["POST", "GET", "DELETE"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
      return mcp(request, env);
    }
    return json({ error: "Not found" }, 404);
  }
};