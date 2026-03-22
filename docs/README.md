# docs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

This is the cross-package documentation hub for Konekti.

Use this folder for framework-level truth that spans multiple packages. For package-local APIs and examples, use `../packages/*/README.md`.

## Choose Your Path

### I want to run Konekti quickly

- `getting-started/quick-start.md`
- `getting-started/bootstrap-paths.md`
- `getting-started/generator-workflow.md`

### I am migrating from NestJS

- `getting-started/migrate-from-nestjs.md`
- `operations/nestjs-parity-gaps.md`

### I want to understand architecture and runtime flow

- `concepts/architecture-overview.md`
- `concepts/http-runtime.md`
- `concepts/di-and-modules.md`
- `concepts/lifecycle-and-shutdown.md`

### I need auth, validation, and API docs behavior

- `concepts/auth-and-jwt.md`
- `concepts/decorators-and-metadata.md`
- `concepts/error-responses.md`
- `concepts/openapi.md`

### I need operations and release guidance

- `operations/testing-guide.md`
- `operations/deployment.md`
- `operations/release-governance.md`
- `operations/third-party-extension-contract.md`

### I need exact contracts and naming conventions

- `reference/package-surface.md`
- `reference/support-matrix.md`
- `reference/toolchain-contract-matrix.md`
- `reference/naming-and-file-conventions.md`
- `reference/glossary-and-mental-model.md`

## Authority Rules

- if a doc describes shipped behavior, it belongs here or in a package README
- if a doc describes future work, it belongs in a GitHub Issue
- if a topic is owned by one package, prefer the package README over duplicating it here
