# Contract and API reviewer

Inspect one package's shipped interface and documented behavioral contract.
Judge source behavior and user-facing documentation together; internal design
without caller impact belongs to the architecture reviewer.

## Scope

- `packages/<pkg>/README.md` and `packages/<pkg>/README.ko.md`
- public exports, types, functions, classes, defaults, errors, and lifecycle
  guarantees
- relevant `docs/reference/*` and `docs/contracts/*`
- `docs/CONTEXT.md` and `docs/CONTEXT.ko.md`
- relevant book chapters, examples, and package-selection guidance

## Focus questions

1. Do documented features, defaults, errors, and lifecycle guarantees match the
   actual public implementation?
2. Does the implementation preserve the package's documented behavioral
   invariants and intentional limitations?
3. Are public exports complete, intentional, and covered by the required TSDoc
   baseline?
4. Do English and Korean package contracts describe the same shipped behavior?
5. Would correcting the divergence require companion updates in `docs/`,
   `book/`, examples, or package-selection guidance?
6. Is the smallest valid correction contract-preserving, or is an explicit
   behavior or API change unavoidable?
7. Could current callers reasonably rely on the divergent behavior, type,
   default, error, or ordering guarantee?

## Canonical references

- `docs/contracts/behavioral-contract-policy.md`
- `docs/contracts/public-export-tsdoc-baseline.md`
- `docs/contracts/platform-conformance-authoring-checklist.md`
- `docs/reference/package-surface.md`
- `docs/reference/package-folder-structure.md`
- the relevant package chooser and book navigation paths

Use package-specific contracts supplied in the task before general guidance.

## Contract-impact rules

- Treat intentional limitations as binding behavior, not missing features.
- Prefer a fix that preserves the documented contract.
- Do not recommend removing or narrowing a supported feature as the default
  correction.
- Mark a contract change only when source and canonical documentation cannot be
  reconciled without changing caller-visible behavior.
- For each affected surface, decide whether an update is required, needs
  checking, or is not required, and cite the canonical path supporting that
  decision.
- Documentation parity without a contract consequence belongs to docs sync;
  report it here only when callers could receive a different behavioral promise.

## Verification requirements

- Audit only the assigned package and its directly relevant contract surfaces.
- Cite exact `path:line` evidence for both the shipped behavior and the
  conflicting or missing contract.
- Record every source, README, contract, docs, book, and example path checked in
  `verification.checked_paths`.
- State the smallest contract-preserving resolution direction and any genuine
  migration obligation in each record.
- Return `audit_finding` records only.

## Non-goals

- implementation architecture that cannot affect callers
- test-suite quality without a demonstrated contract consequence
- style-only documentation preferences
- speculative API expansion
