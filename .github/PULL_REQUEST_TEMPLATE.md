## Summary

<!-- Briefly describe the goal and context of these changes. -->

Linked context: <!-- Link an issue/discussion if one exists. If not, summarize the problem this PR solves. AI-assisted PRs are welcome; keep the original context connected here. -->

## Changes

<!-- List the key changes in this PR. -->

## Testing

<!-- How did you verify these changes? Include test results or instructions. -->

## Release impact

<!-- Add a .changeset/*.md file when this PR changes public @fluojs/* package behavior, API surface, package contents, or release metadata. Docs-only, test-only, and internal-only changes usually do not need one. -->

- [ ] This PR has consumer-visible release impact and includes a changeset.
- [ ] This PR has no consumer-visible release impact.

## Public export documentation

See [docs/contracts/public-export-tsdoc-baseline.md](docs/contracts/public-export-tsdoc-baseline.md) for the repo-wide authoring baseline.

- [ ] Changed public exports include a source-level summary.
- [ ] Changed exported functions document matching `@param` / `@returns` tags where applicable.
- [ ] Source `@example` blocks and README scenario examples still play complementary roles.

## Behavioral contract

See [docs/contracts/behavioral-contract-policy.md](docs/contracts/behavioral-contract-policy.md) for full details.

- [ ] No documented behavioral contracts were removed without migration notes.
- [ ] New behavioral contracts are documented in the affected package README.
- [ ] Intentional limitations are explicitly stated (not silently removed).
- [ ] Runtime invariants are covered by regression tests.

## Platform consistency governance (SSOT)

See [docs/architecture/platform-consistency-design.md](docs/architecture/platform-consistency-design.md) and [docs/contracts/release-governance.md](docs/contracts/release-governance.md).

- [ ] SSOT English/Korean mirror structure remains synchronized for changed governance docs.
- [ ] If platform contract docs changed, companion updates include discoverability/docs index, tooling or CI enforcement, and regression-test evidence.
- [ ] Any package README alignment/conformance claims are backed by `createPlatformConformanceHarness(...)` tests.
