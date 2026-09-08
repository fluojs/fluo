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

Follow `docs/contracts/documentation-authority.md` and the source ownership table
in `docs/README.md`. Docs is the normative framework contract layer for AI,
including delegated package API owners in package READMEs. Keep their installation,
public imports, essential usage, defaults, and guarantee summaries; link shared
contracts instead of duplicating API bodies into `docs/` or leaving only links.
AI reads CONTEXT, the ownership table/package chooser, the owning contract, then
implementation, tests, and execution evidence. Books is the primary human learning
path derived from those same contracts: the 24/28/20-chapter series declared in
`book/series.json`, from FluoBlog to FluoShop to Fluo internals. App-domain policies
and teaching counterexamples are not framework guarantees.

Use the authority policy's concise Markdown fields for scope, prerequisites,
public imports, inputs, defaults, outputs, order, failures, resource ownership,
limitations, examples/alternatives, and evidence. Resolve conflicting claims
against existing contracts, implementation, and tests before updating summaries.
Do not silently reduce guarantees to match implementation; public behavior changes
require separate approval and the corresponding contract/test/release work.

Follow Docs contract establishment -> evidence verification -> Korean Book
application -> English alignment -> handoff. Initial authoring reviews the entire
Korean edition first. Corrections review, finalize, and freeze the whole affected
Korean set, including dependent chapters, before English translation. Temporary
locale incompleteness is allowed only during authoring; every mergeable increment
contains the finalized Korean set and its English companions and passes existing
bilingual checks. Do not mix untranslated drafts into those increments.

`apps/docs/content/docs/tutorial/` and `examples/fluo-blog/` provide a short,
executable HTTP/DI companion, not complete applications for all Book chapters.
Legacy beginner/intermediate/advanced chapter URLs retain their contract evidence.
Preserve existing headings/anchors, links, machine sentinels, and checker consumers
until their owners, triggers, assertions, and negative regressions migrate together
without weaker detection. Authority guidance alone does not establish complete
package/chapter migration.

`docs:sync-check` verifies website counterpart-file existence, not semantic
translation parity. Review changed EN/KO instructions together and exercise
the affected tutorial checkpoints, including intermediate states.

Use `pnpm book:check:ko` during Korean authoring and `pnpm book:check` after
translation. These validate the manifest, identities, local links, TOC ordering,
package coverage, and translated code/heading structure, not prose quality.
Review meaning, defaults, failures, and ownership separately; do not add prose-
or prompt-pinning tests. Record exact checkout/head, affected Docs owners and Book
chapters (or why no Book edit is needed), actual commands, exit codes, observations,
and unverified scope in the verification receipt.
