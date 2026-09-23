---
name: emporix-extensibility
description: >-
  Extend the Emporix data model with the Schema Service — add custom fields
  (mixins) to core entities like Product, Order, Customer, or Cart; define
  brand-new custom entity types and their custom instances; and query custom
  data with the q-param filter language. Use when adding a custom field or
  mixin to an entity, deciding between a mixin and a custom entity, creating
  a mixin schema or a custom type, writing or bulk-importing custom
  instances, wiring the three-tier custom-instance scope model
  (tenant-wide / type-specific / own-only), querying mixin fields, expanding
  references between custom entities, subscribing to custom-instance webhook
  events, or diagnosing a 400 mixin-validation error or a 403 on custom
  instances.
license: CC-BY-4.0
metadata:
  validated: 2026-07-11 claude-code ticket-14 clean-context run on tenant andidemo4, 7/7 Verify PASS (pre-GitHub; PR link when repo is public)
  sources:
    - utilities/schema/api-reference/api.yml
  drift-checked: doc-2026071011 changelog 2026-07-12
---

# Extending the Emporix data model

Emporix lets you extend its data model two ways, both driven by the **Schema
Service** (`https://api.emporix.io/schema/{tenant}/...`). A **mixin** adds
custom fields to an entity Emporix already owns (a Product, an Order, a
Customer). A **custom entity type** invents a wholly new kind of record that
Emporix does not have — it gets its own endpoints, its own records (**custom
instances**), and can carry mixins of its own. Everything a partner needs to
model — extra attributes, new object types, relationships between them — is
one of these two, plus the JSON-Schema definitions and access scopes that
back them.

Two facts shape almost every decision here and are stated once: a mixin's
**key is a permanent identifier** — it is stored inside every record that
carries the mixin, so renaming it later means rewriting every one of those
records; treat keys as stable from the first write. And custom data is
extended, queried, and secured through the same three primitives — **schema**,
**instance**, **scope** — so the workflows below all compose from them.

This skill owns the extension *mechanism*. Product-specific modelling advice
(which fields belong on a product, PIM alignment) is `emporix-product-data`;
choosing and obtaining a token, and reading back a scope, is `emporix-auth`;
generating order/invoice numbers is the Sequential ID service, a separate
skill. Finding a spec or guide page is `emporix-docs-navigation`.

## Tenant prerequisites

- A tenant on `api.emporix.io` and a bearer token (see `emporix-auth`). The
  scope you need depends on the operation:
  - Managing **schemas** and **custom types**: `schema.schema_manage`
    (read: `schema.schema_read`).
  - Managing **custom instances**: any of `schema.custominstance_manage`, the
    type-specific `custom.{type}_manage`, or `custom.{type}_manage_own`
    (read: the `_read` equivalents). The three-tier model is detailed below.
  - Attaching a mixin to a **core entity** additionally needs that entity's
    own manage scope (e.g. `product.product_manage`) — the mixin rides in the
    entity's own create/update call, so it is that service's scope that
    governs it, not a schema scope.
- Outbound HTTPS and a tool that can send `POST`/`PUT`/`PATCH`/`DELETE` with
  a JSON body and headers (curl, an HTTP client, or an MCP HTTP tool).
- For mixins on entities **not** served by Schema Service schema creation
  (see the table below), a place to host a JSON-Schema file at a public
  HTTPS URL.

## Which extension mechanism? Decide first

```
Is the data "extra information about" a thing Emporix already has
(Product, Order, Customer, Cart, Category, ...)?
│
├── YES ─► Is that entity in the Schema-Service-supported list (below)?
│          ├── YES ─► MIXIN, schema created via the Schema Service
│          └── NO  ─► MIXIN, but you hand-host the JSON schema yourself
│
└── NO  ─► Does the data have its own identity and lifecycle
           (you would say "a <thing>", list them, manage them)?
           ├── YES ─► CUSTOM ENTITY TYPE + custom instances
           └── NO  ─► It is probably still a mixin — reconsider.
```

**Schema-Service-supported entities** (schema *creation* through the Schema
Service, and Management Dashboard UI): Cart, Cart Item, Category, Company,
Coupon, Custom Entities, Customer, Customer Address, Media, Order, Order
Entry, Price List, Product, Quote, Return, Site, Vendor.

**Mixin-accepting but not Schema-Service-created** (you author and host the
JSON schema, then reference its URL): Availability, Customer/Item
Assignments, Customer Segments, IAM Groups, Locations (Vendor & Client
Management), Prices, Returns, Shopping List. The authoritative, current list
lives in the mixins standard-practices page — check it rather than trusting a
copy, because entities move between these lists (Media and Cart Item were
added recently).

## The mixin data shape: two parallel maps

An entity that carries mixins holds **two** maps keyed by the same mixin key:

```json
{
  "id": "...",
  "mixins":   { "<key>": { "<field>": <value>, ... } },
  "metadata": { "mixins": { "<key>": "<schema-url>" } }
}
```

- `mixins.<key>` holds the **values**.
- `metadata.mixins.<key>` holds the **schema URL** the values are validated
  against on save.
- The two maps must be keyed identically — a value map with no matching
  schema URL is rejected, and the platform validates `mixins.<key>` against
  the JSON Schema at `metadata.mixins.<key>` on every write.

**What is `<key>`?** It depends on how the schema was created, and getting
this wrong is the most common mistake:

- **Schema-Service-created schema:** `<key>` is the schema's **`id`**. Set
  that `id` yourself at creation to a readable, stable value (e.g.
  `contractFields`) — **recommended**, because the id becomes the mixin key
  stored on every record and used in every q-param path, and readable keys
  keep those legible. If you omit `id`, the server assigns an opaque hex id
  (`6a528a72...`) and you are stuck with it. Note it is the `id` field that
  sets the key — a `key` field in the create body is ignored.
- **Hand-hosted schema:** `<key>` is whatever readable name you choose (e.g.
  `deliveryOptions`) and reference alongside your own hosted URL.

Two documented exceptions, each of which a fresh reader will otherwise "fix"
into a bug:

- **IAM Groups** put the mixin values in a top-level `mixins` field with
  **no** `metadata.mixins` wrapper. This is correct for Groups only.
- Some guide examples show the schema URL under `metadata.mixinMetadata.mixins`
  rather than `metadata.mixins`. The current API accepts `metadata.mixins`;
  use that. If a specific service's spec example shows `mixinMetadata`,
  follow the spec for that service and confirm with a read-back.

## Workflow: mixin on a core entity

1. **Create the schema** (once per tenant), targeting one or more entity
   types. `name` is a localized map; `attributes` is the field list.

   ```bash
   curl -X POST 'https://api.emporix.io/schema/{tenant}/schemas' \
     -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' \
     -d '{
       "id": "productCustomAttributes",
       "name": { "en": "Product Custom Attributes" },
       "types": ["PRODUCT"],
       "attributes": [
         { "key": "warrantyMonths", "name": { "en": "Warranty (months)" },
           "type": "NUMBER", "metadata": { "required": false } }
       ]
     }'
   ```

   Set a readable `id` (here `productCustomAttributes`) — it is the mixin
   `<key>` (see "What is `<key>`?" above). The create response returns
   `{ "id": "..." }`; to get the schema URL you then
   `GET /schema/{tenant}/schemas/{id}` and read **`metadata.url`** (a
   `res.cloudinary.com/.../schemata2/{tenant}/{id}_v{n}.json` URL — the hosted
   JSON Schema you reference from entity payloads). Each entry in `attributes`
   has its own `key` naming a field *within* the mixin. Required scope:
   `schema.schema_manage`.

2. **Attach it** by writing the entity through *its own* service with both
   maps populated. For a product that is `PUT/PATCH /product/{tenant}/products/{id}`
   with `mixins.<key>` and `metadata.mixins.<key>` — governed by the product
   scope, not a schema scope.

3. **Localized fields** in mixin values need a `Content-Language` header on
   the write, exactly as elsewhere in the platform — without it a localized
   value can be rejected with a 400 about string type.

## Workflow: hand-hosted mixin (unsupported entities)

For an entity in the second list above, the Schema Service will not create
the schema. Author the JSON Schema yourself (draft-04 object schema), host it
at a public HTTPS URL, and reference that URL in `metadata.mixins.<key>`
exactly as in the core-entity flow. Everything downstream — validation on
save, q-param queries, the value/URL split — is identical; only schema
authorship and hosting move to you.

## Workflow: custom entity type + instances

1. **Create the type.** The endpoint is `POST /schema/{tenant}/custom-entities`
   — the type resource, not a separate `/custom-types` path (there is none;
   that path 404s). The `id` is UPPERCASE letters, digits, and underscores
   (digits allowed since a 2026 change). Creating a type auto-provisions its
   four scopes (below).

   ```bash
   curl -X POST 'https://api.emporix.io/schema/{tenant}/custom-entities' \
     -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' \
     -d '{ "id": "SERVICE_CONTRACT", "name": { "en": "Service Contract" } }'
   ```

   The path is overloaded: `/custom-entities` (no type) manages the **types**;
   `/custom-entities/{type}/instances` manages the **instances** of one type.

2. **Optionally define a mixin schema** targeting the type (same schema
   endpoint, `"types": ["SERVICE_CONTRACT"]`) — this is how a custom entity
   gets typed fields, including references.

3. **Write instances** under the type. The body mirrors the core-entity
   shape (`mixins` + `metadata.mixins`), plus an optional `owner`:

   ```bash
   curl -X POST 'https://api.emporix.io/schema/{tenant}/custom-entities/SERVICE_CONTRACT/instances' \
     -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' \
     -d '{
       "id": "SC-001",
       "name": { "en": "Gold cover" },
       "mixins":   { "contractFields": { "termMonths": 24 } },
       "metadata": { "mixins": { "contractFields": "<schema-url>" } }
     }'
   ```

   Required scope: `schema.custominstance_manage` (or a type-specific manage
   scope). Add `?validateReferences=false` for bulk imports where referenced
   records may not exist yet. Bulk create/upsert/patch/delete endpoints exist
   (patch bulk caps at 200 per request); use them for volume rather than
   looping single calls.

4. **Retrieve** with `GET .../instances/{id}`; expand references with
   `?expand=<field>` (or `?expand=*`). Unexpanded references return
   `{ id, type }`; expanded ones include the full referenced `resource`.

## References between entities

Reference-type fields model relationships, and one rule is load-bearing:
**a REFERENCE field is only valid on a mixin schema attached to a custom
entity**, never on a core entity's mixin. So a Product↔ServiceContract link
lives on the *ServiceContract* side (a reference field pointing at
`PRODUCT`), not on the product. A reference can target another custom entity
type or one of the core types the Schema Service allows (`CART`, `CATEGORY`,
`CUSTOMER`, `CUSTOMER_SEGMENT`, `CLASSIFICATION`, `LEGAL_ENTITY`, `MEDIA`,
`ORDER`, `PRICE_LIST`, `PRODUCT` — confirm against the field-types spec, as
the set grows). Adding *relation types* between core commerce entities (e.g.
product accessory/consumable relations) is a different, non-schema mechanism
and is not done here.

## Field types

Ten base types — `TEXT` (localizable), `NUMBER`, `DECIMAL`, `BOOLEAN`,
`DATE`, `DATE_TIME`, `TIME`, `ENUM`, `OBJECT`, `ARRAY` — plus `REFERENCE`
(custom-entity mixins only). `ARRAY` holds any base type including `OBJECT`
and `REFERENCE`. Per-field settings (`required`, `readOnly`, `nullable`,
`localized`, `arrayType`, enum `values`, `referenceType`) and the exact
attribute schema live in the Schema Service spec — read it there rather than
guessing, since attribute validation is strict. Note `NUMBER` generates an
`integer`-typed field in the hosted JSON Schema; use `DECIMAL` when values can
be fractional.

## Access control: the three-tier scope model

Creating a custom type `SERVICE_CONTRACT` auto-provisions four scopes
(the suffix is the **lowercased** type id):

`custom.service_contract_read`, `custom.service_contract_read_own`,
`custom.service_contract_manage`, `custom.service_contract_manage_own`.

Custom-instance endpoints accept any scope from the tier that fits the caller:

| Tier | Read | Manage |
|---|---|---|
| Tenant-wide (all types) | `schema.custominstance_read` | `schema.custominstance_manage` |
| One type | `custom.{type}_read` | `custom.{type}_manage` |
| One type, own records only | `custom.{type}_read_own` | `custom.{type}_manage_own` |

Every instance carries a read-only `owner` (`{ type: EMPLOYEE|CUSTOMER|SERVICE,
userId, legalEntityId? }`) set at creation. The `_own` scopes authorize only
when `owner.userId` equals the caller's user id — so a service account
seeding data with a broad `custom.{type}_manage` becomes the `owner` of every
record it writes, and a customer given `custom.{type}_read_own` sees only
their own. Pick the narrowest tier that satisfies the caller (least
privilege). This model shipped 2026-04-13 and was flagged "under
development": trust API behaviour over Dashboard UI, and read a scope back
rather than assuming it applied (see `emporix-auth` for the silent-scope-drop
pitfall).

## Querying mixin fields (q-param)

List/search endpoints accept a `q` filter. Mixin fields are addressed by
their dotted path from the mixin key:

- `q=mixins.contractFields.termMonths:24` — exact match.
- `q=mixins.contractFields.termMonths:>=12` — `>`, `<`, `>=`, `<=` for
  numbers and dates (dates in double quotes).
- `q=mixins.contractFields.termMonths:(>=12 AND <=24)` — range.
- `q=mixins.contractFields:exists` / `:missing` — whether the mixin is set.
- `q=name.en:~Gold` — regex (`~`) on a string; localized fields take the
  language suffix (`name.en`).

For nested OR/AND across several conditions use
`q=compoundLogicalQuery:((...) OR (...))`. This operator is available on only
a few services — Approval, Availability, Product, Quote, and **Schema**
(custom instances) — so it works for custom-instance search but not
everywhere; fall back to single-field `q` on services without it.

## Versioning and migration

Editing a schema creates a new version; existing records stay pinned to the
version they were saved against until re-saved, so a schema change never
silently rewrites live data. A schema attached to several entity types can be
migrated on one type while the others stay on the old version — useful for
phased rollouts. For a breaking field change, add a new field and migrate
rather than changing a field's type in place; removed fields keep their stored
values but stop being validated.

## Custom-instance webhook events

The Schema Service publishes events on custom-instance create/update/delete,
consumable through the Webhook Service (Svix-backed subscriptions). The event
*payload* shapes are documented as markdown, not as a machine-readable schema
— locate them via `emporix-docs-navigation` (the `webhooks/events-*.md`
catalog) before wiring a subscription, rather than guessing the body.

## Pitfalls

- **Renaming a mixin key rewrites every record.** The key is stored on each
  record; there is no rename. Symptom if you try: old data keeps the old key,
  new data the new one, and queries split. Choose the key deliberately.
- **Deleting a custom type does not remove its scopes.** The auto-provisioned
  `custom.{type}_*` scopes persist; clean them up via the IAM service if it
  matters.
- **Delete in dependency order.** A custom type will not delete while schemas
  or instances still reference it: delete/reassign instances → delete mixin
  schemas targeting the type → delete the type.
- **A 400 on a mixin write** is validation: a required field missing, a type
  mismatch (a string where a number is expected), an enum value out of set,
  or the value map keyed differently from the schema-URL map. Read the schema
  the URL points at and diff it against the payload.
- **A 403 on custom instances** names the missing right — either
  `Required scope(s): schema.custominstance_manage` or, for a type-specific
  gap, `Missing required scopes to manage a custom instance of type: '<TYPE>'`.
  Assign the scope (IAM) and, because scopes are baked into the token at
  issuance, fetch a **new** token afterwards; an old token keeps failing even
  after the scope is granted.
- **Empty q-param result** can mean the field path is wrong (mixin key
  mis-typed) rather than no matches — probe with `q=mixins.<key>:exists`
  first to confirm the mixin is present at all.

## Verify

Run against a tenant meeting the prerequisites. Use a test-obviously-named
type and clean up at the end. Report each check PASS / FAIL / BLOCKED with the
raw status code and response fragment.

1. **Create a custom type.** `POST /schema/{tenant}/custom-entities` with
   `{"id":"SC_VERIFY","name":{"en":"Verify type"}}` and `schema.schema_manage`
   → **201** returning `{"id":"SC_VERIFY"}`. A **404** means you used
   `/custom-types` (wrong path). A **403** means the token lacks
   `schema.schema_manage` (not a custom-instance scope) — different failure.
2. **Create a mixin schema for the type.** `POST /schema/{tenant}/schemas`
   with a readable `"id":"scVerifyFields"`, `"types":["SC_VERIFY"]`, and one
   `NUMBER` attribute (`key: warrantyMonths`) → **201** returning
   `{"id":"scVerifyFields"}`. Then `GET /schema/{tenant}/schemas/scVerifyFields`
   → **200** with a resolvable `metadata.url`. A **400** naming an attribute
   field means the attribute definition is malformed — read the spec's
   attribute schema.
3. **Write an instance carrying the mixin.** `POST
   /schema/{tenant}/custom-entities/SC_VERIFY/instances`, using the **schema
   `id` from step 2 as the mixin key**: `mixins.scVerifyFields.warrantyMonths`
   set and `metadata.mixins.scVerifyFields` = the `metadata.url` from step 2,
   with `schema.custominstance_manage` → **201**. A **400**
   `The schema cannot be downloaded` means `metadata.mixins.<key>` is wrong or
   missing; a **400** validation error means value/URL keys disagree or a type
   mismatch; a **403** means a custom-instance manage scope is missing.
4. **q-param query returns it.** `GET
   /schema/{tenant}/custom-entities/SC_VERIFY/instances?q=mixins.scVerifyFields.warrantyMonths:24`
   → **200** and the response array contains the instance from step 3.
5. **Negative — non-matching query returns nothing.** The same query with a
   value no instance has (`...:9999`) → **200** with an **empty** array (not
   the instance). This proves the filter discriminates; a non-empty result
   here is a FAIL (the q-param was ignored).
6. **Negative — a token without manage scope cannot write.** Repeat step 3's
   `POST` with a token that lacks any custom-instance *manage* scope → **403**
   whose body names the missing manage scope (observed:
   `Missing required scopes to manage a custom instance of type: 'SC_VERIFY'`).
   A **201** here means the scope split is not enforced — FAIL. (To get a
   read-only token from a broadly-scoped client, request
   `scope=schema.custominstance_read` on the client-credentials call — see
   `emporix-auth`.)
7. **Teardown + read-back.** Delete the instance, the schema, then the type
   (`DELETE /schema/{tenant}/custom-entities/SC_VERIFY`) → **204** each;
   re-`GET` the type → **404**. Confirms the tenant is restored. (The
   auto-provisioned `custom.sc_verify_*` scopes persist by design — note them,
   do not treat their presence as a failed teardown.)
