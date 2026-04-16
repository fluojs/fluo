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

- **[Quick Start](./getting-started/quick-start.md)**: The canonical install -> `new` -> `dev` path.
- **[First Feature Path](./getting-started/first-feature-path.md)**: Moving from a boilerplate to your first real domain logic.
- **[Bootstrap & Startup](./getting-started/bootstrap-paths.md)**: How fluo handles application lifecycle and initialization.
- **[Glossary & Mental Model](./reference/glossary-and-mental-model.md)**: The core vocabulary of the framework.

## 🧠 Core Concepts

Understand the "Why" and "How" behind fluo's design choices.

- **[Architecture Overview](./concepts/architecture-overview.md)**: Package boundaries and the flow of a request.
- **[Standard Decorators](./concepts/decorators-and-metadata.md)**: Why we ditched legacy flags for the TC39 standard.
- **[Dependency Injection](./concepts/di-and-modules.md)**: Explicit DI that stays readable and testable.
- **[HTTP Runtime](./concepts/http-runtime.md)**: Routing, middleware, and adapter-agnostic request handling.
- **[Observability](./concepts/observability.md)**: Built-in patterns for metrics, health, and readiness.

## 🛠️ Developer Guides

Practical, task-oriented documentation for day-to-day development.

- **[Testing Strategies](./operations/testing-guide.md)**: From unit tests to full integration suites.
- **[Behavioral Contract Policy](./operations/behavioral-contract-policy.md)**: The binding rules for documented runtime behavior.
- **[Release Governance](./operations/release-governance.md)**: Release standards, versioning policy, and automated gates.
- **[Public Export TSDoc Baseline](./operations/public-export-tsdoc-baseline.md)**: Repo-wide minimum authoring rules for changed public exports.
- **[CLI Workflow](./getting-started/generator-workflow.md)**: Using generators to maintain consistency.
- **[Security Middleware](./concepts/security-middleware.md)**: Best practices for protecting your API.
- **[Production Deployment](./operations/deployment.md)**: Moving from `pnpm dev` to a production environment.

Use [Release Governance](./operations/release-governance.md) when you need the canonical intended publish surface, release-readiness gates, the enforced internal `workspace:^` dependency-range policy for public packages, or the CI-only single-package release operator flow, its companion `pnpm verify:platform-consistency-governance` gate, and supervised-auto release boundaries.

Use [Testing Strategies](./operations/testing-guide.md) alongside Release Governance when you need the canonical verification path for CI-only single-package publish preflight checks via `pnpm verify:release-readiness --target-package --target-version --dist-tag` and the associated runbook.

## 📚 Reference

Detailed technical specifications and comparisons.

- **[Package Chooser](./reference/package-chooser.md)**: Find the right tools for your specific task.
- **[fluo new Support Matrix](./reference/fluo-new-support-matrix.md)**: The current starter contract versus the broader documented runtime/adapter ecosystem.
- **[API Surface Overview](./reference/package-surface.md)**: The canonical inventory of public package families, runtime coverage, and package responsibilities.
- **[Compatibility Matrix](./reference/toolchain-contract-matrix.md)**: Versions, runtimes, and platform support.

The notification family (`@fluojs/notifications`, `@fluojs/email`, `@fluojs/email/node`, `@fluojs/slack`, and `@fluojs/discord`) is indexed through the package chooser and package surface reference pages above.

## 🔄 Moving to fluo

Coming from another ecosystem? We've got you covered.

- **[NestJS Migration Guide](./getting-started/migrate-from-nestjs.md)**: A step-by-step transition for NestJS developers.
- **[Parity Gaps](./operations/nestjs-parity-gaps.md)**: Honest documentation on where we differ and why.

---
### Looking for something else?
- **[Runnable Examples](../examples/README.md)**: See fluo in action with real-world code.
- **[Package READMEs](../packages/)**: Every module has its own deep-dive documentation.
