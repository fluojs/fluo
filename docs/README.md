# docs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Welcome to the Konekti cross-package documentation hub.

This directory contains framework-level information that spans multiple packages. For package-specific APIs and examples, refer to `../packages/*/README.md`.

If you are starting for the first time, begin with `getting-started/quick-start.md`. That guide is the canonical install -> `konekti new` -> `cd` -> `pnpm dev` path.

## choose your path

### quick start

- `getting-started/quick-start.md` - start here for the canonical first run
- `getting-started/bootstrap-paths.md` - bootstrap reference and advanced/secondary paths
- `getting-started/generator-workflow.md` - what to generate after the app is running

### nestjs migration

- `getting-started/migrate-from-nestjs.md`
- `operations/nestjs-parity-gaps.md`

### architecture and runtime

- `concepts/architecture-overview.md`
- `concepts/dev-reload-architecture.md`
- `concepts/cqrs.md`
- `concepts/caching.md`
- `concepts/http-runtime.md`
- `concepts/di-and-modules.md`
- `concepts/lifecycle-and-shutdown.md`

### authentication and api behavior

- `concepts/auth-and-jwt.md`
- `concepts/decorators-and-metadata.md`
- `concepts/error-responses.md`
- `concepts/openapi.md`

### operations and releases

- `operations/testing-guide.md`
- `operations/deployment.md`
- `operations/release-governance.md`
- `operations/behavioral-contract-policy.md`
- `operations/third-party-extension-contract.md`

### contracts and conventions

- `reference/package-chooser.md` - pick packages by task (start here if you know what you want to build)
- `reference/package-surface.md`
- `reference/toolchain-contract-matrix.md`
- `reference/glossary-and-mental-model.md`

## authority rules

- Documentation for shipped behavior belongs here or in a package README.
- Future work belongs in GitHub Issues.
- If a topic is specific to one package, prefer the package README to avoid duplication.
