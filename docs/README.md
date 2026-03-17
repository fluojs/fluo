# docs

This directory is the cross-package documentation home for Konekti.

Use it for framework-level truth that spans multiple packages. Package-local APIs, examples, and caveats belong in `packages/*/README.md` and `README.ko.md`.

## Read Order

1. `getting-started/quick-start.md`
2. `getting-started/bootstrap-paths.md`
3. `getting-started/generator-workflow.md`
4. `concepts/architecture-overview.md`
5. `concepts/http-runtime.md`
6. `concepts/auth-and-jwt.md`
7. `reference/package-surface.md`
8. `reference/toolchain-contract-matrix.md`
9. `operations/testing-guide.md`
10. `operations/release-governance.md`

## Sections

### getting-started/

- bootstrap path and starter shape
- CLI generator workflow
- quick start for new apps

### concepts/

- runtime flow and package boundaries
- auth ownership
- HTTP behavior and cross-package contracts

### operations/

- testing policy
- release governance
- benchmark/decision notes that still affect current behavior

### reference/

- package surface
- naming conventions
- toolchain contract
- reusable example slices

## Authority Rules

- if a doc describes shipped behavior, it belongs here or in a package README
- if a doc describes future work, it belongs in a GitHub Issue
- if a topic is owned by one package, prefer the package README over duplicating it here
