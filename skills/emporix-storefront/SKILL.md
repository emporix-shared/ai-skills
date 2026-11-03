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
  a blank page or 401 on first load, a 500 on the product page, /api/ready returning 503, ERR_TOO_MANY_
  REDIRECTS after deploy, "x-middleware-rewrite to /main/...", CSS tokens not
  resolving, or platform-layer edits not hot-reloading. Not for Emporix REST API
  scopes/tokens (emporix-auth), data modeling/mixins (emporix-extensibility),
  product import (emporix-product-data), or Management Dashboard extensions.
license: CC-BY-4.0
metadata:
  validated: 2026-10-29 claude-code clean-context run on tenant andidemo4 with emporix-frontend 1.11.0, 5/5 runnable Verify PASS (6 BLOCKED by design), previous version fails check 4, PR #24
  # Grounded on the emporix-frontend repo + community threads — no Emporix
  # OpenAPI spec, so the spec axis is changelog-only; the repo is the anchor.
  sources: []
  anchor: github:emporix-shared/emporix-frontend@1.11.0 grounded
  anchor-checked: 1.11.0 2026-10-29
  drift-checked: doc-2026102907 changelog 2026-10-29
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
  the partner form if you lack it. This skill is version-aware of **1.x** (re-read against
  1.11.0); specific file paths age — trust the repo's own `docs/` over any path quoted here.
- **Node.js 22 or 24** and **npm ≥ 11.10** (the repo's `engines`; Node 20 is no longer
  supported). `npm install` must have run.
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
  plus login and ordering. When the server creds are missing/invalid the product page fails
  **500** (`SSR getCatalogProductById failed` … `Failed to get service access token` in the
  server log) *even though* the client id is valid (the listing still works — that path uses
  the anonymous token). Only a real catalog miss is a 404. Get both from Developer Portal →
  your tenant → Manage API Keys; token/scope mechanics are `emporix-auth`'s.
- **A search backend the tenant actually has.** Since 1.7.0 the repo's default `SearchService`
  is **Battery Included**, and the product page loads through it. On a tenant without a Battery
  Included indexing configuration the page fails 500 with `Failed to load BatteryIncluded
  runtime configuration … 400 … Configuration not found`. Set
  `DI_SEARCH_SERVICE=EmporixSearchService` in `.env`, then `npm run generate` and restart — it
  is a build-time DI override. (The repo's `docs/search-service.md` calls the Emporix search
  the default; the shipped `src/platform/depency.yml` says otherwise — trust the code.)

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
npm install                # Node 22/24, npm ≥ 11.10
npm run dev                # http://localhost:3000, opens automatically
```

`npm run dev` opens a desktop browser; in a headless or agent session start the same parts
without it: `npm run generate && npx concurrently "npm:generate:watch" "npm:dev:next"`.

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

- **The CMS is a pluggable provider, and Storyblok is optional.** `NEXT_CMS_PROVIDER` picks
  `storyblok`, `local` (JSON under `data/cms/`, a dev/demo source), or `none` (an empty page
  shell); left empty, a Storyblok token selects `storyblok` and no token selects `none`. The
  token is **`NEXT_STORYBLOK_ACCESS_TOKEN`** — server-only since 1.8.0; the old
  `NEXT_PUBLIC_STORYBLOK_ACCESS_TOKEN` is still accepted but don't reintroduce it.
  `NEXT_CMS_FALLBACK_PROVIDER=mock` (the template default) fills any page the primary provider
  has no content for from the bundled showcase tree, so a fresh clone renders. Leave it
  **empty in production** — there it hides a broken or empty CMS behind demo content. So read
  **missing or demo CMS content** (nav/footer/landing blocks), not a hard 401, as the CMS
  signal. The template's demo Storyblok token is valid; keep it unless you have your own space.
- **`NEXT_PUBLIC_` is load-bearing.** Next.js exposes only `NEXT_PUBLIC_`-prefixed vars to the
  browser. The public Storefront client id is correctly `NEXT_PUBLIC_EMPORIX_CLIENT_ID`; the
  privileged secret is `NEXT_EMPORIX_CLIENT_SECRET` (**no** prefix). Since 1.11.0 the storefront
  ignores `NEXT_PUBLIC_EMPORIX_CLIENT_SECRET` (the template no longer ships it), so a prefixed
  secret just breaks login. Never put a secret in any `NEXT_PUBLIC_` var: Next.js inlines every
  referenced one into client bundles — rotate immediately if a secret got there.

### Check readiness

```bash
curl localhost:3000/api/health   # → 200 {"status":"ok",...}         liveness
curl localhost:3000/api/ready    # → 200 {"status":"ready",...}      readiness
                                  #   or 503 {"status":"not-ready",...}
```

A `503` means a **required** env var is absent. Since 1.11.0 the public response no longer
names it; the server log does, in the `missing` field of the `Readiness check failed: required
environment variables are missing` entry. The probe checks local config only — a 200 means your env is complete, not that Emporix is reachable.

## Routing: `[site]/[locale]` + layout groups

Every route lives under `src/app/[site]/[locale]/` — multi-site and multi-locale are
first-class URL segments. Layout groups subdivide it; `(nav-shell)` loads the shared header,
footer, and navigation once for the two groups inside it:

| Group | Chrome | Used for |
|---|---|---|
| `(nav-shell)/(default)` | full header/footer | product pages, account, cart, login, quick order |
| `(nav-shell)/(no-margin)` | full-width | CMS catch-all pages (`[...slug]`) |
| `(reduced)` | minimal, outside the nav shell | checkout, order confirmation |

Login and password-reset render as modals via a **parallel + intercepting route**
(`@dialog/(.)login`). If the modal renders as a full page instead: the parent layout isn't
rendering the `dialog` slot, or the user hit `/login` directly / refreshed (both show the
full page **by design** — only in-app navigation intercepts).

**Looks wrong but is right:** the site middleware rewrites incoming URLs to include the
resolved site, so you'll see an `x-middleware-rewrite` header pointing at `/main/...` (or
your default site). That internal rewrite is **normal multi-site behavior**, not a bug — don't
"fix" it. Since 1.11.0 the canonical product URL is `/{locale}/product/{code}/{category-slug}/{name-slug}`
(the catalog **code**, not the id; English has no locale prefix; shape set in
`src/lib/product/product-url.ts`). Legacy `/product/{id}`, short `/product/{code}`, and
`/{site}/{locale}/product/{id}` links still open the product; the address bar is then replaced
client-side with the canonical path — not a 301, so don't "fix" missing redirects. A
`/{site}/{locale}/...` URL first answers `307`, moving site and locale into the `NEXT_SITE` /
`NEXT_LOCALE` cookies — follow redirects and keep cookies (`curl -L -c jar -b jar`) when you
test it.

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
check the negotiated HTTP version at the ingress. (This is a known gap: as of 1.11.0 it isn't in
the repo docs.)

Other deploy checklist items:

- Build with **`npm run build`**, never `next build` — the former also runs the DI generator
  (`generate:prod`), the client-chunk check, `check-translations`, and lint. `next build` alone
  ships stale DI wiring or incomplete translations. Set Node to 22.x or 24.x.
- Set `NEXT_PUBLIC_SERVER_URL` to the public hostname (not `localhost`); use a **distinct
  `NEXTAUTH_SECRET` per environment** (sharing/omitting causes random logouts).
- `NEXT_SERVER_OUTPUTMODE`: leave empty for a normal server, or `standalone` for Docker.
  `export` (static) is **unsupported** — product pages, middleware, and `/api` routes need the
  Next.js server runtime.
- Store secrets (`NEXT_EMPORIX_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `NEXT_STORYBLOK_ACCESS_TOKEN`) in the platform's
  secret store, not plain config.

## Symptom → cause

| Symptom | Most likely cause |
|---|---|
| **`Invalid ApiKey` / 401** on first load, pages 404, catalog empty | The **Storefront client id** (`NEXT_PUBLIC_EMPORIX_CLIENT_ID`) is wrong or revoked — the anonymous-token call fails so site resolution/catalog never load. Server log: `Failed to get anonymous token`. |
| Product **listing works but the detail page 500s** | Server log `SSR getCatalogProductById failed`; the next line names the cause. `Failed to get service access token` → the **server** creds (`NEXT_EMPORIX_CLIENT_ID`/`_SECRET`) are missing/invalid (detail SSR needs the service token, listing uses the anonymous one). `Failed to load BatteryIncluded runtime configuration … Configuration not found` → set `DI_SEARCH_SERVICE=EmporixSearchService`, regenerate, restart |
| Product renders but shows **no price** | Price match returned empty — usually `NEXT_PUBLIC_EMPORIX_DEFAULT_UNIT_CODE` (template default `piece`) ≠ the price model's `measurementUnit` (often `pc`); align them. Also check the price's `restrictions.siteCodes`, currency, and location match the site |
| Missing or demo CMS content (nav/footer/landing) but pages still render | Wrong/blank `NEXT_STORYBLOK_ACCESS_TOKEN` (or provider `none`); with `NEXT_CMS_FALLBACK_PROVIDER` set, gaps are filled from the bundled showcase tree |
| `/api/ready` → **503** | A **required** env var missing — the server log's `Readiness check failed` entry names it in `missing` (the response body no longer does since 1.11.0; server-creds absence is only a warning, not this) |
| **`ERR_TOO_MANY_REDIRECTS`** after deploy (ok on localhost) | Proxy not forwarding `X-Forwarded-Proto`/`-Host`; `NEXTAUTH_URL` mismatch; ingress HTTP version (HTTP/1.1 vs HTTP/2) |
| `x-middleware-rewrite` to `/main/...` | **Normal** multi-site rewrite — not a bug |
| `x-misrouted-healthcheck: 1` in logs / API-call storm | A health probe is hitting `/` or a page route — repoint it to `/api/health` + `/api/ready` |
| Login works in dev, not in prod | `NEXTAUTH_URL` / `NEXT_PUBLIC_SERVER_URL` ≠ real hostname; or missing/rotated server creds |
| CSS token does nothing / unstyled | Stock Tailwind utility used, or a new token not wired through all four CSS layers (esp. the `globals.css` `@theme` step) |
| `src/platform/` edit not taking effect | Platform layer doesn't hot-reload — restart `npm run dev` |
| `npm run build` fails, `next build` "works" | By design — `build` also runs DI gen + the client-chunk check + `check-translations` + lint; one of those is failing |

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
the price won't match, and set `DI_SEARCH_SERVICE=EmporixSearchService` unless the tenant has
Battery Included configured.

1. **Boot.** `cp .env.template .env` (then set the working credentials/site), `npm install`
   (pulls declared deps — a stale `node_modules` fails on e.g. `prom-client`), `npm run dev`.
   → the dev server serves on `http://localhost:3000`. FAIL if it exits or the DI generator
   errors.
2. **Product page renders (oracle).** Open `/{site}/{locale}/product/{id}` (or the canonical
   `/product/{code}/…`) for a published, priced product (follow the `307`, keep cookies). → the page renders the product name **and
   price** (with tax line), not an error/blank/404/500. The price is filled in client-side, so
   check it in a real browser (or headless Chromium), or in the SSR HTML's JSON-LD `Offer`;
   it is not plain text in the raw HTML. Exercises the anonymous *and* service tokens, SSR, DI
   wiring, price match, and the site middleware end-to-end. FAIL on 500 (`SSR
   getCatalogProductById failed` → read the next log line: server creds or search backend) or
   a missing price (→ unit-code / price-restriction mismatch).
3. **Health + readiness.** `curl localhost:3000/api/health` → `200 {"status":"ok"}`;
   `curl localhost:3000/api/ready` → `200 {"status":"ready"}`.
4. **Missing-required-var check.** Remove a **required** var (e.g. unset
   `NEXT_PUBLIC_EMPORIX_TENANT`) and restart. → Tier-1 build/startup validation catches it and
   **names the var** (`[healthcheck] … ✗ NEXT_PUBLIC_EMPORIX_TENANT — missing`), and
   `dev:next` exits without binding the port (the DI watcher keeps running, so `npm run dev`
   itself does not exit); and if a server is already up, `/api/ready` returns
   `503 {"status":"not-ready",…}` with **no** var names in the body, while the server log entry
   `Readiness check failed …` carries `missing: ["NEXT_PUBLIC_EMPORIX_TENANT"]`. Either way the exact
   missing var is surfaced (a config gap, distinct from an upstream outage — which would leave
   `/api/ready` at 200). Restore the var afterward.
5. **CMS degradation check.** With the template's `NEXT_CMS_FALLBACK_PROVIDER=mock`, set
   `NEXT_STORYBLOK_ACCESS_TOKEN` to an invalid value and restart → the page **still renders**
   (CMS content from the fallback, or degraded); it does **not** hard-401. Confirms that a bad
   Storyblok token is not fatal. Restore the demo token afterward.
6. **Deployment redirect-loop guard (BLOCKED without a real ingress).** On a proxied HTTPS
   deployment, `X-Forwarded-Proto: https` reaching the app prevents `ERR_TOO_MANY_REDIRECTS`;
   stripping it (or serving the wrong HTTP version) reproduces the loop. Expected behavior only
   — not runnable in a local validation session.
