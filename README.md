# macro-mcp

Cloudflare-hosted MCP server for Android control through MacroDroid webhooks and optional Termux:Tasker scripts.

## Architecture

`MCP client → Cloudflare Worker (/mcp) → Durable Object broker → MacroDroid webhook → Android actions / Termux:Tasker → HTTPS callback → broker → MCP result`

The phone does not host a server. Cloudflare hosts the MCP endpoint and correlates asynchronous device results.

## Repository

- `src/index.ts` — Worker entrypoint, MCP Streamable HTTP endpoint and authenticated device callback API
- `src/device-broker.ts` — Durable Object for webhook dispatch and pending-result correlation
- `src/tools.ts` — Zod-backed MCP tool definitions and argument validation
- `docs/macrodroid-setup.md` — MacroDroid webhook and callback setup
- `docs/protocol.md` — HTTP payload contract
- `wrangler.jsonc` — Worker and Durable Object configuration

## Development

Requires Node.js 20+.

```bash
npm install
npm run build
npm run dev
```

## Required Worker secrets

Configure these secrets in the Cloudflare Worker before using device tools:

```bash
npx wrangler secret put MACRO_WEBHOOK_URL
npx wrangler secret put DEVICE_TOKEN
npx wrangler secret put MCP_TOKEN
```

- `MACRO_WEBHOOK_URL` — the MacroDroid webhook URL
- `DEVICE_TOKEN` — shared by the Worker and MacroDroid for webhook authentication and callback authorization
- `MCP_TOKEN` — bearer token used by MCP clients

Then deploy with:

```bash
npm run deploy
```

Connect MCP clients to `https://<worker-subdomain>.workers.dev/mcp` using `Authorization: Bearer <MCP_TOKEN>`.

The public health endpoint is `GET /health`. Device callbacks use `POST /device/result`.

## Device response behavior

A tool call waits briefly for the phone's callback. If the phone has not replied yet, the tool returns a `request_id` with `pending: true`; call `get_command_result` with that ID to retrieve the result later. Polling is intentionally bounded to keep Durable Object subrequests within Workers Free-plan limits.

## Security

- Protect MCP and device callbacks with separate bearer tokens.
- Store the MacroDroid webhook URL and tokens as Worker secrets, never in source control.
- Require callback `request_id` correlation.
- Use an allowlist of Termux scripts; raw shell commands are not exposed.
- Treat device data and command output as private.

## Status

The Worker/MCP implementation is in place, but the Android side still requires the MacroDroid macro described in `docs/macrodroid-setup.md`. Verify variable substitution and the webhook configuration against the installed MacroDroid version before using live commands.
