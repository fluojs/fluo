---
name: fluo-docs-governance
description: Fluo EN/KO documentation parity and evidence knowledge.
compatibility: omo
---

# Fluo docs governance

Maintain parity across root READMEs, `apps/docs/content/docs/`, `docs/`, `book/`,
example READMEs, and package READMEs.
Update English and Korean companions together, preserve canonical links, and
align tooling claims with `docs/reference/toolchain-contract-matrix.md`.

Documentation fixes that change behavioral claims require source/contract
evidence and passing docs CI. Keep raw commands, identifiers, paths, URLs, and
logs untranslated.

Follow the source ownership table in `docs/README.md`. The primary learning path
is the 24/28/20-chapter Book series declared in `book/series.json`: FluoBlog,
the same product growing into FluoShop, and Fluo internals. Write and review the
entire Korean edition before translating it into English. The explicit Korean-first
authoring sequence permits temporary locale incompleteness; final EN/KO parity is required.

`apps/docs/content/docs/tutorial/` and `examples/fluo-blog/` provide a short,
executable HTTP/DI companion, not complete applications for all Book chapters.
Legacy beginner/intermediate/advanced chapter URLs retain their contract evidence.

`docs:sync-check` verifies website counterpart-file existence, not semantic
translation parity. Review changed EN/KO instructions together and exercise
the affected tutorial checkpoints, including intermediate states.

Use `pnpm book:check:ko` during Korean authoring and `pnpm book:check` after
translation. These validate the manifest, identities, local links, TOC ordering,
package coverage, and translated code/heading structure, not prose quality.
