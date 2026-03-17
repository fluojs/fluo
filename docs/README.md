# docs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


This directory is the cross-package documentation home for Konekti.

Use it for framework-level truth that spans multiple packages. Package-local APIs, examples, and caveats belong in `packages/*/README.md` and `README.ko.md`.

## Read Order

1. `getting-started/quick-start.md`
2. `getting-started/bootstrap-paths.md`
3. `getting-started/generator-workflow.md`
4. `concepts/architecture-overview.md`
5. `concepts/http-runtime.md`
6. `concepts/di-and-modules.md`
7. `concepts/decorators-and-metadata.md`
8. `concepts/config-and-environments.md`
9. `concepts/lifecycle-and-shutdown.md`
10. `concepts/auth-and-jwt.md`
11. `concepts/openapi.md`
12. `concepts/observability.md`
13. `concepts/security-middleware.md`
14. `concepts/transactions.md`
15. `concepts/error-responses.md`
16. `reference/package-surface.md`
17. `reference/support-matrix.md`
18. `reference/glossary-and-mental-model.md`
19. `reference/toolchain-contract-matrix.md`
20. `reference/workspace-topology.md`
21. `operations/testing-guide.md`
22. `operations/release-governance.md`

## Sections

### getting-started/

- bootstrap path and starter shape
- CLI generator workflow
- quick start for new apps

### concepts/

- runtime flow and package boundaries
- DI and module visibility rules
- decorator and metadata ownership
- config and environment contract
- lifecycle and shutdown model
- auth ownership
- HTTP behavior and cross-package contracts
- OpenAPI generation model
- observability and health/readiness semantics
- security middleware defaults and boundaries
- transaction semantics across integrations
- canonical error response and exposure rules

### operations/

- testing policy
- release governance
- benchmark/decision notes that still affect current behavior

### reference/

- package surface
- support matrix
- glossary and mental model
- naming conventions
- toolchain contract
- workspace topology
- reusable example slices

## Authority Rules

- if a doc describes shipped behavior, it belongs here or in a package README
- if a doc describes future work, it belongs in a GitHub Issue
- if a topic is owned by one package, prefer the package README over duplicating it here
