# md-module-template anatomy

Source: https://github.com/emporix/md-module-template (branch `master`). The
scaffold script clones it, drops `.git`, renames the package, and commits.

## Layout

| Path | Role | Touch it? |
|---|---|---|
| `vite.config.ts` | Federation plugin: `name: 'extension'`, `filename: 'remoteEntry.js'`, exposes `./RemoteComponent`; shared `react`, `react-dom`, `react-router`, `react-i18next`, `chart.js`, `quill`; CORS whitelist `corsOrigins` | Keep `name`, `filename`, expose path, `cssCodeSplit: false`, `modulePreload: false`, `target: 'esnext'`. Do not add shared deps the host does not share. |
| `src/RemoteComponent.tsx` | Federated entry. `ToastProvider` → `ExtensionProvider` → `HashRouter` → routes. Imports `@emporix/component-library/styles` and `./translations/i18n`. Syncs `i18n.changeLanguage(appState.language)`. Exported **named and default**. | Replace the routes. Keep provider order, both exports, style import. |
| `src/App.tsx`, `src/main.tsx`, `src/helpers/settings.helpers.ts` | Standalone dev shell: asks for tenant/token/language, stores them in `localStorage`, mounts `RemoteComponent`. | Leave as is. |
| `src/api/bootstrap.ts` | `createApiClient` from `@emporix/api-calls` with `VITE_API_URL`; `useApiCredentials(tenant, token)` keeps the shared axios client in sync. | Leave as is. Add `emporixApiUrl` preference only if the plan needs it. |
| `src/context/ExtensionContext.tsx` | `ExtensionProvider` / `useExtensionContext()` exposing `AppState`. | Leave as is. |
| `src/models/AppState.model.ts` | `{ tenant, language, token }` | Extend with host fields you use: `contentLanguage`, `currency`, `user`, `onError`, `emporixApiUrl`. Never add `permissions`. |
| `src/models/*.model.ts` | Domain types (`Product`, `ApiError`, `Localized`) | Replace `Product` with the plan's domain models. Keep `ApiError`. |
| `src/pages/List.tsx`, `Detail.tsx` (+ `.module.scss`) | Sample product list/detail using `DataTable` and `fetchProducts` / `fetchProductCall`. | Replace with the plan's pages. Use them as the pattern (loading/error state, `useExtensionContext`, `useTranslation`). |
| `src/helpers/localized.helpers.ts` | `getLocalizedText(value, language)` | Keep. |
| `src/translations/{en,de}/index.ts`, `i18n.ts` | Flat i18n keys. | Replace sample keys; keep `en` and `de` in sync. |
| `.env`, `.env.example`, `.env.prod` (other `.env.*` files may exist) | `VITE_API_URL`, `VITE_DASHBOARD_ORIGIN` | Keep. Hosting builds with `--mode prod` → `.env.prod` (`https://api.emporix.io`). |
| `scripts/ensure-cors-origin.mjs` | Pre-build check that `VITE_DASHBOARD_ORIGIN` is in `corsOrigins`; interactive prompt when missing (fails in CI). | Keep `https://admin.emporix.io` whitelisted. |
| `scripts/customize-ai-rules-index.mjs`, `postinstall` | Syncs shared agent rules from the public `frontend-ai-rules` package into `.cursorrules`, `.cursor/rules`, `.claude`, `.github`. | Leave. Project rules live in `*/extension-module-template.*`. |
| `src/helpers/settings.helpers.test.ts` | Vitest sample. | Pattern for new tests (`*.test.ts(x)`, vitest). |

## AppState passed by the host

`tenant`, `language`, `token`, `currency` (`{id,label,default,required}`),
`contentLanguage`, `user` (`userId`, optional `firstName`/`lastName`/`email`),
`onError(error)` (call on failed API requests; host re-authenticates on 401),
`emporixApiUrl` (`string | null`).

## Conventions the generated rules enforce

- API calls live in `src/api/*.api.ts` or come from `@emporix/api-calls`; never `fetch` inside components.
- `useExtensionContext()` for tenant/token/language; never hardcode them.
- `HashRouter` only. Relative `navigate(id)` inside the module.
- Styles: SCSS modules per page/component; library styles imported once in `RemoteComponent.tsx` (and `App.tsx` for standalone).
- Quality gate: `npm run lint && npm run typecheck && npm run test:run && npm run build`.
- `npm run build` builds in prod mode against `https://api.emporix.io` (`.env.prod`); use it for anything you deploy.

## Running it

Standalone (`npm run dev` + `node $S/dev-open.mjs`) and preview inside the
Management Dashboard (`npm run build && npm run preview`): see
`references/local-run.md`. The scaffold adds a small URL-settings helper to
`src/helpers/settings.helpers.ts` (marker `emporix-md-extension: url-settings`)
so `dev-open.mjs` can pre-fill tenant/token/language.
