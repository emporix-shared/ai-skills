# Connecting the Emporix MCP servers

Emporix exposes two MCP servers. This repo pre-wires both in its bundled MCP
configs — [`.mcp.json`](../../.mcp.json) (Claude Code) and
[`mcp.json`](../../mcp.json) (Cursor plugin). This guide is the Claude-family
setup walkthrough the platform docs don't yet publish.

## 1. Emporix docs MCP (no auth)

A read-only documentation server — no token required.

| | |
|---|---|
| URL | `https://developer.emporix.io/~gitbook/mcp` |
| Transport | Streamable HTTP |
| Auth | none |
| Tools | `searchDocumentation(query)`, `getPage(url)` |

In Claude Code this connects automatically when the plugin is installed or when
you work inside a clone of this repo. Use it to search and read the Emporix docs
from primary sources (see the `emporix-docs-navigation` skill).

## 2. Emporix hosted platform MCP (tenant token required)

Runtime commerce tools against a live tenant — **pre-wired with placeholders**;
supply your own values.

| | |
|---|---|
| URL | `https://api.emporix.io/mcp/{domain}/{TENANT}/{MCP_TOKEN}/mcp` |
| Transport | Streamable HTTP |
| Auth | tenant + MCP token, embedded in the path (scope-gated) |
| Domains | `product`, `order`, `customer`, `extensibility`, `frontend-facing` |
| Filtering | optional `?tools=` query to narrow the exposed tool set |

The bundled configs express this entry with environment-variable placeholders:

```json
"emporix-platform": {
  "type": "http",
  "url": "https://api.emporix.io/mcp/${EMPORIX_MCP_DOMAIN}/${EMPORIX_TENANT}/${EMPORIX_MCP_TOKEN}/mcp"
}
```

Set these before launching your agent (one domain per connection):

```bash
export EMPORIX_MCP_DOMAIN=product          # or order | customer | extensibility | frontend-facing
export EMPORIX_TENANT=<your-tenant>
export EMPORIX_MCP_TOKEN=<your-mcp-token>
```

Until the variables are set the server stays inert (it cannot authenticate) — the
docs MCP is unaffected. To connect more than one domain at once, add additional
entries with distinct names (e.g. `emporix-platform-order`).

> The platform MCP exposes **runtime** commerce operations against a real tenant,
> not documentation. Choose the narrowest domain and scopes you need.
