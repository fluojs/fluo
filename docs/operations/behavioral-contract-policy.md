# Behavioral Contract Policy

<p>
  <strong>English</strong> | <a href="./behavioral-contract-policy.ko.md">한국어</a>
</p>

This policy defines the governance and rules for preserving behavioral contracts within the Konekti framework. It ensures that changes to the codebase do not silently break documented runtime expectations, side effects, or lifecycle guarantees.

## When this document matters

- **Core Refactoring**: When modifying existing `@konekti/*` packages or internal runtime logic.
- **API Authoring**: When introducing new public decorators, providers, or platform adapters.
- **Documentation**: When authoring or updating package-level `README.md` files and operational guides.
- **Pull Request Review**: As a primary checklist for maintainers to verify that contract conformance is maintained.

---

## Policy Definition

### 1. What is a Behavioral Contract?
A behavioral contract is a documented promise regarding a package's runtime behavior. While TypeScript types define the **interface** (what goes in and out), the behavioral contract defines the **semantics** (how the implementation behaves).

**Examples of Contracts:**
- "This decorator always evaluates before the module is initialized."
- "This provider throws a `ConfigurationError` if `API_KEY` is missing."
- "This adapter closes all idle keep-alive connections within 5 seconds of receiving a shutdown signal."

### 2. Documentation Requirements
Every `@konekti/*` package MUST maintain the following in its `README.md` (and the Korean mirror):
- **Supported Operations**: The detailed semantics of public methods and decorators.
- **Runtime Invariants**: Behaviors that must remain consistent across different platforms (Node.js, Bun, Deno).
- **Lifecycle Guarantees**: Explicit behavior for initialization, cleanup, and graceful shutdown.
- **Intentional Limitations**: Explicitly documented "non-goals" to prevent accidental feature creep.

---

## Governance Rules

### Rule 1: Contract Preservation
Any behavior documented in a package's README or operational docs is considered a binding contract. Modifying this behavior without following the **Breaking Change Policy** is a violation of this governance.

### Rule 2: Breaking Change Policy
- **0.x Phase**: Breaking changes are permitted in **Minor** releases (`0.X.0`) but MUST be accompanied by a migration note in the `CHANGELOG.md`.
- **1.0+ Phase**: Breaking changes are strictly prohibited in minor/patch releases and MUST trigger a **Major** version bump with a comprehensive migration guide.

### Rule 3: Environment Isolation
Packages must not access `process.env` directly. All environment-driven configurations must enter the system through the application boundary (typically via `@konekti/config`) and be passed as explicit parameters or injected options.

---

## Enforcement

Konekti uses automated gates to ensure compliance:
1.  **Structural Parity**: `pnpm verify:platform-consistency-governance` fails if English and Korean documentation structures drift.
2.  **Access Control**: Static analysis tools block direct `process.env` access in core packages.
3.  **Regression Testing**: All documented contracts must be backed by a corresponding test case in the package's test suite.

---

## Related Docs
- [Release Governance](./release-governance.md)
- [Third-Party Extension Contract](./third-party-extension-contract.md)
- [Platform Conformance Authoring Checklist](./platform-conformance-authoring-checklist.md)
- [Testing Guide](./testing-guide.md)
