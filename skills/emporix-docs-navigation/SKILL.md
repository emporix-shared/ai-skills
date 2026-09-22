---
name: emporix-docs-navigation
description: >-
  Find, read, and verify answers in the Emporix documentation from primary
  sources. Use when answering any question about Emporix APIs or platform
  behavior, locating the right documentation page or OpenAPI spec, checking
  whether platform behavior changed recently, or when a documentation URL
  unexpectedly returns "Page Not Found".
license: CC-BY-4.0
metadata:
  validated: 2026-07-10 claude-code ticket-12 (pre-GitHub; PR link when repo is public)
  # Grounded on docs surfaces (llms.txt / .md pages / ?ask= API / docs MCP)
  # and the changelog — no OpenAPI spec. Changelog-only drift checking.
  sources: []
  drift-checked: doc-2026071011 changelog 2026-07-12
---

# Navigating the Emporix documentation

All Emporix documentation lives on one portal, `https://developer.emporix.io`,
and the portal is deliberately machine-readable: every page has a raw-markdown
variant, the whole site is indexed for agents, and any page can be queried
with a question. The API-reference section is rendered directly from the
public GitHub repo `emporix/api-references` (OpenAPI specs + guides), so spec
and portal cannot diverge — but the portal is a *superset* of that repo, and
the platform moves faster than prose docs. Answering from the right surface,
then checking the changelog, is what separates a verified answer from a
plausible one.

## Tenant prerequisites

- None. This skill needs only outbound HTTPS — no tenant, no credentials.
- Optional: an MCP-capable agent, for the documentation MCP server route.

## Which surface answers which question?

| You need | Use | How |
|---|---|---|
| To find where a topic is documented | `https://developer.emporix.io/llms.txt` | Full page index (title + URL + description per page) organized by product area. It is large (~1,250 lines) — search/grep it rather than reading it linearly. Pick pages from it; it contains no content itself. |
| The content of a known page | The page URL + `.md` | Append `.md` to any portal URL for raw markdown, e.g. `https://developer.emporix.io/api-references/quickstart/list-of-api-services.md`. |
| A direct answer to a "how do I…" question | The ask API | `GET <any portal .md URL>?ask=<question>&goal=<end goal>` returns a synthesized answer with a Sources list and follow-up `?ask=` URLs. |
| Search when your agent supports MCP | The documentation MCP server | `https://developer.emporix.io/~gitbook/mcp` (Streamable HTTP, no auth). Tools: `searchDocumentation(query)`, `getPage(url)`. |
| Exact API facts: endpoints, parameters, schemas, scopes, status codes | The OpenAPI spec | One `api.yml` per service in `github.com/emporix/api-references`, raw-fetchable: `https://raw.githubusercontent.com/emporix/api-references/main/{service-path}/api-reference/api.yml`. |
| "Has this changed recently?" | The changelog | `https://developer.emporix.io/changelog/changelog.md` (see below). |
| Bulk ingestion of the whole docs corpus | `llms-full.txt` | `https://developer.emporix.io/llms-full.txt`, paginated (`/llms-full.txt/1`, …; each chunk ends with a Next Page pointer). Rarely the right tool for a single question. |

Typical flow for a question you cannot answer from memory: llms.txt (or
`searchDocumentation`) to locate candidate pages → fetch the pages as `.md` →
if the answer still is not explicit, ask the API with a specific question →
for any operative API claim, confirm against the service's `api.yml` → check
the changelog before asserting behavior in anything durable.

## Reading portal pages as an agent

- Every `.md` page carries a header linking back to `llms.txt` and a trailing
  **Agent Instructions** block that documents the ask API for that page — the
  portal tells you how to query it.
- The ask API's `ask` parameter should be a specific, self-contained natural
  language question; the optional `goal` describes what you are ultimately
  trying to accomplish and tailors the answer. The response is generated:
  treat it as a *lead*, and cite the pages from its **Sources** list — not the
  synthesized text — as your evidence.
- The documentation MCP server's `searchDocumentation` returns excerpts with
  page links; follow up with `getPage` (or the `.md` URL) for full content.

## Exact API facts come from the spec, not prose

For anything enumerable — endpoint paths, request/response schemas, required
parameters, status codes, OAuth scopes — read the service's OpenAPI spec and
never guess from guide prose:

- Raw spec: `https://raw.githubusercontent.com/emporix/api-references/main/{service-path}/api-reference/api.yml`.
  The `{service-path}` mirrors the portal URL: in a portal API-reference URL,
  the path segment after `/api-references/api-guides/` is the repo path (e.g.
  portal `…/api-guides/products-labels-and-brands/product-service/…` → repo
  `products-labels-and-brands/product-service/api-reference/api.yml`). The
  same content renders as the portal's interactive API reference pages.
- Each operation's `security` block lists the exact OAuth scopes it accepts;
  scope naming is not uniform across services, so read it per endpoint (the
  `emporix-auth` skill covers token and scope handling).
- The repo publishes `doc-YYYYMMDDHH` GitHub releases with an
  `api-references.zip` asset several times a day — use a release (or a clone)
  when you need many specs at once.

## Verifying freshness: the changelog

Documentation prose can lag the platform; the changelog is the freshness
authority. `https://developer.emporix.io/changelog/changelog.md` is a year
index; follow the year link to dated entries, newest first, each naming the
service, the change, and the affected endpoints. The year pages nest under a
repeated path segment — e.g. the 2026 page is
`https://developer.emporix.io/changelog/changelog/changelog.md` — which looks
like a typo but is the real URL.
Check it whenever a question implies time ("has this changed?", "why does
this behave differently than the guide says?") and before asserting platform
behavior in code, integrations, or documentation of your own. Release notes
(indexed in llms.txt under Product Features) give the feature-level view of
the same history.

## Pitfalls

- **Missing pages return HTTP 200, not 404.** A nonexistent portal URL
  returns a normal page whose markdown body starts with `# Page Not Found`
  (plus suggested alternatives). Always check the body content, never the
  status code, before treating a fetch as evidence — a claim "supported" by a
  soft-404 page is unsupported.
- **The portal is a superset of the `api-references` repo.** Commerce Engine
  guides, the Orchestration Engine, Agentic Commerce Intelligence (including
  the hosted Emporix MCP Server docs), the B2B Commerce Frontend, and the
  Partner Library exist only on the portal. Never conclude "undocumented"
  from the repo alone — check llms.txt.
- **The hosted Emporix MCP server is not a docs source.** Anything under
  `https://api.emporix.io/mcp/...` exposes runtime commerce tools against a
  tenant (products, orders, …) and needs a tenant-specific token (see
  `emporix-auth`). For documentation, use the surfaces above; only
  `developer.emporix.io/~gitbook/mcp` serves docs.
- **llms.txt is an index, not content.** Citing llms.txt proves a page
  exists, not what it says — fetch the page itself.

## Verify

After answering a question using this skill, prove the answer is grounded:

1. **Every operative claim cites a resolvable primary source** — a
   `developer.emporix.io/....md` page URL or a raw `api-references` spec URL.
   Fetch each cited URL: expect HTTP 200 **and** a body that is real content,
   not one starting with `# Page Not Found`.
2. **The cited content supports the claim.** The asserted fact (endpoint,
   parameter, limit, behavior) appears in the fetched body verbatim or
   unambiguously. An ask-API answer alone does not count — its Sources pages
   do.
3. **The soft-404 is distinguishable.** Fetch a deliberately wrong URL, e.g.
   `https://developer.emporix.io/api-references/quickstart/does-not-exist.md`:
   expect HTTP 200 with a `# Page Not Found` body. If you cannot tell this
   response apart from your evidence pages, your check in step 1 is broken.
4. **The changelog was consulted.** Name the changelog page checked and the
   date of the newest entry relevant to the topic — or state explicitly that
   no relevant entry exists.
