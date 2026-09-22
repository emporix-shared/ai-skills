---
name: emporix-auth
description: >-
  Authenticate against the Emporix Commerce Engine API. Use when obtaining or
  choosing between Emporix token types (service access, anonymous, customer,
  SSO / token exchange, B2B legal-entity, MCP), composing OAuth token requests,
  selecting minimal scopes for an API key or integration, or diagnosing 401 /
  403 responses from any api.emporix.io endpoint.
license: CC-BY-4.0
metadata:
  validated: 2026-07-11 claude-code ticket-11 re-run after key-immutability fix (pre-GitHub; PR link when repo is public)
  sources:
    - authentication/oauth-service/api-reference/api.yml
    - users-and-permissions/iam/api-reference/api.yml
    - companies-and-customers/approval-service/approval-api-reference/api.yml
  drift-checked: doc-2026071011 changelog 2026-07-12
---

# Emporix authentication and authorization

Every Emporix API call is authorized by an OAuth 2.0 bearer token, and every
endpoint declares which scopes that token must carry. Six different token
types exist because the platform distinguishes machine integrations, employee
users, and storefront customers. Picking the wrong type — or a key that cannot
carry the scope you need — is the most common cause of failed integrations.

Base URL for all endpoints below: `https://api.emporix.io`. Tenant names are
always lowercase.

## Tenant prerequisites

- An Emporix tenant and access to its Developer Portal (https://app.emporix.io).
- The tenant's out-of-the-box API credentials, found under **Manage API Keys**:
  - **Emporix API** credentials (Client ID + Secret) — full, unrestricted access.
  - **Storefront API** credentials (Client ID) — for anonymous/customer tokens.
- For least-privilege work (recommended for any integration): one **custom API
  key** created in the Developer Portal with only the scopes the task needs.

## Which token type do I need?

Walk this tree top-down; the first match wins.

1. **Backend / server-to-server / script / CI job calling Emporix APIs?**
   → **Service access token**. Machine identity, no human involved.
2. **An AI agent connecting to the hosted Emporix MCP server?**
   → **MCP token** (a packaging of custom-API-key credentials, not an OAuth
   token — see below).
3. **A storefront user who has not logged in?**
   → **Anonymous token**. Carries the `sessionId` that preserves the guest's
   cart and session across login.
4. **A storefront user logging in with email/password?**
   → **Customer token** (returns `access_token` + `saas_token` +
   `refresh_token`). Requires an anonymous token first.
5. **A storefront user authenticated by your own / external IdP?**
   → **SSO**: either the Emporix-managed authorization-code flow or the
   client-owned **token exchange** flow. Never mix the two in one
   implementation.
6. **A logged-in B2B customer acting on behalf of a company (legal entity)?**
   → Refresh the customer token with `legalEntityId` — the "B2B token".

Employee (Management Dashboard) users authenticate via SSO login to the
Emporix applications; integrations should not impersonate employees — use a
service access token with restricted scopes instead.

## Service access token

`POST /oauth/token`, form-encoded, `client_credentials` grant:

```bash
curl -s -X POST 'https://api.emporix.io/oauth/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "client_secret=$CLIENT_SECRET" \
  --data-urlencode 'scope=currency.currency_read'
```

- `scope` is optional; separate multiple scopes with spaces
  (`scope=currency.currency_read price.price_manage`). **Omit it and the
  token carries every scope assigned to the API key** — convenient for exploration,
  wrong for production. Always request explicit scopes in integrations.
- The tenant is bound to the API key; you do not pass it. The response's
  `scope` string ends with `tenant={yourtenant}` — check it to confirm which
  tenant the key belongs to.
- Response: `access_token`, `token_type: Bearer`, `expires_in` (seconds,
  typically 14399 ≈ 4 h), `scope` (the granted scopes — inspect this).
- **No refresh tokens for service access tokens.** No usable `refresh_token`
  is returned (the field is `null`, empty, or absent — do not write assertions
  against it). When the token expires, request a new one the same way; treat a
  mid-job `401` as expiry and re-request.

Use it on every call as `Authorization: Bearer {access_token}`.

## Anonymous token (storefront guest)

```
GET /customerlogin/auth/anonymous/login?tenant={tenant}&client_id={storefront_client_id}
```

Optional query parameters seed the session context: `siteCode`, `currency`,
`language`, `targetLocation`.

- Valid for one hour (`expires_in: 3599`); the response also returns a
  `refresh_token` (~24 h) and the `sessionId` that ties the guest session to
  the later customer session.
- Refresh with `GET /customerlogin/auth/anonymous/refresh?tenant={tenant}&client_id={client_id}&refresh_token={refresh_token}`
  to keep the same `sessionId`. (The `anonymous_token` parameter is
  deprecated; use `refresh_token`.)

## Customer token (storefront login)

`POST /customer/{tenant}/login` with JSON body `{"email": "...", "password":
"..."}`, **authorized with the anonymous token** (`Authorization: Bearer
{anonymous_access_token}`). The response contains:

- `access_token` — authenticates the customer (same `session_id` as the
  anonymous token).
- `saas_token` — additionally required to complete checkout.
- `refresh_token` — extends the session without re-login.

The correct storefront flow is a three-step contract; skipping a step loses
the customer's cart:

1. Anonymous token for guest browsing (returns `sessionId`).
2. `POST /customer/{tenant}/login` authorized with the anonymous token.
3. Merge the anonymous cart into the customer's cart:
   `POST /cart/{tenant}/carts/{cartId}/merge`.

Customer tokens carry a **predefined** scope set for storefront activity
(mostly `*_own` and `*ascustomer` scopes) — you cannot request extra scopes
on them. Log out (and invalidate) with
`GET /customer/{tenant}/logout?accessToken={access_token}`.

Refresh / extend the session:
`GET /customer/{tenant}/refreshauthtoken?refreshToken={refresh_token}` with
`Authorization: Bearer {customer_access_token}`.

### B2B: acting on behalf of a legal entity

B2B customers can represent multiple companies. The selected company is
embedded in the token, not passed per request:

1. Customer logs in normally (customer token).
2. Customer selects a legal entity; call
   `GET /customer/{tenant}/refreshauthtoken?refreshToken={refresh_token}&legalEntityId={id}`.
3. The new token embeds the legal entity; Emporix injects the
   `Legal-Entity-Id` header into downstream requests, which controls data
   visibility (own vs company-shared orders, approvals, segment-based product
   visibility).
4. Switching companies = another `refreshauthtoken` call with the new
   `legalEntityId`; no re-login.

Caveat: approvals created before the Approval Service started storing
`legalEntity` (platform change of 2026-06-09) are invisible to
legal-entity-scoped B2B tokens — intentionally not backward compatible.

## SSO for customers (external IdP)

Two mutually exclusive flows; choose one per implementation:

- **Authorization-code flow (Emporix-managed).** The storefront redirects to
  your OpenID Connect IdP (Keycloak, Auth0, ...); the IdP redirects back to an
  Emporix callback; Emporix exchanges the code server-side and issues Emporix
  tokens. Simplest integration; Emporix owns the flow end to end.
- **Token exchange (client-owned, RFC 8693 shape).** Your system authenticates
  the user with the IdP itself, then exchanges the external access token:
  `POST /customer/{tenant}/exchangeauthtoken` with `subjectAccessToken` (the
  IdP token) and `config` (the configuration key, typically the site, e.g.
  `Site_DE`). Returns Emporix `access_token`, `refresh_token`, `saas_token`.
  Token validation is configured per tenant (online introspection —
  recommended — or offline JWKS); the `tokenExchange` configuration is set up
  by Emporix Support (support@emporix.com).

Notes that bite in practice:

- Customer autoprovisioning is on by default: an unknown SSO user gets a
  customer profile created on first login. With
  `ssoCustomerAutoprovisioningDisabled: true`, unknown users get `404`.
- Customers are matched by `EMAIL` by default; switchable to the token's
  `sub` claim via `ssoCustomerIdentifierField`.

## MCP token (hosted Emporix MCP server)

The MCP token is **not** an OAuth access token: it is the Base64 encoding of
`clientId:secret` of a custom API key that carries the MCP scope plus the
scopes of the tools you want exposed. It is embedded in the server URL:

```
https://api.emporix.io/mcp/{domain}/{tenant}/{mcp_token}/mcp
```

- Domains: `product`, `order`, `customer`, `extensibility`,
  `frontend-facing`. Transport: streamable HTTP.
- The server only lists tools whose required scopes the token carries (e.g.
  `get-product` needs `product.product_read_unpublished`, `upsert-price`
  needs `price.price_manage`). A connected server with missing tools means
  missing scopes on the API key.
- Append `?tools=get-label,...` to expose only named tools and cut LLM
  context.
- Treat the URL as a credential: it contains the key material.

## Selecting minimal scopes

- Scope names follow `{service}.{resource}_{action}` (e.g.
  `product.product_manage`, `category.category_read`); `read` and `view` are
  interchangeable in names. Custom entities get auto-provisioned
  `custom.{lowercasetype}_read|manage` scopes plus `_own` variants that limit
  access to instances the caller created.
- **The authoritative source for an endpoint's scopes is its API reference**:
  every operation's OpenAPI `security` block lists the applicable scopes
  (developer.emporix.io API references, or the raw specs in
  github.com/emporix/api-references). Some read endpoints are implicitly
  readable and need no scope at all (e.g. retrieving currencies), and scope
  names are not uniform across services — e.g. there is no
  `product.product_read`; published products are readable without a scope and
  unpublished ones need `product.product_read_unpublished`. Always read the
  spec, never guess a scope name.
- Choose the scope that matches your action: prefer `_read` over `_manage`,
  and `_own`-suffixed or type-specific scopes over tenant-wide ones.
- Put the minimal scope set on a **custom API key** in the Developer Portal
  and request exactly those scopes in the token call. The out-of-the-box
  Emporix API key is for administration, not for shipping integrations.
- To discover what exists, list the tenant's scopes (predefined + custom):
  `GET /iam/{tenant}/scopes` with a token carrying an IAM read scope.

## Diagnosing 401 vs 403

| Symptom | Meaning | Check, in order |
|---|---|---|
| `{"fault":{"faultstring":"Invalid ApiKey",...}}` from `POST /oauth/token` | The gateway rejected the `client_id` itself — wrong, revoked, or for a different environment | Re-copy the Client ID from Developer Portal → Manage API Keys; this failure happens before OAuth, so scope and secret are not yet the problem. |
| `401 Unauthorized` | The token itself was rejected | 1. Token expired? (`expires_in` counts from issuance; service tokens ~4 h, anonymous 1 h.) 2. Wrong token *type* for the endpoint — e.g. customer-facing `/customer/{tenant}/...` auth endpoints reject service tokens; management endpoints reject anonymous tokens. 3. Wrong tenant — compare `tenant=` in the token's `scope` string with the `{tenant}` in your URL. |
| `403 Forbidden` | Valid token, missing scope | 1. Inspect granted scopes: the `scope` field of the token response (service tokens) or `GET /customer/{tenant}/validateauthtoken` (customer tokens). 2. Compare against the scopes in the endpoint's API reference. 3. If you requested the scope but it is absent from the granted set → the **API key** doesn't carry it. |

When the API key itself lacks the scope: a custom API key's scope set is
fixed at creation — scopes cannot be added to an existing key. Create a
new custom API key in Developer Portal → Manage API Keys with the full
scope set the integration needs, switch the integration to the new
credentials, and retire the old key. **Some scopes cannot be attached to
API keys at all** (historically e.g. `extension.extension_read` /
`extension.extension_manage`); if a scope is not offered when creating a
key, that is a platform-side grant — contact Emporix Support rather than
debugging your request further.

Beware: requesting a scope the API key does not carry does **not** fail the
token call — the call returns `200` and the unavailable scope is silently
absent from the granted set. Always read back the `scope` field and confirm
every scope you need is actually there before debugging anything else.

## Verify

Prove the auth setup end to end with one read scope and one management scope
the token does *not* carry. The pair below uses the Currency Service because
its scope split is clean; any equivalent pair from the target service works.

1. **Token grant matches request.** Request a service token with
   `scope=currency.currency_read`. Assert the response `scope` field contains
   `currency.currency_read` and `tenant={yourtenant}`, and nothing you did
   not request (except the tenant marker).
2. **In-scope call succeeds.** `GET /currency/{tenant}/exchanges` (requires
   `currency.currency_read`) with the token → expect `2xx`.
3. **Out-of-scope call is rejected with 403, not 401.**
   `POST /currency/{tenant}/currencies` (requires `currency.currency_manage`)
   with the same token → expect `403 Forbidden` and no resource created
   (confirm with `GET /currency/{tenant}/currencies` — readable with the
   same token — and check the new code is absent).
   A `401` here means the token or tenant is wrong — different failure, go
   back to the diagnosis table.

For customer flows, verify with
`GET /customer/{tenant}/validateauthtoken`: `200` with the expected `scope`,
`sessionId`, and (for B2B) `legalEntityId` proves the token; `401` means
expired or invalid.
