---
name: emporix-terraform
description: >-
  Manage Emporix tenant configuration as code with the official
  `emporix/emporix` Terraform provider — sites, currencies, countries, tax,
  shipping zones/methods/delivery times, payment modes, webhooks, mixin
  schemas, and generic tenant-configuration keys — plus a bounded raw
  Configuration-Service-API escape hatch for config surfaces the provider
  does not model yet (indexing, unit handling, country regions, untyped
  keys). Use when writing Terraform for Emporix, configuring the provider
  (`required_providers`, `EMPORIX_CLIENT_ID`/`EMPORIX_CLIENT_SECRET`,
  `EMPORIX_SCOPE`), running `terraform apply`/`plan`/`destroy` against a
  tenant, choosing which resource manages which config, promoting config
  across dev/staging/prod as IaC, or diagnosing `Error: Invalid JSON` on a
  `value`, a state break after a provider upgrade, a missing data source,
  or a 403 on a provider call.
license: CC-BY-4.0
metadata:
  validated: 2026-07-20 claude-code clean-context run on tenant andidemo4, 3/3 Verify PASS on provider v0.9.1, PR #2
  sources:
    - configuration/configuration-service/api-reference/api.yml
    - configuration/unit-handling-service/api-reference/api.yml
---

# Manage Emporix tenant configuration as code

The official `emporix/emporix` Terraform provider turns tenant **configuration**
— the settings a partner sets up once per environment — into version-controlled,
reviewable, repeatable `.tf` files. It is a *configuration* provider, not a
platform provider: it manages the commerce **setup** surface (sites, currencies,
countries, tax, shipping, payment modes, webhooks, mixin schemas, arbitrary
tenant-config keys) and deliberately stops there. Products, prices, orders,
customers, stock, media, and the API-key/IAM surface are **data plane** and are
not — and are not meant to be — managed here.

The provider is **v0.9.1 — pre-1.0**. Treat it accordingly: pin an exact version,
expect that a minor upgrade can require state surgery (it has happened once
already — see Pitfalls), and never run `apply` against a production tenant. Prove
changes on a dev/sandbox tenant first; that is the provider's own acceptance-test
rule, not just caution.

## Tenant prerequisites

- **Terraform** ≥ 1.0 (provider uses plugin protocol 6). Installed and on `PATH`.
- **A test/sandbox tenant** — never a production tenant. `apply` mutates real
  tenant configuration.
- **Credentials** exported as environment variables (the provider reads these as
  fallbacks for its config fields — see below): `EMPORIX_TENANT` plus either
  `EMPORIX_CLIENT_ID` + `EMPORIX_CLIENT_SECRET` (client-credentials, recommended)
  or a pre-minted `EMPORIX_ACCESS_TOKEN`.
- **A scope-limited Custom API Key** carrying only the `*_manage`/`*_read` scope
  pairs for the resources you actually manage. Minting keys and choosing scopes is
  the `emporix-auth` skill's job — route there; this skill only *consumes* the key.
- Outbound HTTPS to `https://api.emporix.io` (or your `EMPORIX_API_URL`).

A validator runs this skill against their own dev tenant. If a step needs a scope
the key does not carry, that is a key problem (go to `emporix-auth`), not a bug in
these instructions.

## Which surface do I use?

Decide before writing any HCL:

| What you want to manage | Use |
|---|---|
| One of the 11 modelled resources (table below) | The provider resource |
| A config surface the provider does **not** model yet — indexing, unit handling, country **regions**, or an untyped tenant-config key | The raw-API escape hatch (below), bounded to config |
| Products, prices, orders, customers, stock, media, promotions | Data plane — **not this skill**, and not a config-as-code concern |
| Deploying the storefront app (Vercel / Cloud Run / K8s) | `emporix-storefront` — that is app deploy, this is config-as-code |
| *Designing* which mixin/custom-entity to model and why | `emporix-extensibility` — this skill only *provisions* a schema via `emporix_schema` |
| Minting the API key / picking scopes / debugging a token | `emporix-auth` |

## Configure the provider

Pin the exact version — a floating constraint will silently pull a state-breaking
minor. The provider is published on the Terraform Registry (`emporix/emporix`);
`terraform init` fetches it, no local build.

```hcl
terraform {
  required_providers {
    emporix = {
      source  = "emporix/emporix"
      version = "= 0.9.1"
    }
  }
}

# Every field falls back to an EMPORIX_* env var, so an empty block + exported
# env is the cleanest setup and keeps secrets out of the state and the repo.
provider "emporix" {}
```

Provider config fields and their env fallbacks (`tenant` is always required;
`api_url` defaults to `https://api.emporix.io`):

| Field | Env var | Notes |
|---|---|---|
| `tenant` | `EMPORIX_TENANT` | Required. Lowercased in every request path. |
| `client_id` | `EMPORIX_CLIENT_ID` | With `client_secret`: client-credentials flow (recommended). |
| `client_secret` | `EMPORIX_CLIENT_SECRET` | Provider mints the token itself. |
| `access_token` | `EMPORIX_ACCESS_TOKEN` | Alternative to id/secret: supply a bearer token directly. |
| `scope` | `EMPORIX_SCOPE` | Optional, free-form. See below. |
| `api_url` | `EMPORIX_API_URL` | Defaults to `https://api.emporix.io`. |

**Scope string.** Space-separated, tenant-prefixed:
`tenant=<tenant> <service>.<scope> <service>.<scope> …`, e.g.
`tenant=acme configuration.configuration_manage configuration.configuration_view`.
The provider does not hard-code scopes — if `scope` is empty it sends none, and the
token carries whatever the key's default scopes are. Set it explicitly to prove a
least-privilege key. **Requesting a scope the key lacks does not error** — the token
call returns `200` with that scope silently absent; read back the token's `scope`
field to confirm (this is the `emporix-auth` diagnosis path for a later 403).

## The modelled resources

Eleven resources, **no data sources** — you cannot look up an entity you did not
create through Terraform; everything is a managed `resource`.

| Resource | Emporix concept |
|---|---|
| `emporix_sitesettings` | Site settings (a site plus its mixins) |
| `emporix_paymentmode` | Payment modes (INVOICE, CASH_ON_DELIVERY, …) |
| `emporix_country` | Country **active** toggle — pre-populated, update-only (see Pitfalls) |
| `emporix_currency` | Currencies (ISO-4217) |
| `emporix_tenant_configuration` | Generic tenant configuration key/value store |
| `emporix_webhook` | Webhook subscriptions |
| `emporix_shipping_zone` | Shipping zones (per site) |
| `emporix_shipping_method` | Shipping methods (per zone) |
| `emporix_delivery_time` | Delivery times / windows |
| `emporix_schema` | Mixin schemas (Schema Service) |
| `emporix_tax` | Taxes / tax classes (per country) |

For each resource's argument reference and a full worked example, read its page in
the provider docs (`registry.terraform.io/providers/emporix/emporix/latest/docs`,
mirrored in the provider repo's `docs/resources/` and `examples/<resource>/`). The
repo examples are partner-quality, not stubs — start from them.

**Scope names: look them up, never guess.** Each resource maps to one Emporix
service; its scope pair follows `{service}.{resource}_{manage|read}` (read is
sometimes spelled `_view`, e.g. `configuration.configuration_view`). The
authoritative list is each operation's OpenAPI `security` block (the service's API
reference). Grant only the pairs for the resources in your configuration.

A minimal single-resource config, to make the shape concrete:

```hcl
resource "emporix_tenant_configuration" "feature_flags" {
  key = "storefront.feature_flags"
  # value MUST be valid JSON — wrap it in jsonencode(); see Pitfalls.
  value = jsonencode({ checkout_v2 = true })
}
```

## Escape hatch: config surfaces the provider does not model yet

Some tenant-**configuration** surfaces have no provider resource yet: the
`indexing-service`, the `unit-handling-service`, country **regions** (`emporix_country`
toggles only `active`), and any untyped tenant-config key. Until the provider catches
up, manage these with the raw Configuration-Service-family REST API, driven from the
same credentials. Keep the escape hatch **inside the configuration domain** — it is
not a licence to script products, prices, or orders from Terraform; those route
elsewhere.

Mint a token with only the scope the surface needs, then call the endpoint. Example —
a measurement unit via the un-modelled unit-handling service:

```bash
TOKEN=$(curl -s -X POST "${EMPORIX_API_URL:-https://api.emporix.io}/oauth/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d grant_type=client_credentials \
  -d "client_id=$EMPORIX_CLIENT_ID" -d "client_secret=$EMPORIX_CLIENT_SECRET" \
  --data-urlencode "scope=tenant=$EMPORIX_TENANT unithandling.unit_manage" \
  | jq -r .access_token)

# Create. Content-Language is REQUIRED — omitting it fails with
# 400 "The Content-Language cannot be empty", which looks unrelated to the body.
curl -X POST "https://api.emporix.io/unit-handling/$EMPORIX_TENANT/units" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H 'Content-Language: en' \
  -d '{"code":"box6","name":"box of six","type":"quantity","baseUnit":false,"factor":6}'
```

You lose Terraform state for anything managed this way — you own its lifecycle
(create/read/delete) by hand or in a `null_resource`/`local-exec` wrapper. Prefer a
provider resource whenever one exists; reach for the escape hatch only for the gaps.

## Pitfalls

- **`value` must be JSON, not a raw string.** `emporix_tenant_configuration.value`
  is a string field but the platform requires its content to be valid JSON. A bare
  string fails at create with `Error: Invalid JSON … invalid character 'w'`. Always
  wrap it: `value = jsonencode("plain")` or `value = jsonencode({ … })`.
- **JSON round-trip is asymmetric.** `jsonencode("x")` means Terraform state/output
  holds the encoded form `"\"x\""`, while the API returns the **decoded** value
  (`"value":"x"`). When you read a key back through the API to verify, expect the
  decoded form — a mismatch here is the encoding, not a failed write.
- **`Content-Language` header on raw config writes.** Unit-handling (and sibling
  config services) reject a create/update without a `Content-Language` header —
  `400 "The Content-Language cannot be empty"`. Send `Content-Language: en` (or a
  language map with `*`). This is not visible from the request body.
- **Scope service-name ≠ URL path — and both are right.** The unit-handling scope
  is `unithandling.unit_manage` (no hyphen) while its endpoint path is
  `/unit-handling/{tenant}/units` (hyphenated). Do not "normalise" one to match the
  other; copy each as written. Missing scopes surface as `403 "Scope validation
  failed … Missing required scopes '[unithandling.unit_manage]'"`.
- **`emporix_country` is update-only.** Countries are pre-populated; you cannot
  create or delete one, only toggle `active`. The resource auto-adopts the existing
  country with **no `terraform import`** step. It cannot manage regions or other
  country attributes — those are read-only here (regions route to the escape hatch).
- **No data sources.** There is nothing to look up an existing entity you did not
  create in this state. Manage it as a `resource` (Terraform will adopt/create it) or
  read it via the raw API.
- **0.x state can break across upgrades.** `emporix_schema` unlimited-OBJECT nesting
  in provider 0.7.0 required "resource remove and import to state." Pin the version,
  read the provider CHANGELOG before bumping, and plan a state migration for a minor
  upgrade rather than assuming it is transparent.
- **A 403 on a provider call is a missing scope, not a bad token** (a 401 is the bad
  token/tenant). The provider surfaces the API's status; fix it by widening the key's
  scopes in `emporix-auth`, then re-run — scopes cannot be added to an existing key.

## Verify

Run against a **test** tenant. Each step is a full self-cleaning lifecycle that
leaves the tenant as it started; report each check PASS / FAIL / BLOCKED with the raw
status code. Export `EMPORIX_TENANT`/`EMPORIX_CLIENT_ID`/`EMPORIX_CLIENT_SECRET`.
Check 1 is the provider, which reads `EMPORIX_SCOPE` — set it to
`configuration.configuration_manage configuration.configuration_view`. Checks 2 and 3
mint their own narrower tokens with `curl` (as shown in each), so they do not rely on
`EMPORIX_SCOPE`.

1. **Provider CRUD lifecycle** (proves the modelled path). With a `.tf` declaring a
   throwaway `emporix_tenant_configuration` key such as `terraform_verify_probe`
   (`value = jsonencode("probe")`):
   - `terraform apply -auto-approve` → `Apply complete! Resources: 1 added`.
   - Read back live: `GET /configuration/{tenant}/configurations/terraform_verify_probe`
     with a `configuration.configuration_view` token → **200**, body value `"probe"`
     (decoded — not `"\"probe\""`).
   - `terraform destroy -auto-approve` → `1 destroyed`; the same `GET` → **404**.
   A `401` on the read-back means the token/tenant is wrong (go to `emporix-auth`); an
   `Error: Invalid JSON` at apply means `value` was not `jsonencode`d.

2. **Raw-API escape-hatch lifecycle** (proves the fallback path). Mint a token scoped
   `tenant={tenant} unithandling.unit_manage`, then:
   - `POST /unit-handling/{tenant}/units` (with `Content-Language: en`, body a
     throwaway unit like `{"code":"tfverifyprobe","name":"probe","type":"mass","baseUnit":false,"factor":1}`)
     → **201**.
   - `GET /unit-handling/{tenant}/units/tfverifyprobe` → **200**.
   - `DELETE /unit-handling/{tenant}/units/tfverifyprobe` → **204**; the same `GET`
     → **404**.
   A `400 "The Content-Language cannot be empty"` means the header was omitted.

3. **Negative — out-of-scope is 403, not 401.** Mint a token scoped **only**
   `tenant={tenant} configuration.configuration_view` (read, no manage), then attempt
   a manage action — `POST /unit-handling/{tenant}/units` (needs `unithandling.unit_manage`)
   → expect **403 Forbidden**, and confirm the unit was not created. A `401` here means
   the token itself is wrong — a different failure; do not read it as a scope success.
