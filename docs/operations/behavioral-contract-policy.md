# behavioral contract policy

<p><strong><kbd>English</kbd></strong> <a href="./behavioral-contract-policy.ko.md"><kbd>한국어</kbd></a></p>

This policy codifies the rules for preserving behavioral contracts in the Konekti monorepo. It ensures that package modifications do not silently break documented runtime expectations.

## what is a behavioral contract

A behavioral contract is a documented promise regarding a package's runtime behavior, side effects, and lifecycle. While TypeScript types define the interface, the behavioral contract defines what happens when that interface is used.

In Konekti, the behavioral contract is the authority on:
- what a component does when invoked
- what it deliberately ignores or excludes
- how it handles state, resources, and errors

## required package documentation

Every `@konekti/*` package must maintain the following sections in its `README.md` to establish its behavioral contract:

- **supported operations**: detailed semantics of public methods, functions, and decorators.
- **intentional limitations**: explicit "non-goals" or features the package deliberately does not support.
- **runtime invariants**: behavior that must remain consistent across refactors (e.g., "always throws X when Y is missing").
- **lifecycle guarantees**: cleanup, connection management, or shutdown behavior where applicable.

## contract preservation rules

- **existing behavior**: any behavior documented in a package README must be preserved during refactoring.
- **adding behavior**: new documented behaviors require tests that validate the new contract.
- **removing behavior**: removing documented intended behavior is a breaking change.
  - `0.x`: requires a minor version bump and explicit migration notes.
  - `1.0+`: requires a major version bump and a migration guide.
- **changing semantics**: changing how an existing operation behaves (even if the type signature remains the same) is a breaking change.
- **environment ownership**: ordinary package source must not read `process.env` directly. Environment values must enter through the application/bootstrap boundary and be passed as explicit parameters, typed config providers, or injected options.

Refer to `release-governance.md` for detailed versioning policy and `third-party-extension-contract.md` for extension stability rules.

## contract checklist for pull requests

PRs affecting package behavior must verify:
- [ ] No documented behavioral contracts were removed without migration notes.
- [ ] New behavioral contracts are documented in the affected package README.
- [ ] Intentional limitations are explicitly stated rather than silently removed.
- [ ] Runtime invariants are covered by regression tests.
- [ ] Package internals do not read `process.env` directly unless the file is a documented boundary/template exception.

## CI enforcement

Behavioral contract governance is enforced in CI via `pnpm verify:platform-consistency-governance`.

The governance check fails pull requests when:

- SSOT English/Korean mirror docs drift structurally.
- Contract-governing docs change without companion updates to docs index, CI/tooling enforcement, and regression-test evidence.
- Package README alignment/conformance claims are not backed by conformance harness tests (`createPlatformConformanceHarness(...)`).
- Ordinary `packages/*/src/**` source reads `process.env` directly outside repo-approved boundary/template exceptions.

## strong contract examples

The following packages serve as models for strong behavioral contracts:
- `@konekti/http`: defines guard contracts, DTO binding rules, and routing invariants.
- `@konekti/microservices`: includes transport notes with per-transport behavioral descriptions and explicit "unsupported" statements.
- `@konekti/testing`: maintains a stable testing surface boundary with clear lifecycle expectations.

## contract anti-patterns

- **silent removal**: removing a method like `send()` from a transport because "it wasn't used in the core" despite being a documented part of the transport contract.
- **undocumented limitations**: adding a new adapter that silently ignores half of the configuration options provided by the base interface.
- **implicit side effects**: introducing new background processes or resource allocations that are not documented in the package lifecycle.
- **implicit env ownership**: a library package reaching into `process.env` instead of requiring the application boundary to pass configuration explicitly.
