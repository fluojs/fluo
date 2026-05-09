# fluo Docs Hub

This directory contains governed repository documentation for fluo. The official website source now lives in `apps/docs` and uses Fumadocs to publish a bilingual English/Korean documentation surface.

## Official website source

- App: `apps/docs`
- Content: `apps/docs/content/docs`
- English/Korean parity check: `pnpm docs:sync-check`
- Full docs verification: `pnpm verify:docs`

## Canonical repository docs

- AI context: [`CONTEXT.md`](./CONTEXT.md)
- Package surface: [`reference/package-surface.md`](./reference/package-surface.md)
- Package chooser: [`reference/package-chooser.md`](./reference/package-chooser.md)
- Behavioral contracts: [`contracts/behavioral-contract-policy.md`](./contracts/behavioral-contract-policy.md)
- Testing guide: [`contracts/testing-guide.md`](./contracts/testing-guide.md)

The website should link to these canonical files when a page summarizes governed package or runtime facts instead of duplicating the source of truth.
