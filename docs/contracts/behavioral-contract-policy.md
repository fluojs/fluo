# Behavioral Contract Rules

<p><strong><kbd>English</kbd></strong> <a href="./behavioral-contract-policy.ko.md"><kbd>한국어</kbd></a></p>

Behavioral contracts are binding runtime promises documented in package `README.md` files, contract docs, and package level test expectations. Types describe shape. Behavioral contracts describe ordering, side effects, failure modes, lifecycle guarantees, and shutdown behavior.

## Rule 1: Contract Preservation

- Treat every documented runtime guarantee as a maintained contract.
- Update the implementation, documentation, and tests together when contract behavior changes.
- Keep package `README.md` files and Korean mirrors aligned for supported operations, lifecycle guarantees, runtime invariants, and intentional limitations.
- Do not merge changes that silently alter documented ordering, thrown errors, cleanup semantics, adapter behavior, or readiness behavior.
- If a package exposes a public runtime surface, keep at least one executable test that exercises the documented behavior.

Examples of behavioral contracts include:

- A decorator runs before module initialization.
- A provider throws a configuration error when required input is missing.
- A platform adapter closes idle keep alive connections during shutdown.
- A config reload manager serializes overlapping reload requests and rolls back to the previous snapshot when a reload listener fails.

## Rule 2: Breaking Change Policy

- In `0.x`, breaking behavioral changes may ship only in a minor release, and the release must include a migration note in `CHANGELOG.md`.
- In `1.0+`, breaking behavioral changes must trigger a major version bump.
- Do not classify a behavior change as minor or patch if users must change configuration, bootstrap order, adapter usage, or public API expectations to keep working code.
- Pair behavior breaking changes with release governance updates when the package is on the intended publish surface.

Release classification and release gates are enforced with the repository release workflow:

```bash
pnpm verify:release-readiness
```

## Rule 3: Environment Isolation

- Ordinary package source must not read `process.env` directly.
- Configuration must enter package code through the application boundary, normally with `@fluojs/config`, then flow as explicit parameters, injected services, or typed module options.
- CLI bootstrap and scaffold code are documented exceptions in the governance script. Package internals are not.
- Platform packages must preserve the same isolation boundary. They must not bypass `@fluojs/config` as a substitute for proper adapter inputs.

Use this pattern:

```ts
ConfigModule.forRoot({
  processEnv: process.env,
});
```

Avoid this pattern inside package source:

```ts
const secret = process.env.JWT_SECRET;
```

## Enforcement

Run these repository gates when contract governing docs or governed package behavior changes:

```bash
pnpm verify:platform-consistency-governance
pnpm verify:release-readiness
pnpm vitest run tooling/governance/verify-platform-consistency-governance.test.ts
```

These checks enforce the rules in concrete ways:

1. `pnpm verify:platform-consistency-governance` checks EN and KO heading parity for this document pair and other governance SSOT documents.
2. The same governance script rejects direct `process.env` access in ordinary package source and reports the violating file and line.
3. `pnpm verify:release-readiness` reuses the governance gate during release verification so contract docs and release evidence stay synchronized.
4. Package test suites are expected to cover documented behavioral guarantees so regressions fail before release.

## Related Docs

- [Release Governance](./release-governance.md)
- [Third-Party Extension Contract](./third-party-extension-contract.md)
- [Platform Conformance Authoring Checklist](./platform-conformance-authoring-checklist.md)
- [Testing Guide](./testing-guide.md)
