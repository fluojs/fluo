## Summary

<!-- Briefly describe the goal and context of these changes. -->

## Changes

<!-- List the key changes in this PR. -->

## Testing

<!-- How did you verify these changes? Include test results or instructions. -->

## Public export documentation

See [docs/operations/public-export-tsdoc-baseline.md](docs/operations/public-export-tsdoc-baseline.md) for the repo-wide authoring baseline.

- [ ] Changed public exports include a source-level summary.
- [ ] Changed exported functions document matching `@param` / `@returns` tags where applicable.
- [ ] Source `@example` blocks and README scenario examples still play complementary roles.

## Behavioral contract

See [docs/operations/behavioral-contract-policy.md](docs/operations/behavioral-contract-policy.md) for full details.

- [ ] No documented behavioral contracts were removed without migration notes.
- [ ] New behavioral contracts are documented in the affected package README.
- [ ] Intentional limitations are explicitly stated (not silently removed).
- [ ] Runtime invariants are covered by regression tests.

## Platform consistency governance (SSOT)

See [docs/concepts/platform-consistency-design.md](docs/concepts/platform-consistency-design.md) and [docs/operations/release-governance.md](docs/operations/release-governance.md).

- [ ] SSOT English/Korean mirror structure remains synchronized for changed governance docs.
- [ ] If platform contract docs changed, companion updates include discoverability/docs index, tooling or CI enforcement, and regression-test evidence.
- [ ] Any package README alignment/conformance claims are backed by `createPlatformConformanceHarness(...)` tests.
