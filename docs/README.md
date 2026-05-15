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

## Contributing to documentation

Start with the root [`CONTRIBUTING.md`](../CONTRIBUTING.md) for local setup, verification commands, and the PR process. Documentation changes should also follow these repository-specific checks:

- Keep English and Korean counterparts synchronized for changed docs pages.
- Run `pnpm docs:sync-check` when changing localized documentation pairs.
- Run `pnpm verify:docs` when changing the website source in `apps/docs` or docs content consumed by the website.
- If a document describes package behavior, verify the affected package README and [`contracts/behavioral-contract-policy.md`](./contracts/behavioral-contract-policy.md) still agree.
- If a public-package behavior or API change requires release notes, record release intent with a `.changeset/*.md` file instead of editing generated changelog artifacts by hand.
- A pre-existing issue is helpful but not mandatory for focused documentation PRs. If there is no issue, use the PR summary to explain the problem, source context, and intended outcome.
