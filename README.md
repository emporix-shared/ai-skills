# Emporix AI Skills

Ready-to-use agentic **skills** for building on the [Emporix](https://emporix.com) commerce platform. Each skill is a single `SKILL.md` file that gives an AI coding agent working knowledge of one Emporix domain — how authentication, product data, extensibility, the storefront, and tenant configuration actually work. Every skill is grounded in the Emporix documentation and ends with executable API checks that prove it worked.

These are the plain skill files, nothing else. Drop them into whatever your agent reads, or point your agent at this repository.

## Skills

| Skill | What it teaches |
| --- | --- |
| [emporix-auth](skills/emporix-auth/SKILL.md) | Authenticate against the Emporix Commerce Engine API — token types, scopes, and diagnosing 401/403 responses. |
| [emporix-docs-navigation](skills/emporix-docs-navigation/SKILL.md) | Find, read, and verify answers in the Emporix documentation from primary sources. |
| [emporix-extensibility](skills/emporix-extensibility/SKILL.md) | Extend the Emporix data model with the Schema Service — mixins, custom entities, and the q-param filter language. |
| [emporix-product-data](skills/emporix-product-data/SKILL.md) | Onboard and sync product data across the Product, Category, Catalog, Availability, Price, and Media services. |
| [emporix-storefront](skills/emporix-storefront/SKILL.md) | Develop, run, and deploy the Emporix Journey Aware Storefront (B2B Commerce Frontend). |
| [emporix-terraform](skills/emporix-terraform/SKILL.md) | Manage Emporix tenant configuration as code with the official `emporix/emporix` Terraform provider. |
| [emporix-sequential-id](skills/community/emporix-sequential-id/SKILL.md) | Manage sequence schemas and generate sequential document numbers (order, invoice, quote numbers). Community-contributed. |

## Questions, requests, and contributions

<!-- TODO: replace with the Emporix community channel link once decided. -->
For questions, requests, and to share skills of your own, join the Emporix community channel: **_(link coming soon)_**.

## License

Skill content is licensed under [CC-BY-4.0](LICENSE).