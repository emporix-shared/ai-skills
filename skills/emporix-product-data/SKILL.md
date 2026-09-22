---
name: emporix-product-data
description: >-
  Onboard and sync product data into Emporix across the Product, Category,
  Catalog, Availability, Price, and Media services. Use when importing a
  catalog from a PIM/ERP, creating products or variants, setting stock and
  availability, defining prices or price lists, attaching product images,
  assigning products to categories, choosing dynamic vs template variants,
  or diagnosing why imported availability, stock, or prices do not show up
  on the storefront.
license: CC-BY-4.0
metadata:
  validated: 2026-07-11 claude-code ticket-13 clean-context run on tenant andidemo4, 4/4 Verify PASS (pre-GitHub; PR link when repo is public)
  sources:
    - products-labels-and-brands/product-service/api-reference/api.yml
    - catalogs-and-categories/category-tree/api-reference/api.yml
    - catalogs-and-categories/catalog/api-reference/api.yml
    - orders/availability/api-reference/api.yml
    - prices-and-taxes/price-service/api-reference/api.yml
    - prices-and-taxes/tax-service/api-reference/api.yml
    - media/media/api-reference/api.yml
    - configuration/site-settings-service/api-reference/api.yml
  drift-checked: doc-2026071011 changelog 2026-07-12
---

# Onboarding product data to Emporix

A single sellable product in Emporix is assembled from up to six services —
**Product, Category, Catalog, Availability, Price, Media** — each owning one
facet and referencing the product by id. There is no one "import a product"
call; onboarding is composing these services in the right order. The two
things that most often go wrong are cross-service, not per-endpoint: writing
availability to the `main` sitecode (a read-only aggregator that silently
swallows the write), and choosing template variants for a PIM-led sync (which
forces parent-template updates before children can load). This skill encodes
the order, the guardrails, and the variant decision.

Base URL: `https://api.emporix.io`. Tenant names are lowercase. Every call is
an OAuth bearer call (`Authorization: Bearer {token}`); token types and scope
selection are the `emporix-auth` skill's job, and finding an exact endpoint,
schema, or scope is `emporix-docs-navigation`'s. This skill assumes you can
get a token carrying the pipeline scopes listed under prerequisites.

## Tenant prerequisites

- An Emporix tenant with Developer Portal access and a **custom API key**
  carrying the pipeline scopes for the tasks you run (see *Scopes* below).
  Read the spec for each endpoint; do not guess scope names.
- **At least one real site whose code is not `main`.** If the tenant only has
  `main` (common when AI Smart Config generated it), create one first:
  `POST /site/{tenant}/sites` with `site.site_manage`. Availability is written
  per site and `main` cannot hold per-site stock (see the guardrail below).
- Setup data the pipeline references: at least one **currency**, one **tax
  configuration** with tax classes (`tax.tax_manage`), and — for prices — one
  **price model**. These usually exist on a configured tenant.
- Runtime: outbound HTTPS and `curl` (or equivalent). Bulk import of many
  products additionally uses the async recalculation endpoints (below).

## The onboarding pipeline

Order is driven by references: a thing must exist before another thing points
at it. Config first, then the product, then everything that references the
product.

| Step | Service | Call | Depends on |
|---|---|---|---|
| 1. Tax classes | Tax | `POST /tax/{tenant}/taxes` | — |
| 2. Currency + price model | Currency, Price | `POST /currency/{tenant}/currencies`, `POST /price/{tenant}/priceModels` | — |
| 3. Real site (if none) | Site Settings | `POST /site/{tenant}/sites` | — |
| 4. Product | Product | `POST /product/{tenant}/products` (or `/products/bulk`) | tax classes (2) |
| 5. Category + assignment | Category | `POST /category/{tenant}/categories?publish=true`, then `POST /category/{tenant}/categories/{categoryId}/assignments` (`ref.type: PRODUCT`) | product |
| 6. Catalog | Catalog | `POST /catalog/{tenant}/catalogs` (`categoryIds`, `publishedSites`) | categories |
| 7. Price | Price | `POST /price/{tenant}/prices` | product, price model, currency, site |
| 8. Availability | Availability | `POST /availability/{tenant}/availability/{productId}/{site}` | product, **non-`main`** site |
| 9. Media | Media | `POST /media/{tenant}/assets` | product (or category) must already exist |

Steps 5–9 all reference the product, so the product must exist first; among
them the order is flexible. Categories and catalogs can be built independently
and connected once the product exists.

Any create that carries **localized** fields (price model `name`, category
`localizedName`, catalog `name`/`description`) must send a **`Content-Language`**
header naming the languages in the payload, or the call fails `400` with
"localized values must be of String type when the Content-Language header is
not set to all languages". Use `Content-Language: *` to accept every
tenant-configured language, or list them (`Content-Language: en,de`).

A minimal product:

```bash
curl -sS -X POST "https://api.emporix.io/product/{tenant}/products" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Smartphone X2","code":"SMARTPHONE-X2",
       "published":false,"taxClasses":{"DE":"STANDARD"},"productType":"BASIC"}'
```

Each `taxClasses` key is a **country code that has a tax configuration** in the
Tax service, mapped to one of that country's tax-class codes — `{"DE":"STANDARD"}`
only works if the tenant has a DE tax config with a `STANDARD` class. (The
product guide's `{"EN":"STANDARD"}` example is misleading — `EN` is not a
country and is rejected with "tax classes … do not exist".) List a country's
classes with `GET /tax/{tenant}/taxes`.

`published` defaults to false — the storefront sees only published products, so
flip it (or use the publish flow) when the product is ready. Published products
are readable with **no scope**; reading unpublished ones needs
`product.product_read_unpublished`.

## The `main`-site guardrail

`main` is not a normal site. It is a **read-only aggregator** that rolls up
availability from the other sites. Consequences:

- **Never POST availability with site `main`.** The write is accepted (no
  error) but pooled into the aggregate and **cannot be read back for a single
  site** — the classic "I imported stock and it vanished" failure. Cleanup
  after polluting `main` typically needs Emporix staff.
- Always write availability to a real site code:
  `POST /availability/{tenant}/availability/{productId}/{realSite}`.
- If the only site is `main` (AI Smart Config may create it automatically),
  create a real one first and target that. A minimal site body — `homeBase` is
  required, and localized nothing here so no `Content-Language` is needed:

  ```bash
  curl -sS -X POST "https://api.emporix.io/site/{tenant}/sites" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"code":"store-de","name":"DE store","active":true,"default":false,
         "defaultLanguage":"en","languages":["en"],"currency":"EUR",
         "homeBase":{"address":{"country":"DE","zipCode":"10115"}},
         "shipToCountries":["DE"],"taxDeterminationBasedOn":"SHIPPING_ADDRESS"}'
  ```

`main` is *legitimate* elsewhere — a price's `restrictions.siteCodes` may
include `main`, and price matching's `useFallback: true` deliberately falls
back to the `main` site. The guardrail is specific to **availability writes**,
not a blanket ban on the string `main`.

Retrieving availability: `GET /availability/{tenant}/availability/{productId}/{site}`
(site as a **path** parameter). The older endpoints that took `site` as a
**query** parameter are deprecated and will be removed **2026-09-01** — use the
path-parameter form.

## Variants: dynamic vs template

Two mechanisms, and picking wrong is the second big PIM trap.

- **Template variants** (`PARENT_VARIANT` / `VARIANT`): define a product
  template with `variantAttribute: true` attributes; the parent auto-generates
  child variants from the template's allowed values. Good for **fixed,
  predictable option sets** (size × color) where Emporix owns validation. The
  trap: the shared template must be updated *before* children carrying new
  attribute values can sync — painful when a PIM drives the data.
- **Dynamic variants** (`DYNAMIC_VARIANT`): no template; each variant is an
  independent product declaring only its `ownVariantAttributes`, linked by
  `parentVariantId`, up to **4 levels** deep. Ingestion is **order-independent**
  (a child may be created before its parent), and the root product exposes a
  denormalized `variants` map with fully accumulated attributes for the
  storefront in one GET.

**Decision:** a PIM/ERP-led sync — structure not known up front, rows arriving
in arbitrary order, or hierarchy depth that changes over time → **dynamic
variants**. A small fixed option matrix Emporix validates → template variants.

### Dynamic-variant bulk import workflow

Because writes for a product whose parent is not yet present skip the inline
tree update, rebuild the trees **once, after the whole batch**:

1. Import every product (root and all levels), any order:
   `POST /product/{tenant}/products` or `/products/bulk`.
2. Trigger recalculation for the imported ids (≤1000 per call; any level — the
   system resolves each root and makes one job per unique root):
   `POST /product/{tenant}/products/recalculate` → `202` with a `jobs` list.
3. Poll each job to completion:
   `GET /product/{tenant}/products/recalculate/jobs/{jobId}` — statuses
   `PENDING → PROCESSING → FINISHED` (or `FAILED`, retried; `FAILED_PERMANENT`,
   needs manual investigation). Jobs are kept ~30 days after finishing.
4. Fetch the root product; its `variants` map is now fully populated.

Do **not** call recalculate after every single write — single writes update the
tree synchronously and need no job. `metadata.dynamicVariantInfo` on a product
response flags broken chains (`missingAncestorId`) or cycles (`cycleDetected`).

## Mixins on products: key permanence

Products carry custom fields as **mixins**, keyed by a mixin name stored on
every product record. That storage is the catch: **renaming a mixin key means
rewriting every product that uses it.** Choose stable, PIM-aligned key names
from day one and treat them as permanent identifiers, not display labels. The
mixin *mechanism* — schemas, the Schema Service, q-param queries — belongs to
the `emporix-extensibility` skill; here the rule is only: never plan to rename
a product mixin key.

## Prices and price matching

Prices are not stored net/gross — calculation happens at match time. Setup
order: currency → price model (holds the tier definition) → read the tier id
from `tierDefinition.tiers.id` → create the price, passing that tier id as each
`tierValues` entry's `id`:

```bash
curl -sS -X POST "https://api.emporix.io/price/{tenant}/prices" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"itemId":{"itemType":"PRODUCT","id":"SMARTPHONE-X2"},
       "currency":"EUR","location":{"countryCode":"DE"},
       "priceModelId":"<modelId>",
       "tierValues":[{"id":"<tierId>","priceValue":15.99}],
       "restrictions":{"siteCodes":["your-site"]}}'
```

When you name a non-default `priceModelId`, every `tierValues` entry must carry
the `id` of the tier it prices (from the model's `tierDefinition.tiers[].id`);
omitting it fails `400` "all the tier value ids must be specified". `tierValues`
is positional — one entry per tier defined in the model.

Resolve the sellable price with price matching:
`POST /price/{tenant}/match-prices` with `targetCurrency`, `siteCode`,
`targetLocation`, and `items`. Each `items` entry needs an `itemId` **and** a
`quantity` object (a bare number is rejected):

```bash
  -d '{"targetCurrency":"EUR","siteCode":"store-de",
       "targetLocation":{"countryCode":"DE"},
       "items":[{"itemId":{"itemType":"PRODUCT","id":"SMARTPHONE-X2"},
                 "quantity":{"quantity":1,"unitCode":"pc"}}]}'
```

Notes that bite:

- It only compares prices **assigned to that `siteCode`**. A `200` with an
  empty `[]` (not an error) means nothing matched: the price's
  `restrictions.siteCodes` / currency / `targetLocation` don't line up with the
  request, **or** the item's `quantity.unitCode` differs from the price model's
  `measurementUnit.unitCode` (e.g. asking in `piece` against a `pc` model).
- **Price lists take precedence over catalog prices** when a matching list
  exists. `useFallback: true` retries on the `main` site if the requested site
  yields nothing.
- Comparing prices across currencies needs exchange rates defined against the
  `targetCurrency` first.

## Media

`POST /media/{tenant}/assets` with `media.asset_manage`. Two request shapes:
`application/json` with a `url` creates a **LINK** (Emporix stores the
reference); `multipart/form-data` creates a **BLOB** (uploaded binary, ≤10 MB).
For storefront-visible product images use `access: PUBLIC` and
`refIds: [{id: <productId>, type: PRODUCT}]`. The target product (or category)
must exist first. A `PRIVATE` asset cannot be linked to a predefined type like
`PRODUCT`/`CATEGORY` — that request is rejected `400`.

## Bulk limits

Bulk/batch endpoints cap at **200 items** by default (Product, Price,
Availability, Category assignment, Schema); Cart and Shipping cap at 50. A
batch also cannot exceed **10 MB** body, 10 KB URL, or 60 KB headers.
Over-size returns `400`. Split larger datasets across calls. Bulk responses are
**`207 Multi-Status`**: iterate the array and check each element's status by
its request index — a `207` overall does not mean every item succeeded.

## Scopes for the pipeline

Put the least-privilege set the task needs on a custom API key (scopes are
fixed at key creation — see `emporix-auth`). The manage scopes:

`product.product_manage` · `product.product_template_manage` (template
variants) · `category.category_manage` · `catalog.catalog_manage` ·
`price.price_manage` (+ `price.pricemodel_manage`, `price.pricelist_manage`) ·
`availability.availability_manage` · `media.asset_manage`; setup:
`tax.tax_manage`, `currency.currency_manage`, `site.site_manage`.

Scope names are not uniform: there is **no** `product.product_read` or
`category.category_read` — published products/categories read without a scope,
unpublished reads use the `_read_unpublished` scopes; catalog reads use
`catalog.catalog_view`. The authoritative list is each operation's `security`
block in its OpenAPI spec — read it, never guess.

## Pitfalls and diagnosis

| Symptom | Cause | Fix |
|---|---|---|
| Imported stock/availability not visible; can't read it back per site | Availability written to `main` (the aggregator) | Rewrite to a real site code; if `main` is polluted, contact Emporix staff. Never POST availability to `main`. |
| PIM variant sync needs parent-template edits before children load | Template variants used for a dynamic catalog | Model as `DYNAMIC_VARIANT`; import any order, then recalculate. |
| Root `variants` map empty/partial after a bulk import | Recalculation not run (or not finished) | `POST .../products/recalculate`, poll jobs to `FINISHED`, then re-fetch the root. |
| `404`/empty from a `GET .../availability/{productId}?site=...` you expected to work | Deprecated query-param endpoint (removal 2026-09-01) | Use the path-param form `.../availability/{productId}/{site}`. |
| Price match returns nothing | Site/currency/location don't match the price's restrictions, or a price list overrides | Check `restrictions.siteCodes`, currency, `targetLocation`; a matching price list wins over catalog prices. |
| `400` "tax classes … do not exist" creating a product | `taxClasses` keyed on a non-country (e.g. `EN`) or a country with no tax config | Key on a configured country code (`DE`); `GET /tax/{tenant}/taxes` for valid class codes. |
| `400` "localized values must be of String type …" | Localized-field create sent without a `Content-Language` header | Add `Content-Language: *` (or `en,de`) to the request. |
| `400` "all the tier value ids must be specified" creating a price | `tierValues` missing the tier `id` for a non-default `priceModelId` | Put each tier's `id` (`tierDefinition.tiers[].id`) on its `tierValues` entry. |
| Adding a new product relation type is rejected | Relation types aren't a product-service resource | Write the type to the Configuration service (`configurations/relation_types`) first. |
| `403` on any write | Key lacks that service's `_manage` scope | See `emporix-auth`; scopes are fixed at key creation — make a new key with the full set. |

## Verify

Run against your tenant with a token carrying the pipeline scopes. Use
test-obviously-named objects on a **real (non-`main`) site**, and clean up at
the end. Report each check PASS / FAIL / BLOCKED with the raw response.

Setup: ensure a non-`main` site exists (e.g. `pd-verify-site`); reuse the
tenant's existing currency, tax class, and a price model.

1. **Product onboarded and readable.** `POST /product/{tenant}/products` with
   `code: PD-VERIFY-001`, `published: true`, a valid `taxClasses` → expect
   `201`. `GET /product/{tenant}/products/{id}` → `200`, body `code` equals
   `PD-VERIFY-001`. A `403` means the key lacks `product.product_manage` (a
   prerequisite gap, not a skill failure — BLOCKED, fix the key).
2. **Category assignment resolves.** Create a `PD-VERIFY-CAT` category, then
   `POST /category/{tenant}/categories/{categoryId}/assignments` with
   `ref.type: PRODUCT`, `ref.id: {productId}` → `2xx`. `GET` the category's
   assignments → the product id is present.
3. **Availability lands on the intended site, and is site-scoped.**
   `POST /availability/{tenant}/availability/{productId}/pd-verify-site` with
   `{"stockLevel":7,"available":true}` → `2xx`. `GET
   /availability/{tenant}/availability/{productId}/pd-verify-site` → `200`,
   `stockLevel == 7`.
   **Negative:** `GET` the same product's availability on a second real site
   you did *not* write to → `404`/empty. This site-scoping is exactly why
   availability written to `main` cannot be read back per site — if the
   un-written site returns `7`, availability is not site-scoped on this tenant,
   so stop and recheck the site setup rather than trusting the write.
4. **Price matching resolves.** Create a price for the product on
   `pd-verify-site` (`priceModelId`, tier, `currency`, `location`,
   `restrictions.siteCodes: ["pd-verify-site"]`, a `priceValue`). `POST
   /price/{tenant}/match-prices` with `siteCode: pd-verify-site`,
   `targetCurrency`, `targetLocation`, `items: [{the product}]` → `200` and the
   matched price equals the value you set. An empty match (not a 4xx) means the
   site/currency/location criteria don't line up with the price's restrictions
   — a different failure than a rejected call.

Cleanup: delete the price, availability record, category assignment, category,
product, and any site created for the test; re-`GET` the product → `404`,
proving the tenant returned to its prior state.
