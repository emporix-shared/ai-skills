# Implementation plan template

Write to `<project>/.ai/md-extension/plan.md`. Keep it short enough to read in
one screen; it is a working document, not a spec. Update the checklist as work
lands.

```markdown
# <Display name> — implementation plan

**Mode:** new | existing   **Registration:** extension | perspective (`/path`) | undecided
**Project:** `<dir>`   **Package:** `<kebab-name>`   **Federation name:** `extension`

## Goal
One paragraph in the user's words: who uses it in the Management Dashboard and what they get done.

## Assumptions
- Decisions made without asking (data source, defaults, scope cuts). The user can override any of them.

## Emporix APIs
| Feature | Service / endpoint | `@emporix/api-calls` export or local `src/api/*.api.ts` | Notes (pagination, scopes, localized fields) |
|---|---|---|---|

## Data owned by the extension
None | Custom Instances type `<type>` with schema `<fields>` (created on first run / documented in README)

## Screens and routes (HashRouter)
| Route | Page | Components (`@emporix/component-library`) | States (loading / empty / error) |
|---|---|---|---|

## Files
- `src/models/<X>.model.ts` — types
- `src/api/<x>.api.ts` — only for endpoints not in `@emporix/api-calls`
- `src/pages/<X>List.tsx`, `src/pages/<X>Detail.tsx` (+ `.module.scss`)
- `src/components/<...>` — feature composites only
- `src/translations/{en,de}/index.ts` — keys
- tests: `src/**/*.test.ts(x)` for helpers, mappers, API adapters

## AppState fields used
tenant, language, token [, contentLanguage, currency, user, onError, emporixApiUrl]

## Steps
- [ ] 1. Models + API layer (verified against docs MCP)
- [ ] 2. Pages and routing
- [ ] 3. i18n (en + de)
- [ ] 4. Tests
- [ ] 5. `npm run lint && npm run typecheck && npm run test:run && npm run build`
- [ ] 6. Standalone smoke test (`npm run dev`) / preview in MD
- [ ] 7. Deploy (hosting → package → deploy → status)

## Open questions
Only items that block implementation and that the code or docs cannot answer.
```
