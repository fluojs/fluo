---
name: fluo-contract-governance
description: Fluo behavioral contract precedence and change-impact knowledge.
compatibility: omo
---

# Fluo contract governance

Treat `docs/contracts/` and package READMEs as binding behavior before changing
code. Prefer standards-first, explicit, runtime-consistent behavior.

For every change, check public API, tests, README/docs/book companions, and
Changesets impact. Preserve intentional limitations unless the contract and
migration guidance change together.

Primary references:

- `docs/contracts/behavioral-contract-policy.md`
- `docs/contracts/testing-guide.md`
- `docs/contracts/public-export-tsdoc-baseline.md`
- `docs/contracts/platform-conformance-authoring-checklist.md`
