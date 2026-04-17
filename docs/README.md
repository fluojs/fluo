# fluo Documentation

<p align="center">
  <strong>Build predictable, standards-first backends at any scale.</strong>
</p>

<p align="center">
  <strong>English</strong> | <a href="./README.ko.md">한국어</a>
</p>

Welcome to the central documentation hub for fluo. Whether you're building a simple REST API or a complex microservices architecture, these guides will help you leverage the full power of modern TypeScript.

## 🏁 Get Started

If you're new to fluo, start here to go from zero to a running application in minutes.

- **[Quick Start](./getting-started/quick-start.md)**: The canonical install → `new` → `dev` path.
- **[First Feature Path](./getting-started/first-feature-path.md)**: Moving from a boilerplate to your first real domain logic.
- **[Bootstrap & Startup](./getting-started/bootstrap-paths.md)**: How fluo handles application lifecycle and initialization.
- **[CLI Workflow](./getting-started/generator-workflow.md)**: Using generators to maintain consistency.
- **[Glossary & Mental Model](./reference/glossary-and-mental-model.md)**: The core vocabulary of the framework.

## 🧠 Core Concepts

Understand the "Why" and "How" behind fluo's design choices.

### Architecture & Design

- **[Architecture Overview](./concepts/architecture-overview.md)**: Package boundaries and the flow of a request.
- **[Standard Decorators](./concepts/decorators-and-metadata.md)**: Why we ditched legacy flags for the TC39 standard.
- **[Dependency Injection](./concepts/di-and-modules.md)**: Explicit DI that stays readable and testable.
- **[Platform Consistency Design](./concepts/platform-consistency-design.md)**: The universal contract all official packages must follow.
- **[CQRS](./concepts/cqrs.md)**: Separating commands from queries for scalable architectures.

### Runtime & HTTP

- **[HTTP Runtime](./concepts/http-runtime.md)**: Routing, middleware, and adapter-agnostic request handling.
- **[Lifecycle & Shutdown](./concepts/lifecycle-and-shutdown.md)**: Deterministic startup, health signaling, and graceful exit.
- **[Dev Reload Architecture](./concepts/dev-reload-architecture.md)**: Process restarts vs. in-process config reloads.
- **[Config & Environments](./concepts/config-and-environments.md)**: Validated, typed configuration across environments.
- **[Error Handling & Responses](./concepts/error-responses.md)**: Standardized error format for predictable API failure modes.

### Data & Integration

- **[Transaction Management](./concepts/transactions.md)**: Atomic operations across Prisma, Drizzle, and Mongoose.
- **[Caching](./concepts/caching.md)**: HTTP response caching and programmatic application-level caching.
- **[OpenAPI](./concepts/openapi.md)**: Automated OpenAPI 3.1.0 document generation from your routes.

### Security & Auth

- **[Authentication & JWT](./concepts/auth-and-jwt.md)**: Strategy-agnostic identity verification and route protection.
- **[Security Middleware](./concepts/security-middleware.md)**: Best practices for protecting your API.

### Observability

- **[Observability](./concepts/observability.md)**: Built-in patterns for metrics, health, and readiness.

## 🛠️ Operations & Governance

Standards, policies, and operational guidance for maintaining and releasing fluo packages.

- **[Testing Strategies](./operations/testing-guide.md)**: From unit tests to full integration suites.
- **[Behavioral Contract Policy](./operations/behavioral-contract-policy.md)**: The binding rules for documented runtime behavior.
- **[Release Governance](./operations/release-governance.md)**: Release standards, versioning policy, and automated gates.
- **[Public Export TSDoc Baseline](./operations/public-export-tsdoc-baseline.md)**: Repo-wide minimum authoring rules for changed public exports.
- **[Production Deployment](./operations/deployment.md)**: Moving from `pnpm dev` to a production environment.
- **[Manifest Strategy Decision](./operations/manifest-decision.md)**: How package manifests are structured and why.
- **[Platform Conformance Checklist](./operations/platform-conformance-authoring-checklist.md)**: Authoring checklist for platform-consistent packages.
- **[Third-Party Extension Contract](./operations/third-party-extension-contract.md)**: The contract community packages must follow.
- **[NestJS Parity Gaps](./operations/nestjs-parity-gaps.md)**: Honest documentation on where we differ and why.

> **Tip:** Use [Release Governance](./operations/release-governance.md) for the canonical publish surface, release-readiness gates, and the CI-only single-package release operator flow. Pair it with [Testing Strategies](./operations/testing-guide.md) for preflight checks via `pnpm verify:release-readiness`.
>
> Need a runtime-portable email overview? Start with `@fluojs/email` in the package inventory, then follow the explicit Node-only SMTP subpath `@fluojs/email/node` from the package docs and chooser guides.

## 📚 Reference

Detailed technical specifications and comparisons.

- **[Package Chooser](./reference/package-chooser.md)**: Find the right tools for your specific task.
- **[API Surface Overview](./reference/package-surface.md)**: Canonical inventory of public package families, runtime coverage, and responsibilities.
- **[Package Folder Structure](./reference/package-folder-structure.md)**: Standard directory conventions for monorepo packages.
- **[fluo new Support Matrix](./reference/fluo-new-support-matrix.md)**: Starter contract vs. the broader runtime/adapter ecosystem.
- **[Compatibility Matrix](./reference/toolchain-contract-matrix.md)**: Versions, runtimes, and platform support.

## 🔄 Moving to fluo

Coming from another ecosystem? We've got you covered.

- **[NestJS Migration Guide](./getting-started/migrate-from-nestjs.md)**: A step-by-step transition for NestJS developers.

---
### Looking for something else?
- **[Runnable Examples](../examples/README.md)**: See fluo in action with real-world code.
- **[Package READMEs](../packages/)**: Every module has its own deep-dive documentation.
