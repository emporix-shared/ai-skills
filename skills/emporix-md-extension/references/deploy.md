# Deploying to Emporix hosting

Emporix can host Management Dashboard extensions for you (Administration →
Hosting). **Hosting is a separately enabled, separately billed feature**: it is
switched on per tenant by Emporix, and a tenant without it answers the Hosting
API with `401`, `403`, or `404`. The scripts therefore check access first and
never write anything when the check fails. A successful deployment
auto-registers the module under **Extensions** or **Perspectives**, so no
manual "Add extension" step is needed afterwards. Limits stated by the Hosting
user guide: up to 20 hosted extensions per tenant; the hosting project is
initialised once per tenant.

Contents: [Is Hosting available?](#is-hosting-available-always-first) ·
[Manual route](#manual-route-no-hosting) ·
[Extension vs perspective](#extension-vs-perspective) ·
[Tenant profiles](#tenant-profiles-emporixtenantsjson) · [Flow](#flow) ·
[HTTP calls](#http-calls-behind-the-scripts) ·
[What the cloud build does](#what-the-cloud-build-does-with-the-zip) ·
[Troubleshooting](#troubleshooting)

## Is Hosting available? (always first)

```bash
node $S/tenants.mjs check <alias>     # mints a token, then GET /automation/{tenant}/projects/hostings (read-only)
```

| Result | Exit | Meaning | Next |
|---|---|---|---|
| `Hosting available` | 0 | The API client can read hosting sites | Continue below |
| `Hosting is not available for tenant …` | 4 | `401`/`403`/`404`: the feature is not enabled, or the API client lacks the hosting scopes | Tell the user: ask Emporix (support or the account team) to enable Hosting, or use the manual route |
| `Could not reach …` / other HTTP status | 1 | Network or platform problem | Retry later; nothing was written |

`hosting-create.mjs` and `deploy.mjs` run the same check themselves before
their first write and exit `4` with the manual route when it fails.

## Manual route (no Hosting)

The extension is a static Vite build; any HTTPS host works.

1. `npm run build` (prod mode; `.env.prod` must point at `https://api.emporix.io`).
2. Upload `dist/` to a static host that serves it over HTTPS with CORS allowing
   `https://admin.emporix.io` (or `*`).
3. In the Management Dashboard: Administration → Extensions → Add extension,
   module URL `https://<your-host>/assets/remoteEntry.js`. For a perspective:
   Administration → Perspectives, URL path `/…`, module URL as above, module
   name `extension`.

## Extension vs perspective

| | Extension (module) | Perspective |
|---|---|---|
| Where it appears | Administration/Extensions menu entry inside the normal dashboard | Separate dashboard view selected from the perspective chooser, at its own URL path |
| Good for | Feature screens next to existing MD modules (lists, detail pages, tools) | Role-specific workspaces (e.g. warehouse, sales desk) that replace the standard navigation |
| Registration fields | `names.{lang}` | `names.{lang}`, `urlPath` (must start with `/`), `allowedGroups` (employee group ids or `null` = everyone) |

Ask the user which one; default to **extension** when the brief describes a
feature rather than a whole workspace.

## Tenant profiles (`~/.emporix/tenants.json`)

One file, many tenants. Keys under `profiles` are aliases used in conversation
and `--tenant`.

```json
{
  "default": "acme",
  "profiles": {
    "acme":   { "tenant": "acme",   "apiUrl": "https://api.emporix.io", "clientId": "…", "clientSecret": "…", "scopes": "", "description": "Acme production" },
    "globex": { "tenant": "globex", "token": "eyJ…", "description": "no API client yet; MD token expires in ~1h" }
  }
}
```

- `tenant` required; `apiUrl` defaults to `https://api.emporix.io`.
- Auth: `clientId` + `clientSecret` (preferred; a service token is minted per
  run via `POST /oauth/token`; `scopes` optional — empty means all scopes of
  the API client) **or** a static `token` (an MD employee token from the
  browser dev tools; short-lived). When both are present, the client
  credentials win.
- Optional `language` sets the default UI language for local runs. Unknown
  fields are ignored, so the same file can be shared with other Emporix tools.
- Not supported here (other Emporix tools accept them): a macOS Keychain
  reference (`"keychain:<service>"`) as `clientId`, `clientSecret`, or `token`,
  and `"auth": "employee-token"` profiles. The scripts stop with exit `2`
  before sending anything; store the value itself in the file, or use an API
  client.
- Alias choice: `--tenant`, else the alias recorded in
  `.ai/md-extension/hosting.json`, else `default`, else the only profile.
  Several profiles and no default → exit `2` listing the aliases.
- `tenants.mjs init` creates the template (owner-only permissions) and opens
  it in the editor; `open` re-opens; `list` prints a table without secrets;
  `path` prints the location.
- CI: when no alias is passed, `EMPORIX_TENANT` + `EMPORIX_TOKEN` (or
  `EMPORIX_CLIENT_ID` / `EMPORIX_CLIENT_SECRET`) in the environment are used
  instead of the file. `EMPORIX_TENANTS_FILE` relocates the file.
- Never print or commit tokens or secrets; never ask the user to paste them in chat.

## Flow

```bash
S=<skill-dir>/scripts
node $S/tenants.mjs list                       # pick an alias (init if the file is missing)
node $S/tenants.mjs check acme                 # Hosting preflight — exit 4 means: manual route

# 1. once per extension — creates hosting + registration, writes .ai/md-extension/hosting.json
node $S/hosting-create.mjs --tenant acme --id my-ext --type extension   --name "My Extension" --name-de "Meine Erweiterung" --project .
node $S/hosting-create.mjs --tenant acme --id my-ws  --type perspective --name "My Workspace" --url-path /my-workspace --allowed-groups g1,g2 --project .

# 2. every release (profile + site id come from hosting.json)
node $S/package.mjs .                          # stdout: the zip path (.ai/md-extension/dist/<name>-<ts>.zip)
node $S/deploy.mjs --zip <that path> --project . --wait
node $S/deploy-status.mjs --project . --wait   # re-attach to the last build (uses the profile that started it)
```

Re-running is safe:

- `hosting-create.mjs` with an existing `hosting.json` for the same tenant and
  id prints it and exits `0`; if the site already exists on the tenant (for
  example after an interrupted run) it is recorded, not created twice.
- `deploy.mjs` is a release: every run starts a new build. When an earlier run
  stopped after uploading the same zip, the upload is reused.

Existing hosting created elsewhere: pass `--tenant <alias> --hosting <siteId>`
to `deploy.mjs`, where `siteId` is `<tenant>-<hostingId>` (visible in
Administration → Hosting).

Exit codes of every script: `0` ok · `1` failed · `2` usage (wrong or missing
argument, ambiguous profile) · `3` build started or still running, not yet
finished (`deploy.mjs` or `deploy-status.mjs` without `--wait`, or a
`--wait` that timed out) · `4` Hosting not available (nothing was written).

## HTTP calls behind the scripts

The Hosting endpoints below are **not part of the public API reference**; they
are the calls behind the Management Dashboard's Hosting screens. Treat their
response shapes as subject to change; the scripts parse
them leniently and fall back to `deploy-status.mjs` and Administration →
Hosting when a field is missing.

| Step | Request | Response |
|---|---|---|
| Preflight / list | `GET /automation/{tenant}/projects/hostings` | `200` list of sites; `401`/`403`/`404` when Hosting is unavailable |
| Create hosting | `POST /automation/{tenant}/projects/hostings` `{"name":"<id>","extensionRegistration":{"type":"extension","names":{"en":"..."}}}` or `{"type":"perspective","names":{...},"urlPath":"/x","allowedGroups":null}` | `{"name":"projects/<project>/sites/<tenant>-<id>","defaultUrl":"https://<tenant>-<id>.web.app"}` |
| Upload source | `POST /media/{tenant}/assets` multipart: `file` (zip) + `body` `{"type":"BLOB","access":"PRIVATE","details":{"filename":"x.zip","mimeType":"application/zip"}}` | `{"id":"<mediaId>"}` |
| Deploy | `POST /automation/{tenant}/projects/hostings/{siteId}/deploy/media` `{"mediaId":"<mediaId>"}` | `{"buildId":"<uuid>"}` |
| Status | `GET /automation/{tenant}/projects/deployments/{buildId}/logs` | `{"buildInfo":{"status":"QUEUED|WORKING|SUCCESS|FAILURE",...},"logs":"..."}` |

Constraints: hosting id lowercase kebab, ≤ 41 chars; `<tenant>-<id>` ≤ 63 chars.

## What the cloud build does with the zip

Unzips at the archive root (so `package.json` must be top-level), `npm install`,
`npm run build` (= `ensure-cors-origin.mjs --mode prod && tsc -b && vite build
--mode prod`), then publishes `dist/`. Final URL: `https://<tenant>-<id>.web.app`;
module URL `https://<tenant>-<id>.web.app/assets/remoteEntry.js`.

Therefore before packaging:

- `npm run build` passes locally with Node 22.
- `.env.prod` has `VITE_API_URL=https://api.emporix.io` and
  `VITE_DASHBOARD_ORIGIN=https://admin.emporix.io`; `vite.config.ts` whitelists
  that origin (the CORS check cannot prompt in the cloud build).
- `package-lock.json` is committed and in sync; every git dependency must be
  publicly readable (the template's `frontend-ai-rules` is).
- No `postinstall` that needs secrets or a TTY.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Exit `4` from `tenants.mjs check`, `hosting-create.mjs` or `deploy.mjs` | Hosting not enabled for the tenant, or the API client lacks hosting scopes. Ask Emporix to enable Hosting, or use the manual route. |
| Exit `4` with HTTP `401` on a profile that uses a static `token` | The token has probably expired (MD employee tokens last about an hour). Replace it in `tenants.json` and re-run before asking Emporix about Hosting. |
| "Several profiles and no default" (exit `2`) | Pass `--tenant <alias>` or set `default` in `tenants.json`. |
| Build fails in the install/build step with a CORS message | `VITE_DASHBOARD_ORIGIN` not whitelisted in `vite.config.ts`. |
| Build fails on `npm install` | Lockfile mismatch or a private git dependency. Run `npm install` locally and commit `package-lock.json`. |
| Module loads but MD shows a blank area / "failed to mount" | `RemoteComponent` must be exported both named and default; federation `name` must stay `extension`; shared deps must match the host. |
| Perspective not visible | User is not in `allowedGroups`, or `urlPath` conflicts with an existing route. |
| Status endpoint `404` for the build id | Read the Deployment ID from Administration → Hosting → hosting card → Build History and pass it with `--build`. |

Rollback: Administration → Hosting → hosting card → Releases → Rollback.
