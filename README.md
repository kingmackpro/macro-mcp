# macro-mcp

Cloudflare-hosted MCP server for Android control through MacroDroid webhooks and optional Termux:Tasker scripts.

## Architecture

`MCP client → Cloudflare Worker (/mcp) → Durable Object broker → MacroDroid webhook → Android actions / Termux:Tasker → HTTPS callback → broker → MCP result`

The phone does not host a server. Cloudflare hosts the MCP endpoint and correlates asynchronous device results.

## Repository

- `src/index.ts` — Worker entrypoint, MCP endpoint and device callback API
- `src/device-broker.ts` — Durable Object for pending command correlation
- `src/tools.ts` — MCP tool definitions and input validation
- `docs/macrodroid-setup.md` — MacroDroid webhook and callback setup
- `docs/protocol.md` — HTTP payload contract
- `wrangler.jsonc` — Worker and Durable Object configuration

## Development

Requires Node.js 20+.

```bash
npm install
npm run typecheck
npm run dev
```

Before deploying, configure secrets:

```bash
npx wrangler secret put MACRO_WEBHOOK_URL
npx wrangler secret put DEVICE_TOKEN
npx wrangler secret put MCP_TOKEN
npm run deploy
```

Connect MCP clients to `https://<worker-subdomain>.workers.dev/mcp` using the bearer token.

## Security

- Protect MCP and device callbacks with separate bearer tokens.
- Store the MacroDroid webhook URL and tokens as Worker secrets.
- Require callback `request_id` correlation.
- Use an allowlist of Termux scripts; raw shell commands are not exposed.
- Treat device data and command output as private.

## Status

Initial implementation scaffold. Validate the MacroDroid variable substitution and webhook configuration against the installed MacroDroid version before using live commands.
