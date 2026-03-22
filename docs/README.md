# docs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


This directory is the cross-package documentation home for Konekti.

Use it for framework-level truth that spans multiple packages. Package-local APIs, examples, and caveats belong in `../packages/*/README.md` and `../packages/*/README.ko.md`.

## Read Order

1. `getting-started/quick-start.md`
2. `getting-started/bootstrap-paths.md`
3. `getting-started/generator-workflow.md`
4. `getting-started/migrate-from-nestjs.md`
5. `concepts/architecture-overview.md`
6. `concepts/http-runtime.md`
7. `concepts/di-and-modules.md`
8. `concepts/decorators-and-metadata.md`
9. `concepts/config-and-environments.md`
10. `concepts/lifecycle-and-shutdown.md`
11. `concepts/auth-and-jwt.md`
12. `concepts/openapi.md`
13. `concepts/observability.md`
14. `concepts/security-middleware.md`
15. `concepts/transactions.md`
16. `concepts/error-responses.md`
17. `reference/package-surface.md`
18. `reference/support-matrix.md`
19. `reference/glossary-and-mental-model.md`
20. `reference/toolchain-contract-matrix.md`
21. `reference/naming-and-file-conventions.md`
22. `operations/testing-guide.md`
23. `operations/release-governance.md`
24. `operations/deployment.md`
25. `operations/third-party-extension-contract.md`
26. `operations/nestjs-parity-gaps.md`

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

## Authority Rules

- if a doc describes shipped behavior, it belongs here or in a package README
- if a doc describes future work, it belongs in a GitHub Issue
- if a topic is owned by one package, prefer the package README over duplicating it here
