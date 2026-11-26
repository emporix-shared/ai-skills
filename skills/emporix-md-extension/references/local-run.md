# Running the extension locally

The template ships a standalone shell (`src/App.tsx` + `src/main.tsx`) that
mounts `RemoteComponent` outside the Management Dashboard. It needs a tenant,
a Bearer token and a UI language, kept in `localStorage` (`tenant`, `token`,
`language`); when tenant or token is empty it shows a settings dialog, and the
`</>` button re-opens it.

## Scripts

```bash
npm run dev                                   # Vite dev server, default http://localhost:5173 (HMR)
node $S/dev-open.mjs --tenant <alias> --project <dir> [--url http://localhost:5173] [--language en]
```

`dev-open.mjs`:

1. Resolves tenant / token / API URL from the profile (same source as deploy:
   `~/.emporix/tenants.json`; client credentials are minted into a fresh
   service token, a static `token` is used as is). Falls back to the profile
   recorded in `.ai/md-extension/hosting.json`.
2. Ensures the URL-settings patch is present (`dev-settings-patch.mjs`).
3. Writes `VITE_API_URL=<profile apiUrl>` to `<dir>/.env.local` (gitignored
   via `*.local`; Vite restarts the dev server by itself) so the app talks to
   the same environment the token belongs to. `--no-env` skips this.
4. Checks the dev server answers, then opens
   `<url>/?tenant=…&token=…&language=…` in the default browser (`$BROWSER`,
   `open`, or `xdg-open`). The page stores the values and removes them from
   the address bar (`history.replaceState`), so the token is not left in the
   URL or history. The script never prints the token.

Re-run `dev-open.mjs` when the user closed the tab, switched tenant, or reports
`401` responses (service tokens expire — typically within an hour).

## The URL-settings patch

`dev-settings-patch.mjs` adds `applySettingsFromUrl()` to
`src/helpers/settings.helpers.ts` and calls it at the start of
`getStoredSettings()`. It is a no-op without `window` (vitest runs in Node) and
without any of the three query parameters. Marker comment:
`emporix-md-extension: url-settings`. `scaffold.mjs` applies it automatically.

For an existing project whose helper differs from the template, add the
equivalent by hand:

```ts
const applySettingsFromUrl = (): void => {
  if (typeof window === 'undefined' || !window.location?.search) return
  const params = new URLSearchParams(window.location.search)
  const tenant = params.get('tenant')
  const token = params.get('token')
  const language = params.get('language')
  if (tenant === null && token === null && language === null) return
  saveStoredSettings({
    tenant: tenant ?? localStorage.getItem(TENANT_KEY) ?? '',
    language: language ?? localStorage.getItem(LANGUAGE_KEY) ?? 'en',
    token: token ?? localStorage.getItem(TOKEN_KEY) ?? '',
  })
  params.delete('tenant')
  params.delete('token')
  params.delete('language')
  const query = params.toString()
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  )
}
// first line of getStoredSettings():
applySettingsFromUrl()
```

## Token scope caveat

A service token carries only the API client's scopes. If a page shows `403`
while the same view works in the Management Dashboard, the API client lacks
that scope: add it in Administration → API keys, or use a profile with a
static MD employee token for local testing.

## Seeing it inside the Management Dashboard

```bash
npm run build && npm run preview       # http://localhost:4173/assets/remoteEntry.js
```

Administration → Extensions → Add extension (name, module URL above), or
Administration → Perspectives (name, URL path, module URL, module name
`extension`). `vite.config.ts` already allows `https://admin.emporix.io` as a CORS origin.

## Dev-server hygiene

- Start it as a background process that outlives the current command, and
  reuse a running instance for the same project.
- Vite binds `localhost` (IPv6 `::1` on recent Node); always use
  `http://localhost:<port>`, not `127.0.0.1`.
- Restart only after changes to `vite.config.ts`, dependencies, or `.env*`
  (the latter restarts on its own).
