---
name: emporix-storefront
description: >-
  Develop, run, and deploy the Emporix Journey Aware Storefront (the productized
  B2B Commerce Frontend / emporix-showcase) — a Next.js 16 + React 19 headless
  storefront. Use when working in the storefront codebase: running it locally,
  customizing pages/components/routing, the three-layer Integration/Service/
  Repository architecture and InversifyJS DI, the [site]/[locale] layout groups,
  the brand/alias/mapped design-token system, checkout/auth, or deploying to
  Vercel / Cloud Run / Kubernetes / Azure. Reach for it on storefront symptoms:
  a blank page or 401 on first load, /api/ready returning 503, ERR_TOO_MANY_
  REDIRECTS after deploy, "x-middleware-rewrite to /main/...", CSS tokens not
  resolving, or platform-layer edits not hot-reloading. Not for Emporix REST API
  scopes/tokens (emporix-auth), data modeling/mixins (emporix-extensibility),
  product import (emporix-product-data), or Management Dashboard extensions.
license: CC-BY-4.0
metadata:
  validated: 2026-07-11 claude-code ticket-15 clean-context render-oracle PASS on tenant andidemo4 (product seeded via emporix-product-data); gates a/b/d green (pre-GitHub; PR link when repo is public)
  # Grounded on the emporix-frontend repo (@1.4.0) + community threads —
  # no Emporix OpenAPI spec. Changelog-only drift checking.
  sources: []
  drift-checked: doc-2026071011 changelog 2026-07-12
---

# Emporix Storefront (Journey Aware Storefront / B2B Commerce Frontend)

The Emporix storefront ships as an extensible **foundation**, not a finished shop — its
README is explicit: "we want to give you a solid foundation, rather than a ready-to-use
solution." Treat customization as the expected path. Almost every question resolves to one
of two things: **which of the three layers does my change belong in**, and **which
environment variable / infrastructure prerequisite is missing**. Get those two right and
the rest follows.

The codebase is **source-gated**: the repo (`emporix-shared/emporix-frontend`) is private,
handed out through an access-request form. This skill documents it publicly on purpose; if
you don't have the source yet, request access through the Emporix Developer Portal /
partner-onboarding form before starting.

**Names for the same thing** (they all appear in docs and threads): *Journey Aware
Storefront* (concept), *B2B Commerce Frontend* (product/marketing), *emporix-showcase*
(the `package.json` name). Don't treat them as different products.

## Tenant prerequisites

For this skill's instructions and Verify section to work, the environment needs:

- **The repo checked out.** Private (`emporix-shared/emporix-frontend`); request access via
  the partner form if you lack it. This skill is version-aware of **1.x** (validated against
  1.4.0); specific file paths age — trust the repo's own `docs/` over any path quoted here.
- **Node.js 20+** and npm. `npm install` must have run.
- **Demo run needs only the template — while the demo keys are live.** `.env.template` ships
  public demo values (Emporix `showcase` tenant, a Battery Included search key, a demo
  Storyblok space); when current, `cp .env.template .env` boots a browsable catalog with no
  signup. These shared keys are rotated periodically — if the server log shows `Invalid
  ApiKey` on the anonymous-token call and pages 404, the demo Storefront key has been revoked;
  point `NEXT_PUBLIC_EMPORIX_TENANT` / `NEXT_PUBLIC_EMPORIX_CLIENT_ID` at your own tenant.
- **Two credential pairs, both load-bearing.** The public *Storefront API* client id
  (`NEXT_PUBLIC_EMPORIX_CLIENT_ID`) drives anonymous browsing and product listing/search. The
  *Emporix API* **server** credentials (`NEXT_EMPORIX_CLIENT_ID` / `_SECRET`) mint the
  **service token** that server-side rendering uses — including the **product detail page** —
  plus login and ordering. A product page 404s with `SSR getProductById failed: Failed to get
  service access token` when the server creds are missing/invalid *even though* the client id
  is valid (the listing still works — that path uses the anonymous token). Get both from
  Developer Portal → your tenant → Manage API Keys; token/scope mechanics are `emporix-auth`'s.

## The three-layer architecture — the core mental model

Every "how do I change X" question is really "which layer owns X". Three layers, each
depending only on the one below:

```
React app  (src/app, src/components, src/hooks)   ← pages, UI, client state
   ↓ depends on
Service layer  (src/platform/services/<domain>/impl/)   ← business logic, workflows
   ↓ depends on
Integration layer  (src/platform/integrations/emporix/<domain>/)   ← HTTP to api.emporix.io
```

| The user wants to change… | Layer | Where |
|---|---|---|
| How something **looks / behaves in the UI** | React | `src/components/<domain>/`, `src/hooks/<domain>/` |
| A **business rule / workflow** (pricing, validation, approval) | Service | `src/platform/services/<domain>/impl/` |
| **How Emporix is called** (endpoint, request/response shaping, headers) | Integration | `src/platform/integrations/emporix/<domain>/` |

Skipping a layer or creating a circular dependency is a called-out anti-pattern. Each layer
is **environment-aware by naming suffix** — `*Client` (browser), `*Server` (Node), `*SSR`
(server render). A service that must differ per environment provides all three; the DI
container picks the right one. When you add or rebind a service, the DI generator must
re-run (see below).

### Calling Emporix the right way

Never `fetch('https://api.emporix.io/...')` from a component — it bypasses layering, the
environment variants, and error handling, and it's a review red flag. Instead:

- **Server (API route / RSC):** resolve a service from the container —
  `server.get<ProductService>('ProductService')` — and call it.
- **Client component:** use the domain hook (`useCart`, `useCheckout`, `useCustomer`, …)
  from `src/hooks/`; the hooks wrap the Service layer and handle loading/error state.

## Run it locally

```bash
cp .env.template .env      # public demo credentials — works out of the box
npm install                # Node 20+
npm run dev                # http://localhost:3000, opens automatically
```

`npm run dev` runs three things in parallel: the **InversifyJS DI generator in watch mode**
(`generate:watch`), the Next.js dev server (`dev:next`), and a browser opener. Do **not** run
`next dev` directly — you'll get stale or empty DI wiring. If you ever do, run `npm run
generate` then restart.

**What does not hot-reload:** changes under `src/platform/` (the DI layer — new/renamed
`@injectable` services, rebindings, new `*Client`/`*Server`/`*SSR` variants) require a dev
server restart. Everything else (components, hooks, stores, styles, i18n, CMS content)
hot-reloads.

**HTTPS locally** (needed for the Storyblok Visual Editor and custom multi-site domains):
`npm run dev:https` uses Next's built-in self-signed cert (`next dev --experimental-https`);
accept the browser warning.

### Env-var preflight

Build-time validation (Tier 1, always on, cannot be disabled) fails the build if any
**required** var is missing. The required set (from `src/platform/healthcheck/
env-validation.ts`): `NEXT_PUBLIC_EMPORIX_BASE_URL`, `NEXT_PUBLIC_EMPORIX_TENANT`,
`NEXT_PUBLIC_EMPORIX_CLIENT_ID`, `NEXTAUTH_SECRET`, `NEXT_PUBLIC_DEFAULT_CURRENCY`,
`NEXT_PUBLIC_DEFAULT_SITE`, `NEXT_PUBLIC_DEFAULT_LANGUAGE`, `NEXT_PUBLIC_DEFAULT_COUNTRY`,
`NEXT_PUBLIC_DEFAULT_REGION`, `NEXT_PUBLIC_EMPORIX_DEFAULT_UNIT_CODE`,
`NEXT_PUBLIC_AVAILABLE_SITES`. The server credentials `NEXT_EMPORIX_CLIENT_ID` /
`NEXT_EMPORIX_CLIENT_SECRET` are only **warnings** — the app boots and browses without them,
but login and ordering won't work.

Two facts that trip people up:

- **Storyblok is a third-party dependency, but not fatal on current builds.** A wrong/blank
  `NEXT_PUBLIC_STORYBLOK_ACCESS_TOKEN` degrades CMS-driven content, but the app falls back to a
  **Local CMS** so pages still render. Older community reports of a bare 401-on-load traced to
  this token; on 1.4.0 the page loads via the fallback, so read **missing CMS content**
  (nav/footer/landing blocks), not a hard 401, as the Storyblok signal. The template's demo
  token is valid; keep it unless you have your own space.
- **`NEXT_PUBLIC_` is load-bearing.** Next.js exposes only `NEXT_PUBLIC_`-prefixed vars to the
  browser. The public Storefront client id is correctly `NEXT_PUBLIC_EMPORIX_CLIENT_ID`; the
  privileged secret is `NEXT_EMPORIX_CLIENT_SECRET` (**no** prefix). Adding `NEXT_PUBLIC_` to
  the secret leaks it into every client bundle — rotate immediately if that happens.

### Check readiness

```bash
curl localhost:3000/api/health   # → 200 {"status":"ok",...}         liveness
curl localhost:3000/api/ready    # → 200 {"status":"ready",...}      readiness
                                  #   or 503 {"status":"not-ready","missing":[...]}
```

`/api/ready` reports exactly which **required** env vars are absent in its `missing` array. It
checks local config only — a 200 means your env is complete, not that Emporix is reachable.

## Routing: `[site]/[locale]` + layout groups

Every route lives under `src/app/[site]/[locale]/` — multi-site and multi-locale are
first-class URL segments. Three layout groups subdivide it:

| Group | Chrome | Used for |
|---|---|---|
| `(default)` | full header/footer | product pages, account, login |
| `(reduced)` | minimal | checkout, order confirmation |
| `(no-margin)` | full-width | CMS/Storyblok catch-all pages |

Login and password-reset render as modals via a **parallel + intercepting route**
(`@dialog/(.)login`). If the modal renders as a full page instead: the parent layout isn't
rendering the `dialog` slot, or the user hit `/login` directly / refreshed (both show the
full page **by design** — only in-app navigation intercepts).

**Looks wrong but is right:** the site middleware rewrites incoming URLs to include the
resolved site, so you'll see an `x-middleware-rewrite` header pointing at `/main/...` (or
your default site). That internal rewrite is **normal multi-site behavior**, not a bug — don't
"fix" it. A product page is `/{site}/{locale}/product/{id}`.

## Styling: the four-layer token system

Tailwind v4 drives styling, but **stock palette utilities (`bg-blue-500`, `text-red-600`) are
banned** — the design system overrides Tailwind's defaults, so they resolve to nothing.
Tokens flow through four files, each importing the previous:

```
src/app/styles/brand.css   →  alias.css   →  mapped.css   →  src/app/globals.css
(raw OKLCH primitives,        (semantic       (context tokens    (@theme inline exposes
 spacing scales)               aliases like     like              them as utilities:
                               --color-         --color-          bg-surface-action,
                               primary-500)     surface-action)   text-text-body)
```

- **Do** use context-token utilities: `bg-surface-action`, `text-text-body`,
  `border-border-primary`. **Don't** reference `brand.css`/`alias.css` from components, and
  don't use raw hex or stock Tailwind palette classes.
- **Adding a token** means touching all four files top-to-bottom; miss the `globals.css`
  `@theme inline` step and Tailwind never generates the utility (symptom: "my token does
  nothing").

## Deploying

Emporix's own path is **Vercel + GitHub Actions**; Cloud Run, GKE/AKS, and Azure App
Service / Container Apps are supported for self-hosting. Two rules dominate first deploys.

**1. Health probes must point at `/api/health` (liveness) and `/api/ready` (readiness) — never
at `/` or a page route.** Every hit on a page route triggers a full SSR that hammers the
Emporix API (`getSite()` → currencies, countries, regions, payment modes …) — documented at
36+ API calls/minute with zero users. The middleware defends itself (it answers probe-like
page-route hits with `200` plus an `x-misrouted-healthcheck: 1` header) — if you see that
header in your logs, your probe config is wrong. Container port is **3000**.

**2. Behind a proxy, the app must know it's on HTTPS.** Auth (`trustHost: true`) computes
callback/redirect URLs from the forwarded request. If the ingress/load balancer doesn't pass
`X-Forwarded-Proto: https` (and `X-Forwarded-Host`), the app builds `http://` URLs and the
browser bounces between http and https — **`ERR_TOO_MANY_REDIRECTS`**, typically only in
production, fine on localhost. Fixes, in order: ensure the proxy forwards
`X-Forwarded-Proto`/`-Host`; set `NEXTAUTH_URL` to the exact public origin as a fallback when
it can't; confirm the ingress protocol. A real community case on Azure root-caused this to the
ingress serving **HTTP/1.1 where HTTP/2 was expected** — if forwarded headers look correct,
check the negotiated HTTP version at the ingress. (This is a known gap: as of 1.4.0 it isn't in
the repo docs.)

Other deploy checklist items:

- Build with **`npm run build`**, never `next build` — the former also runs the DI generator,
  `check-translations`, and lint. `next build` alone ships stale DI wiring or incomplete
  translations. Set Node to 20.x.
- Set `NEXT_PUBLIC_SERVER_URL` to the public hostname (not `localhost`); use a **distinct
  `NEXTAUTH_SECRET` per environment** (sharing/omitting causes random logouts).
- `NEXT_SERVER_OUTPUTMODE`: leave empty for a normal server, or `standalone` for Docker.
  `export` (static) is **unsupported** — product pages, middleware, and `/api` routes need the
  Next.js server runtime.
- Store secrets (`NEXT_EMPORIX_CLIENT_SECRET`, `NEXTAUTH_SECRET`, Storyblok) in the platform's
  secret store, not plain config.

## Symptom → cause

| Symptom | Most likely cause |
|---|---|
| **`Invalid ApiKey` / 401** on first load, pages 404, catalog empty | The **Storefront client id** (`NEXT_PUBLIC_EMPORIX_CLIENT_ID`) is wrong or revoked — the anonymous-token call fails so site resolution/catalog never load. Server log: `Failed to get anonymous token`. |
| Product **listing works but the detail page 404s** | `SSR getProductById failed: Failed to get service access token` — the **server** creds (`NEXT_EMPORIX_CLIENT_ID`/`_SECRET`) are missing/invalid; detail SSR needs the service token, listing uses the anonymous one |
| Product renders but shows **no price** | Price match returned empty — usually `NEXT_PUBLIC_EMPORIX_DEFAULT_UNIT_CODE` (template default `piece`) ≠ the price model's `measurementUnit` (often `pc`); align them. Also check the price's `restrictions.siteCodes`, currency, and location match the site |
| Missing CMS content (nav/footer/landing) but pages still render | Wrong/blank Storyblok token; app served from the Local CMS fallback |
| `/api/ready` → **503** | A **required** env var missing — the `missing` array names it (server-creds absence is only a warning, not this) |
| **`ERR_TOO_MANY_REDIRECTS`** after deploy (ok on localhost) | Proxy not forwarding `X-Forwarded-Proto`/`-Host`; `NEXTAUTH_URL` mismatch; ingress HTTP version (HTTP/1.1 vs HTTP/2) |
| `x-middleware-rewrite` to `/main/...` | **Normal** multi-site rewrite — not a bug |
| `x-misrouted-healthcheck: 1` in logs / API-call storm | A health probe is hitting `/` or a page route — repoint it to `/api/health` + `/api/ready` |
| Login works in dev, not in prod | `NEXTAUTH_URL` / `NEXT_PUBLIC_SERVER_URL` ≠ real hostname; or missing/rotated server creds |
| CSS token does nothing / unstyled | Stock Tailwind utility used, or a new token not wired through all four CSS layers (esp. the `globals.css` `@theme` step) |
| `src/platform/` edit not taking effect | Platform layer doesn't hot-reload — restart `npm run dev` |
| `npm run build` fails, `next build` "works" | By design — `build` also runs DI gen + `check-translations` + lint; one of those is failing |

## Known limitations (from the repo README — verify before promising a fix)

Cart migration on site/currency switch is **not implemented** (cart is lost); SSR session
invalidation can leave the client showing a logged-in UI until reload; Next.js API endpoints
aren't additionally secured (security rides on the Emporix integration); Integration-layer
caching isn't implemented; not all CMS components follow the hybrid pattern; unit/integration
tests need tenant-specific test data you supply. Several apparent "bugs" are intentional
foundation gaps — check the README's Known Issues before committing to a change.

## Verify

Run against the checked-out repo. The **local product-page render** is the pass/fail oracle;
the deployment checks are documented expected behavior that can't be exercised without a real
ingress. Report each as PASS / FAIL / BLOCKED.

The render oracle needs a tenant that resolves an anonymous token (valid `NEXT_PUBLIC_
EMPORIX_CLIENT_ID`), **valid server creds** (`NEXT_EMPORIX_CLIENT_ID`/`_SECRET` — the detail
page SSR mints a service token), and **at least one published, priced product on the target
site**. If the demo `showcase` keys are live and its catalog is populated, the template alone
suffices; otherwise point at your own tenant and, if it has no sellable product, seed one with
the `emporix-product-data` skill (product published, a price + availability on a **non-`main`**
site, in a catalog whose `publishedSites` include that site) and set `NEXT_PUBLIC_DEFAULT_SITE`
to it. Match `NEXT_PUBLIC_EMPORIX_DEFAULT_UNIT_CODE` to the price model's `measurementUnit` or
the price won't match.

1. **Boot.** `cp .env.template .env` (then set the working credentials/site), `npm install`
   (pulls declared deps — a stale `node_modules` fails on e.g. `prom-client`), `npm run dev`.
   → the dev server serves on `http://localhost:3000`. FAIL if it exits or the DI generator
   errors.
2. **Product page renders (oracle).** Open `/{site}/{locale}/product/{id}` for a published,
   priced product. → the page renders the product name **and price** (with tax line), not an
   error/blank/404. Exercises the anonymous *and* service tokens, SSR, DI wiring, price match,
   and the site middleware end-to-end. FAIL on 404 (`SSR getProductById failed` → check server
   creds) or a missing price (→ unit-code / price-restriction mismatch).
3. **Health + readiness.** `curl localhost:3000/api/health` → `200 {"status":"ok"}`;
   `curl localhost:3000/api/ready` → `200 {"status":"ready"}`.
4. **Missing-required-var check.** Remove a **required** var (e.g. unset
   `NEXT_PUBLIC_EMPORIX_TENANT`) and restart. → Tier-1 build/startup validation catches it and
   **names the var** (`[healthcheck] … ✗ NEXT_PUBLIC_EMPORIX_TENANT — missing`), aborting the
   build so the dev server may not bind; and if a server is already up, `/api/ready` reports
   `503 {"status":"not-ready","missing":["NEXT_PUBLIC_EMPORIX_TENANT"]}`. Either way the exact
   missing var is surfaced (a config gap, distinct from an upstream outage — which would leave
   `/api/ready` at 200). Restore the var afterward.
5. **Storyblok degradation check.** Set `NEXT_PUBLIC_STORYBLOK_ACCESS_TOKEN` to an invalid
   value and reload → the page **still renders** (Local CMS fallback) with CMS-driven content
   degraded; it does **not** hard-401. Confirms the fallback and that a bad Storyblok token is
   not fatal. Restore the demo token afterward.
6. **Deployment redirect-loop guard (BLOCKED without a real ingress).** On a proxied HTTPS
   deployment, `X-Forwarded-Proto: https` reaching the app prevents `ERR_TOO_MANY_REDIRECTS`;
   stripping it (or serving the wrong HTTP version) reproduces the loop. Expected behavior only
   — not runnable in a local validation session.
