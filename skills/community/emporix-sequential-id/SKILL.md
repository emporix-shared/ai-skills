---
name: emporix-sequential-id
description: >-
  Manage sequence schemas in the Emporix Sequential ID Service and generate
  sequential document numbers. Use when defining or changing the format of
  order, invoice, quote, or pick-pack numbers, creating or activating a
  sequence schema, generating a nextId or a batch of IDs, running separate
  number ranges per vendor or per period (sequenceKey), resolving placeholders
  such as __year__ or __country__ via siteCode, or diagnosing "Active schema
  with the type ... doesn't exist", "Required Placeholder is missing", a 409
  "MaxValue is exceeded", gaps in generated numbers, or a 404 from the removed
  /sequential-id/sequenceSchemas endpoints.
license: CC-BY-4.0
metadata:
  validated: 2026-07-11 claude-code ACME-ERP clean-context run on tenant andidemo4, 8/8 Verify PASS (maintainer-executed gate c; evidence on branch acceptance-run-sequential-id)
  sources:
    - utilities/sequential-id/api-reference/api.yml
---

# Emporix Sequential ID Service

The Sequential ID Service turns a pattern definition (a **sequence schema**)
into gapless-looking, unique, incrementing document numbers — order numbers,
invoice numbers, quote numbers, or any custom range you define. Emporix
services pull their document numbers from the **active** schema of the
matching schema type, so changing an order-number format is a create + activate
operation, never an edit. Your own integrations can define custom schema types
and draw numbers from them directly.

Base URL for all calls: `https://api.emporix.io`. Tenant names are always
lowercase. All calls are authorized with a service access token
(`Authorization: Bearer $TOKEN`); obtaining tokens and diagnosing 401/403 is
the `emporix-auth` skill's territory.

## Tenant prerequisites

- An Emporix tenant. Every tenant already ships with five active default
  schemas: `orderNoSequence`, `invoiceNoSequence`, `customerNoSequence`,
  `quoteNoSequence`, and `orderHoldingAreaNoSequence` — you replace their
  formats by activating your own schema of the same type, not by editing them.
- An API key (Developer Portal → Manage API Keys) carrying
  `sequentialid.schema_view` and, for schema management,
  `sequentialid.schema_manage`.
- Outbound HTTPS and `curl` (or an equivalent HTTP client).
- Optional, only for automatic date/country placeholder resolution: a site
  whose `siteCode` you know (most tenants have `main`).

## The two scopes

| Scope | Grants |
|---|---|
| `sequentialid.schema_view` | Listing and reading schemas — **and generating IDs** (`nextId`, batch). Generation advances a counter but still only needs the view scope. |
| `sequentialid.schema_manage` | Creating, activating, and deleting schemas. It does **not** include the view scope — a manage-only token cannot list schemas or generate IDs. |

An ID-generating integration therefore needs only `schema_view`; give
`schema_manage` to the setup/administration path alone. A missing scope
returns `403` with a body naming the missing scope in
`details[].message` ("Missing one of required scopes '[...]'").

## Which schema type?

The `schemaType` string links a schema to the Emporix entity that consumes it:

| Entity | schemaType |
|---|---|
| Order | `orderNoSequence` |
| Invoice | `invoiceNoSequence` |
| Quote | `quoteNoSequence` |
| Pick-pack | `orderHoldingAreaNoSequence` |
| Customer | `customerNoSequence` |

For number ranges only your own code draws from, invent your own type — any
alphanumeric string (`^[a-zA-Z0-9]*$`) works, e.g. `acmeTicketSequence`. The
service treats platform and custom types identically; only the consumers
differ.

## Anatomy of a schema

```json
{
  "name": "orderNumbers2026",
  "schemaType": "orderNoSequence",
  "preText": "ORD-__year__-",
  "postText": "-EU",
  "startValue": 1000,
  "maxValue": 999999999,
  "numberOfDigits": 6,
  "placeholders": { "__year__": { "required": true } }
}
```

- Generated IDs are `preText + counter + postText`, with the counter
  zero-padded to `numberOfDigits`. The schema above yields
  `ORD-2026-001001-EU` first.
- **The first generated number is `startValue + 1`**, not `startValue`; the
  counter pre-increments on every generation.
- `maxValue` is the last usable counter value; the generation after it
  returns `409` ("Not enough free ids left in this schema. MaxValue is
  exceeded").
- `placeholders` declares the `__token__` strings used in `preText`/
  `postText`. A `required: true` placeholder must be supplied on every
  generation call (in the body, or via `siteCode` for the date/country set
  below) — otherwise the call fails with `400 Required Placeholder is
  missing`. Do not rely on the placeholder `default` property: a required
  placeholder with a `default` still fails when the value is not supplied.
- Required fields on creation: `name`, `startValue`, `maxValue`,
  `numberOfDigits`. Schemas are immutable in practice — there is no update
  endpoint; to change a format, create a new schema and activate it.

## Setting up a number format (checklist)

1. **Create** the schema:

   ```bash
   curl -s -w '\n%{http_code}' -X POST "https://api.emporix.io/sequential-id/{tenant}/schemas" \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"name":"orderNumbers2026","schemaType":"orderNoSequence","preText":"ORD-","startValue":1000,"maxValue":999999999,"numberOfDigits":6}'
   ```

   Returns `201` with the new schema's ID as a **plain-text body** (e.g.
   `6915e2eb3b4c2e6c7c80711b`) — not a JSON object. Capture it as-is.

2. **Activate** it:

   ```bash
   curl -X POST "https://api.emporix.io/sequential-id/{tenant}/schemas/{schemaId}/setActive" \
     -H "Authorization: Bearer $TOKEN"
   ```

   Returns `200` with an empty body. Exactly one schema per type is active:
   activating one automatically deactivates the previously active schema of
   the same type — there is no separate deactivate call, and no downtime
   window.

3. **Confirm** with `GET .../schemas/{schemaId}` (expect `active: true`) or
   `GET .../schemas/types/{schemaType}` (lists all schemas of the type with
   their `active` flags and `counter` values — `counter` is the last number
   issued).

Always activate before generating: a schema deactivated by a newer activation
(`active: false`) is never used, and generation for a type whose active
schema was deleted fails with `404 "Active schema with the type ... doesn't
exist!"` until another schema of that type is activated. (A single
never-activated schema of a type happens to serve generation, but do not
build on that — activate explicitly.)

## Generating IDs

**Single ID** — `POST .../schemas/types/{schemaType}/nextId` (body required;
`{}` is valid when the schema has no required placeholders):

```bash
curl -s -X POST "https://api.emporix.io/sequential-id/{tenant}/schemas/types/orderNoSequence/nextId?siteCode=main" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"placeholders": {"__vendorName__": "acme"}}'
```

Returns `201` with `{"id": "ORD-2026-001001-EU"}`.

- `siteCode` (query, optional) resolves the built-in placeholders
  `__year__`, `__month__`, `__day__`, `__hour__`, `__minute__`, `__second__`
  (from the site's `homeBase.timezone`, default UTC) and `__country__` (from
  `homeBase.address.country`, default `DE`). Without `siteCode`, every
  required placeholder — including the date ones — must be in the body.
- Body placeholder values override site-derived ones.

**Separate number ranges (pools)** — pass `sequenceKey` in the body to give
each vendor, period, or channel its own independent counter under one schema:

```json
{ "sequenceKey": "2026-07", "placeholders": { "__year__": "2026", "__month__": "07" } }
```

The first use of a key clones the **active** base schema into a derived
schema whose `schemaType` is `{baseType}--{sequenceKey}` (it appears in the
schema list; delete these too when cleaning up). Each pool counts from
`startValue + 1` independently; calls without `sequenceKey` use the base
("default") pool. A `sequenceKey` call fails with `404` naming the derived
type when the base type has no active schema.

**Batch** — `POST https://api.emporix.io/sequential-id/sequenceSchemaBatch/nextIds`
reserves several IDs across several types in one call. Two things look wrong
but are right: the path has **no `{tenant}` segment** (the tenant comes from
the token), and the request keys are **`schemaType` values, not schema
names**:

```bash
curl -s -X POST "https://api.emporix.io/sequential-id/sequenceSchemaBatch/nextIds" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"orderNoSequence": {"numberOfIds": 3}, "invoiceNoSequence": {"numberOfIds": 1, "placeholders": {"__year__": "2026"}}}'
```

Returns `201` with `{"orderNoSequence": {"ids": ["...","...","..."]}, ...}`.
Each entry also accepts `sequenceKey`; `numberOfIds` minimum is 1.

## Pitfalls

- **Failed generation calls still consume numbers.** A `nextId` rejected
  with `400` (missing placeholder) or `409` (maxValue) has already advanced
  the counter — expect gaps after errors, and don't treat gaps as data loss.
  Fix the request, don't retry blindly in a loop.
- **Reading a deleted or nonexistent schema ID returns `200` with an empty
  body, not `404`.** To prove a schema exists or is gone, check the list
  endpoints, never GET-by-ID emptiness alone. `DELETE` is idempotent (`204`
  even for nonexistent IDs); only `setActive` gives a clean `404` for a
  missing ID.
- **The legacy tenant-less endpoints under `/sequential-id/sequenceSchemas`
  were removed on 2025-10-15.** Older tutorials and integrations still show
  `POST /sequential-id/sequenceSchemas` and
  `POST /sequential-id/sequenceSchemas/{schema}/nextIds`; these now return
  `404 {"error":"Not Found","path":"/sequenceSchemas"}`. Use
  `/sequential-id/{tenant}/schemas` and
  `/sequential-id/{tenant}/schemas/types/{schemaType}/nextId`. The batch
  endpoint (`/sequential-id/sequenceSchemaBatch/nextIds`) is the one current
  endpoint without a tenant segment.
- **Deleting the active schema silently breaks generation for its type**
  (404 on the next `nextId`) — activate a replacement first, then delete.
- **IDs are unique per pool, not globally**: two schemas, or two
  `sequenceKey` pools, can emit the same counter value. Distinguish pools in
  `preText`/`postText` if their outputs meet in one system.
- The endpoint list, field constraints, and scope names above are
  enumerable facts that live in the OpenAPI spec — when in doubt, read
  `utilities/sequential-id/api-reference/api.yml` in
  `github.com/emporix/api-references` rather than guessing.

## Verify

Run after setting up a schema. Use a throwaway custom `schemaType` (e.g.
`verifyTestSequence`) so platform numbering is untouched; `$TOKEN` carries
both sequentialid scopes, `$VIEW_TOKEN` only `sequentialid.schema_view`.

1. **Create returns the ID as plain text.**
   `POST /sequential-id/{tenant}/schemas` with
   `{"name":"verify-test","schemaType":"verifyTestSequence","preText":"V-","startValue":10,"maxValue":99999,"numberOfDigits":4}`
   → expect `201` and a bare schema-ID string body (no JSON braces).
2. **Activation is visible.** `POST .../schemas/{schemaId}/setActive` →
   expect `200`; then `GET .../schemas/{schemaId}` → expect `200` with
   `"active": true`.
3. **First ID is startValue + 1, zero-padded.**
   `POST .../schemas/types/verifyTestSequence/nextId` with body `{}` →
   expect `201` and exactly `{"id":"V-0011"}`. A `404` here means the schema
   is not active — redo check 2.
4. **The counter advances by one.** Repeat check 3 → expect `V-0012`; and
   `GET .../schemas/{schemaId}` shows `"counter": 12`.
5. **Pools are independent.** Same call with body
   `{"sequenceKey":"poolA"}` → expect `201` and `V-0011` again (fresh pool),
   and the schema list now contains a derived entry with schemaType
   `verifyTestSequence--poolA`.
6. **Manage actions are denied to the view scope.** Re-run check 1's create
   with `$VIEW_TOKEN` → expect `403` (not `401`) with a `details[].message`
   naming `sequentialid.schema_manage`. A `401` means the token itself is
   bad — that is an auth problem, not a scope problem.
7. **No active schema means no IDs.** `POST
   .../schemas/types/verifyNoSuchSequence/nextId` with `{}` → expect `404`
   with message `Active schema with the type verifyNoSuchSequence doesn't
   exist!`.
8. **Cleanup is provable.** `DELETE .../schemas/{schemaId}` for the test
   schema and its `--poolA` derivative → expect `204` each; then
   `GET .../schemas` → expect neither `verifyTestSequence` entry in the
   list (do not use GET-by-ID as the proof — it returns `200` empty for
   deleted schemas).
