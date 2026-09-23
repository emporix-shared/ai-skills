# Emporix AI Skills

Agentic **skills** for building on the [Emporix](https://emporix.com) commerce platform. Each skill is a single `SKILL.md` file that gives an AI coding agent working knowledge of one Emporix domain — how authentication, product data, extensibility, the storefront, and tenant configuration actually work. Every skill is grounded in the Emporix documentation and ends with executable API checks that prove it worked.

`skills/*/SKILL.md` is the only authored source of truth. The bundled scripts generate per-tool adapters from it and can wire up the Emporix MCP servers for live documentation and runtime grounding.

## Skills

<!-- catalog:start -->
| Skill | What it teaches | Validated |
| --- | --- | --- |
| [emporix-auth](skills/emporix-auth/SKILL.md) | Authenticate against the Emporix Commerce Engine API. | ✅ `2026-07-11` |
| [emporix-docs-navigation](skills/emporix-docs-navigation/SKILL.md) | Find, read, and verify answers in the Emporix documentation from primary sources. | ✅ `2026-07-10` |
| [emporix-extensibility](skills/emporix-extensibility/SKILL.md) | Extend the Emporix data model with the Schema Service — add custom fields (mixins) to core entities like Product, Order, Customer, or Cart … | ✅ `2026-07-11` |
| [emporix-product-data](skills/emporix-product-data/SKILL.md) | Onboard and sync product data into Emporix across the Product, Category, Catalog, Availability, Price, and Media services. | ✅ `2026-07-11` |
| [emporix-sequential-id](skills/community/emporix-sequential-id/SKILL.md) | Manage sequence schemas in the Emporix Sequential ID Service and generate sequential document numbers. | ✅ `2026-07-11` |
| [emporix-storefront](skills/emporix-storefront/SKILL.md) | Develop, run, and deploy the Emporix Journey Aware Storefront (the productized B2B Commerce Frontend / emporix-showcase) — a Next.js 16 + … | ✅ `2026-07-11` |
| [emporix-terraform](skills/emporix-terraform/SKILL.md) | Manage Emporix tenant configuration as code with the official `emporix/emporix` Terraform provider — sites, currencies, countries, tax … | ✅ `2026-07-20` |
<!-- catalog:end -->

The table above is generated from `skills/*/SKILL.md` frontmatter by [scripts/generate-catalog.mjs](scripts/generate-catalog.mjs) — never edit it by hand. The `Validated` badge shows the date each skill last passed a clean-context validation run.

## MCP servers

Emporix exposes two Model Context Protocol servers, both pre-wired in this repo so a compatible agent can ground itself in Emporix docs and (optionally) act against a live tenant:

- **Emporix docs MCP** (`https://developer.emporix.io/~gitbook/mcp`) — read-only documentation search and page retrieval, **no auth**. This is the grounding source the `emporix-docs-navigation` skill relies on.
- **Emporix hosted platform MCP** (`https://api.emporix.io/mcp/{domain}/{tenant}/{token}/mcp`) — runtime commerce tools against a real tenant, **tenant + MCP token required** (supply your own; scope-gated).

The configs are committed as [`.mcp.json`](.mcp.json) (Claude Code) and [`mcp.json`](mcp.json) (Cursor). The platform entry uses `EMPORIX_MCP_DOMAIN` / `EMPORIX_TENANT` / `EMPORIX_MCP_TOKEN` placeholders and stays inert until you set them. Full walkthrough: [docs/setup/mcp.md](docs/setup/mcp.md).

## Scripts

Zero-dependency Node scripts (Node 22+; no install step). Each takes an optional `--check` flag that exits non-zero on drift, for CI parity.

| Script | What it does |
| --- | --- |
| [scripts/generate-adapters.mjs](scripts/generate-adapters.mjs) | Generate per-tool adapters from every `SKILL.md` — Cursor (`.cursor/rules/`), Copilot (`.github/instructions/`), Windsurf (`.windsurf/rules/`), and the `AGENTS.md` / `.junie/guidelines.md` indexes. |
| [scripts/generate-catalog.mjs](scripts/generate-catalog.mjs) | Rewrite the **Skills** table above from skill frontmatter (name, description, `metadata.validated` badge). |
| [scripts/check-sources.mjs](scripts/check-sources.mjs) | Validate that each skill's `metadata.sources` drift-index entries are well-formed `api-references` spec paths. |
| [scripts/stamp-validated.mjs](scripts/stamp-validated.mjs) | Record a `metadata.validated` stamp on a skill after a clean-context validation run (evidence required). |

```bash
node scripts/generate-adapters.mjs          # regenerate adapters
node scripts/generate-catalog.mjs           # regenerate the README catalog table
node scripts/check-sources.mjs              # validate drift-index source paths
```

Adapter files are generated — never edit them by hand.

## Questions, requests, and contributions

For questions, requests, and to share skills of your own, join the [Emporix AI community channel](https://community.emporix.io/c/ai/14).

## License

Skill content (the prose of `skills/**/SKILL.md` and the adapters generated from it) is licensed under [CC-BY-4.0](LICENSE-CONTENT). Code (the scripts and config files) is licensed under [MIT](LICENSE).