# fluo Docs Hub

This directory contains governed repository documentation for fluo. The official website source now lives in `apps/docs` and uses Fumadocs to publish a bilingual English/Korean documentation surface.

## Choose a reading path

| Your goal | Start here | What you will find |
| --- | --- | --- |
| Learn backend design through a product | [Three-volume series](../book/README.md) | Seventy-two chapters from FluoBlog to a merchandise shop to Fluo internals. |
| Check the first HTTP feature quickly | [FluoBlog exercise](../apps/docs/content/docs/tutorial/index.mdx) | An executable companion for initial routing, DI, and validation. |
| Add a feature to an existing app | [Task guides](../apps/docs/content/docs/guides/index.mdx) | Focused instructions and capability choices; not a second beginner course. |
| Understand framework implementation | [Volume 3: Inside Fluo](../book/03-internals/toc.md) | A deeper course tracing the two products through source and contracts. |
| Check an API or supported behavior | [Package chooser](./reference/package-chooser.md) | Owning package READMEs and shared behavioral contracts. |
| Run or compare working code | [Examples](../examples/README.md) | Executable applications, including the tutorial checkpoints. |

## Source ownership

| Subject | Maintained source | Other surfaces |
| --- | --- | --- |
| The complete product/pattern learning path | `book/series.json` and the three new volumes | The Book is primary; the website and root README route readers to its volumes and chapters. |
| Initial HTTP exercise instructions | `apps/docs/content/docs/tutorial/` | A companion for checking the first routing, DI, and validation path, not a replacement for the entire book. |
| Tutorial checkpoint behavior | `examples/fluo-blog/` source and tests | Lessons explain the same files and observable results in EN/KO. |
| Package API and package-specific limitations | The owning `packages/*/README.md` and its Korean companion | Guides give a selected use case and link to the full contract. |
| Cross-package runtime and architecture promises | The relevant `docs/contracts/` or `docs/architecture/` pair | Package READMEs and Book explain their application without redefining them. |
| Runtime coverage and toolchain support | `docs/reference/package-surface.md` and `toolchain-contract-matrix.md` | Summaries link to the tables rather than maintaining separate inventories. |
| AI navigation | `docs/CONTEXT.md` and its Korean companion | A route to the owning documents, not a second tutorial. |

When sources disagree, check the owning implementation, tests, and maintained contract together. Resolve the disagreement in the owning document before updating its summaries; do not silently change a behavioral promise while reorganizing prose.

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
- HTTP error representation decision: [`architecture/http-error-representations.md`](./architecture/http-error-representations.md)
- React render policy decision: [`architecture/react-render-policy-decorators.md`](./architecture/react-render-policy-decorators.md)
- React page metadata/error/not-found policy decision: [`architecture/react-page-render-policies.md`](./architecture/react-page-render-policies.md)
- React RSC graduation policy: [`contracts/react-rsc-graduation.md`](./contracts/react-rsc-graduation.md)
- Testing guide: [`contracts/testing-guide.md`](./contracts/testing-guide.md)
- Testing package contract: [`../packages/testing/README.md`](../packages/testing/README.md)
- Testing learning path: [FluoBlog request tests](../apps/docs/content/docs/tutorial/testing.mdx)
- Testing background: [`../book/beginner/ch20-testing.md`](../book/beginner/ch20-testing.md)

The website should link to these canonical files when a page summarizes governed package or runtime facts instead of duplicating the source of truth.

## Contributing to documentation

Start with the root [`CONTRIBUTING.md`](../CONTRIBUTING.md) for local setup, verification commands, and the PR process. Documentation changes should also follow these repository-specific checks:

- Keep English and Korean counterparts synchronized for changed docs pages.
- Run `pnpm docs:sync-check` for website page and navigation file pairs. This checks counterpart existence, not translation meaning.
- Run `pnpm verify:docs` when changing the website source in `apps/docs` or docs content consumed by the website.
- For tutorial changes, run the checkpoint tests and follow the changed lesson against its starting state. A passing final example alone does not prove that intermediate instructions work.
- Complete and review the entire Korean book before translating it into English. Use `pnpm book:check:ko` during Korean authoring and `pnpm book:check` for final bilingual verification.
- Review EN/KO commands, file paths, defaults, limitations, and expected responses together. The separate platform governance gate checks selected contract structures; neither structural check replaces this review.
- If a document describes package behavior, verify the affected package README and [`contracts/behavioral-contract-policy.md`](./contracts/behavioral-contract-policy.md) still agree.
- If a public-package behavior or API change requires release notes, record release intent with a `.changeset/*.md` file instead of editing generated changelog artifacts by hand.
- A pre-existing issue is helpful but not mandatory for focused documentation PRs. If there is no issue, use the PR summary to explain the problem, source context, and intended outcome.
