# Public Export TSDoc Baseline

<p>
  <strong>English</strong> | <a href="./public-export-tsdoc-baseline.ko.md">한국어</a>
</p>

This guide defines the minimum source-level TSDoc baseline for changed public exports in `@fluojs/*` packages. It keeps IDE hover help, code review expectations, and package README examples aligned before the package-group rollout begins.

## When this document matters

- **Public API authoring**: when adding or changing exported functions, classes, interfaces, types, enums, or constants under `packages/*/src`.
- **Package-group documentation waves**: when broadening rich TSDoc coverage package-by-package after this repo-wide baseline lands.
- **Pull request review**: when checking whether changed exports are documented strongly enough for downstream contributors.

---

## Minimum baseline

Every changed public export MUST include:

- A one-line-or-better summary that explains the contract in plain language.
- `@param` for every named function parameter.
- `@returns` for every non-`void` exported function return value.

The following tags are strongly recommended when they clarify runtime behavior, but they are not part of the initial automated gate:

- `@throws` for contract-level errors or failure states a caller must handle.
- `@example` for first-party entry points, decorators, factory helpers, and APIs that benefit from hoverable usage.
- `@remarks` for caveats, lifecycle notes, or behavioral context that would be too noisy in the summary line.

## Source `@example` vs README examples

- **Source `@example`** blocks should stay short and hover-friendly. They answer “how do I call this symbol correctly?”
- **README examples** should stay scenario-driven. They answer “how does this capability fit into a package workflow?”
- Do not move lifecycle guarantees, runtime invariants, or intentional limitations out of the package README. Those remain part of the behavioral contract surface.

---

## Golden examples

Use these repo-local references as the preferred writing style:

- `packages/graphql/src/dataloader/dataloader.ts`: summary + `@example` + `@param` + `@returns` for first-party factories.
- `packages/cache-manager/src/decorators.ts`: concise decorator summaries with stable `@param` / `@returns` wording.
- `packages/di/src/container.ts`: behavioral `@throws` documentation on container lifecycle operations.
- `packages/graphql/README.md`, `packages/cache-manager/README.md`, `packages/di/README.md`: scenario-level README examples that complement source-level hover docs.

## Authoring checklist

- [ ] Every changed public export has a source-level summary.
- [ ] Exported functions document each named parameter with `@param`.
- [ ] Exported functions with a non-`void` return type document `@returns`.
- [ ] Caller-visible failure behavior uses `@throws` when omitting it would hide an important contract detail.
- [ ] Entry-point APIs add a short `@example` when hover docs would otherwise feel abstract.
- [ ] Package README examples remain scenario-driven and still cover the workflow-level usage for the changed API.

## Automation

- `pnpm lint` now includes `pnpm verify:public-export-tsdoc`.
- The gate scopes itself to changed files under `packages/*/src` so the repo-wide rollout can proceed package-group by package-group.
- Re-export barrels are ignored by the automated check; document the underlying declaration where the symbol is defined.

## Related Docs

- [Contributing](../../CONTRIBUTING.md)
- [Release Governance](./release-governance.md)
- [Behavioral Contract Policy](./behavioral-contract-policy.md)
