# platform conformance authoring checklist

<p><strong><kbd>English</kbd></strong> <a href="./platform-conformance-authoring-checklist.ko.md"><kbd>한국어</kbd></a></p>

This checklist turns the platform consistency SSOT acceptance criteria into authoring gates for official platform-facing packages.

Primary authority:

- `../concepts/platform-consistency-design.md`
- `./behavioral-contract-policy.md`

## when to use this checklist

Use this checklist whenever a package starts participating in the runtime-owned platform shell (`platform.components`) or changes existing platform contract behavior.

## required conformance harness gate

Every official platform-facing package must include tests that execute the shared conformance harness from `@konekti/testing`:

- `createPlatformConformanceHarness(...)`
- `assertAll()` **or** explicit per-invariant assertions

Minimum invariants covered by the harness:

- `validate()` does not create long-lived side effects.
- `start()` is deterministic (idempotent success or deterministic duplicate rejection).
- `stop()` is idempotent.
- `snapshot()` is callable in degraded and failed states.
- diagnostics expose stable non-empty codes and include fix hints for error severities.
- snapshots are sanitized (no sensitive credential/secret key paths).

## package authoring checklist

Before claiming platform consistency alignment, the package change set must satisfy all items:

- [ ] Exposes explicit config options and validates them at bootstrap.
- [ ] Documents deterministic `start()` and idempotent `stop()` behavior.
- [ ] Defines readiness semantics separately from health semantics.
- [ ] Emits structured diagnostics with stable `code` values and actionable `fixHint` text.
- [ ] Exports sanitized snapshots (no secret-bearing fields).
- [ ] Declares dependency edges and resource ownership semantics.
- [ ] Uses shared telemetry namespace/tag conventions.
- [ ] Remains consumable by CLI and Studio without package-specific parsing logic.

## PR evidence requirements

PRs for platform-facing packages should include:

1. Link to harness-backed test files.
2. Note whether any documented behavioral contract changed.
3. README updates when behavior or runtime invariants changed.
4. Verification output (`pnpm test`, `pnpm typecheck`, `pnpm build`, or `pnpm verify`).
