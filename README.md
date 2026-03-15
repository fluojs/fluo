# konekti

Implementation repository for the `konekti` framework.

Planning and contract documents are maintained separately in the private `konekti-plan` repository.

## Current status

- private bootstrap monorepo
- workspace/package surface initialized
- Phase 1 foundation baseline is in place
- Phase 2 runtime baseline (`2A`-`2E`) is implemented and verified in this repo
- Phase 3 runtime baseline (`3A`-`3D`) is implemented and verified in this repo
- Phase 4 testing/operations baseline (`4A`-`4D`) is implemented and verified in this repo
- Phase 5 release-readiness baseline (`5A`-`5E`) is implemented and verified in this repo
- Phase 8 public release and auth gaps are implemented in this repo (`@konekti/openapi`, `@konekti/metrics`, readiness semantics, starter contract)
- release-candidate verification now runs through `tooling/release/verify-release-candidate.mjs` and publishes a checklist summary
- reusable Phase 3 reference slice docs live in `./docs/phase-3-reference-slice.md`
- verification checklists live in `../konekti-plan/execution/`

## Docs

- `./docs/quick-start.md`
- `./docs/architecture-overview.md`
- `./docs/testing-guide.md`
- `./docs/preset-guide.md`
- `./docs/toolchain-contract-matrix.md`
- `./docs/http-policies.md`
- `./docs/release-governance.md`
- `./docs/manifest-decision.md`
