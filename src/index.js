import { DeviceBroker } from "./device-broker.js";
import { TOOLS, validateToolArguments, actionForTool } from "./tools.js";

export { DeviceBroker };

const SERVER_INFO = { name: "macro-mcp", version: "0.2.0" };
const CURRENT_PROTOCOL = "2026-07-28";
const LEGACY_PROTOCOLS = new Set(["2025-11-25", "2025-06-18", "2025-03-26"]);
const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}

function rpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id: id === undefined ? null : id,
    error: { code, message, ...(data === undefined ? {} : { data }) }
  };
}

function authorized(request, token) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const supplied = match?.[1] ?? "";
  if (!supplied || !token || supplied.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) {
    diff |= supplied.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

function getBroker(env) {
  return env.BROKER.get(env.BROKER.idFromName("primary-device"));
}

function decodeMirroredHeader(value) {
  if (value === null) return null;
  const match = /^=\?base64\?([A-Za-z0-9+/]+={0,2})\?=$/.exec(value);
  if (!match) return value;
  try {
    const binary = atob(match[1]);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function validateModernRequest(request, message) {
  const version = request.headers.get("mcp-protocol-version");
  if (!version) return null;

  if (version === CURRENT_PROTOCOL) {
    const params = message.params ?? {};
    const metaVersion = params?._meta?.[META_PROTOCOL_VERSION];
    const methodHeader = request.headers.get("mcp-method");
    const nameHeader = request.headers.get("mcp-name");

    if (metaVersion !== version || methodHeader !== message.method) {
      return {
        status: 400,
        body: rpcError(message.id, -32020, "Required MCP request headers do not match the JSON-RPC body.")
      };
    }

    if (message.method === "tools/call") {
      const expectedName = typeof params.name === "string" ? params.name : null;
      if (!expectedName || decodeMirroredHeader(nameHeader) !== expectedName) {
        return {
          status: 400,
          body: rpcError(message.id, -32020, "Mcp-Name header is missing or does not match params.name.")
        };
      }
    }

    const accept = request.headers.get("accept") ?? "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
      return {
        status: 400,
        body: rpcError(message.id, -32020, "Accept must include application/json and text/event-stream.")
      };
    }
    return null;
  }

  if (LEGACY_PROTOCOLS.has(version)) return null;

  return {
    status: 400,
    body: rpcError(message.id, -32000, "Unsupported MCP protocol version.", {
      supported: [CURRENT_PROTOCOL, ...LEGACY_PROTOCOLS]
    })
  };
}

function toolResponse(text, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

function resultText(result) {
  if (result?.data !== undefined) return JSON.stringify(result.data);
  if (result?.output !== undefined) return String(result.output);
  return JSON.stringify(result);
}

async function callDeviceTool(name, args, env) {
  let parameters;
  try {
    parameters = validateToolArguments(name, args);
  } catch (error) {
    return toolResponse(error instanceof Error ? error.message : "Invalid tool arguments.", true);
  }

  if (name === "get_command_result") {
    const response = await getBroker(env).fetch(
      `https://broker.internal/result?request_id=${encodeURIComponent(parameters.request_id)}`
    );
    const body = await response.json().catch(() => ({ error: "Invalid broker response." }));
    if (response.status === 200 && body.result) {
      return toolResponse(resultText(body.result), !body.result.success);
    }
    if (response.status === 202) {
      return toolResponse(JSON.stringify(body));
    }
    return toolResponse(JSON.stringify(body), true);
  }

  const requestId = crypto.randomUUID();
  const stub = getBroker(env);
  const dispatchResponse = await stub.fetch("https://broker.internal/dispatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      request_id: requestId,
      action: actionForTool(name),
      parameters
    })
  });

  if (!dispatchResponse.ok && dispatchResponse.status !== 202) {
    const message = await dispatchResponse.text();
    return toolResponse(message || "Device command could not be dispatched.", true);
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const resultResponse = await stub.fetch(
      `https://broker.internal/result?request_id=${encodeURIComponent(requestId)}`
    );

    if (resultResponse.status === 200) {
      const body = await resultResponse.json();
      return toolResponse(resultText(body.result), !body.result.success);
    }
    if (resultResponse.status !== 202) {
      const message = await resultResponse.text();
      return toolResponse(message || "The device request expired or was not found.", true);
    }
  }

  return toolResponse(JSON.stringify({
    accepted: true,
    pending: true,
    request_id: requestId,
    message: "The phone has not replied yet. Use get_command_result with this request_id."
  }));
}

async function processRpc(message, env) {
  if (!message || typeof message !== "object" || Array.isArray(message) ||
      message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return { status: 400, body: rpcError(message?.id, -32600, "Invalid JSON-RPC request.") };
  }

  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  const params = message.params ?? {};
  if (params !== undefined && (params === null || typeof params !== "object" || Array.isArray(params))) {
    return { status: 400, body: rpcError(message.id, -32602, "params must be an object.") };
  }

  if (!hasId) {
    if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") {
      return { status: 202, notification: true };
    }
    return { status: 202, notification: true };
  }

  if (message.method === "initialize") {
    const requested = params.protocolVersion;
    const negotiated = requested === CURRENT_PROTOCOL || LEGACY_PROTOCOLS.has(requested)
      ? requested
      : CURRENT_PROTOCOL;
    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: negotiated,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: "Android commands are dispatched through the paired MacroDroid macro. Configure the Worker secrets before calling device tools."
        }
      }
    };
  }

  if (message.method === "ping") {
    return { status: 200, body: { jsonrpc: "2.0", id: message.id, result: {} } };
  }

  if (message.method === "tools/list") {
    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: message.id,
        result: { tools: TOOLS }
      }
    };
  }

  if (message.method === "tools/call") {
    if (typeof params.name !== "string") {
      return { status: 200, body: { jsonrpc: "2.0", id: message.id, result: toolResponse("Tool name is required.", true) } };
    }
    const result = await callDeviceTool(params.name, params.arguments ?? {}, env);
    return { status: 200, body: { jsonrpc: "2.0", id: message.id, result } };
  }

  return {
    status: 404,
    body: rpcError(message.id, -32601, `Method not found: ${message.method}`)
  };
}

async function handleMcp(request, env) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Origin not allowed." } }, 403);
      }
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Invalid Origin header." } }, 403);
    }
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed. Use POST for MCP requests." }, 405, { allow: "POST" });
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Content-Type must be application/json." } }, 415);
  }

  const raw = await request.text();
  if (raw.length > 65536) return json({ error: "Request body is too large." }, 413);

  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return json(rpcError(null, -32700, "Parse error."), 400);
  }

  const headerError = validateModernRequest(request, message);
  if (headerError) return json(headerError.body, headerError.status);

  const response = await processRpc(message, env);
  if (response.notification) return new Response(null, { status: 202 });
  return json(response.body, response.status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        ok: true,
        service: SERVER_INFO.name,
        version: SERVER_INFO.version,
        endpoint: "/mcp",
        device_bridge_configured: Boolean(env.MACRO_WEBHOOK_URL && env.DEVICE_TOKEN)
      });
    }

    if (url.pathname === "/device/result" && request.method === "POST") {
      if (!env.DEVICE_TOKEN) return json({ error: "Device callback is not configured." }, 503);
      if (!authorized(request, env.DEVICE_TOKEN)) return json({ error: "Unauthorized" }, 401);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          typeof body.request_id !== "string" ||
          body.request_id.length < 10 ||
          body.request_id.length > 80 ||
          typeof body.success !== "boolean") {
        return json({ error: "Invalid device result." }, 400);
      }

      return getBroker(env).fetch("https://broker.internal/result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
    }

    if (url.pathname === "/mcp") {
      if (!env.MCP_TOKEN) return json({ error: "MCP_TOKEN secret is not configured." }, 503);
      if (!authorized(request, env.MCP_TOKEN)) return json({ error: "Unauthorized" }, 401);
      return handleMcp(request, env);
    }

    return json({ error: "Not found" }, 404);
  }
};
