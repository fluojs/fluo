---
name: fluo-contract-governance
description: Fluo behavioral contract precedence and change-impact knowledge.
compatibility: omo
---

# Fluo contract governance

Treat `docs/contracts/` and package READMEs as binding behavior before changing
code. Prefer standards-first, explicit, runtime-consistent behavior.

Apply `docs/contracts/documentation-authority.md`: Docs is the normative framework
contract layer for AI, and package READMEs remain its delegated package API owners.
Keep installation, exact public imports, essential usage, defaults, and guarantee
summaries in those READMEs and link shared contracts without duplicating API bodies
into `docs/`. Books derives human product narrative from the same contracts; app
policies do not become framework guarantees. Route AI from CONTEXT through the
Docs ownership table/package chooser to the owner and its execution evidence.

For each distinct contract, identify one EN/KO owner pair and expose scope,
prerequisites, public imports, inputs, defaults, outputs, order, failures, resource
ownership, limitations, examples/alternatives, and evidence in concise Markdown.
Compare existing contracts, implementation, and tests when sources conflict.
Determine whether a discrepancy is a documentation error or an implementation
regression; never silently reduce a promise to match implementation. Separate
public behavior changes from documentation reorganization for approval.

For every change, check public API, tests, README/docs/book companions, and
Changesets impact. Preserve intentional limitations unless the contract and
migration guidance change together.

Establish Docs contracts, verify evidence, apply them to the Korean Book, align
English, then hand off. Initial authoring reviews the entire Korean edition;
corrections freeze the whole affected Korean set, including dependent chapters,
before translation. Every mergeable increment includes both locales and passes
existing bilingual checks, without untranslated drafts or parity exemptions.
Record owner and Book impact, actual commands/results, exact checkout/head, and
unverified scope. Preserve stable headings/anchors, links, sentinels, and checker
dependencies until their migration is verified with equivalent or stronger
assertions and negative regressions. Do not claim complete migration from policy
changes alone or add tests that pin prose or prompts.

Primary references:

- `docs/contracts/documentation-authority.md`
- `docs/contracts/behavioral-contract-policy.md`
- `docs/contracts/testing-guide.md`
- `docs/contracts/public-export-tsdoc-baseline.md`
- `docs/contracts/platform-conformance-authoring-checklist.md`
