---
"@fluojs/cli": patch
"@fluojs/runtime": patch
"@fluojs/testing": patch
"@fluojs/terminus": patch
---

Migrate first-party consumers to the consolidated Core and DI declarations.
Generated application and mixed starters retain their global module visibility
through `Module({ global: true })`; microservice starters retain local module
visibility. Runtime and testing use the shared wrapper type names and scope
literals, and Terminus uses `Optional.create` for its existing optional dependencies.
Commands, starter modes, provider resolution, and resource ownership are unchanged.

Upgrade these consumers together with the Core and DI updates.
Migration details are in `docs/getting-started/migrate-core-di-declarations.md`
and its Korean companion.
