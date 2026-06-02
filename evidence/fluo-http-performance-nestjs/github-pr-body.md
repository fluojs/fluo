## Summary

Adds same-environment Fastify benchmark evidence for `Nest+Fastify` versus `fluo+Fastify`, keeps only contract-safe hot-path optimizations, and records the final no-go performance result instead of claiming a win.

Linked context: Closes #2087

## Changes

- Added local-tarball HTTP benchmark support, target/scenario filtering, JSON output, correctness counters, and route execution-path evidence.
- Reduced `@fluojs/http` dispatcher fast-path overhead by keeping benchmark-safe synchronous handler execution on the synchronous path.
- Split private Fastify native-route metadata/request resolution into `packages/platform-fastify/src/native-route.ts` and avoided unnecessary per-request static-route work.
- Cached resolved singleton DI multi-provider lists internally while preserving fresh arrays for callers.
- Tightened release-readiness starter-shape verification after review found a false-positive risk.
- Added evidence artifacts and no-go report for the final same-environment benchmark result.

## Testing

- `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
  - `237` test files passed
  - `3302` tests passed
- `pnpm verify:changeset-release-lane -- --lane=stable --base-ref=main && pnpm verify:release-readiness`
- `pnpm exec vitest run tooling/release/verify-release-readiness.test.ts tooling/release/local-release-dry-run-matrix.test.ts`
- Final benchmark rerun:
  - `Nest+Fastify`: `34806.24 req/sec`
  - `fluo+Fastify`: `26125.60 req/sec`
  - delta: `-24.94%`
  - correctness counters: `errors=0`, `timeouts=0`, `non2xx=0`, `mismatches=0`
- Manual QA:
  - `curl -i` read-search route returned `HTTP/1.1 200 OK`
  - port `3106` cleanup verified with no listener output

## Release impact

- [x] This PR has consumer-visible release impact and includes a changeset.
- [ ] This PR has no consumer-visible release impact.

Patch changesets are included for:

- `@fluojs/http`
- `@fluojs/platform-fastify`
- `@fluojs/di`

## Public export documentation

- [x] Changed public exports include a source-level summary.
- [x] Changed exported functions document matching `@param` / `@returns` tags where applicable.
- [x] Source `@example` blocks and README scenario examples still play complementary roles.

`pnpm lint` and `pnpm verify:public-export-tsdoc` passed through final verification. No public export map changes were made.

## Behavioral contract

- [x] No documented behavioral contracts were removed without migration notes.
- [ ] New behavioral contracts are documented in the affected package README.
- [x] Intentional limitations are explicitly stated (not silently removed).
- [x] Runtime invariants are covered by regression tests.

No new public behavioral contract was introduced. Existing fallback behavior remains covered for multipart requests, raw-body handling, path normalization-sensitive routes, params containing `/`, and DI multi-provider caller mutation isolation.

## Platform consistency governance (SSOT)

- [x] SSOT English/Korean mirror structure remains synchronized for changed governance docs.
- [x] If platform contract docs changed, companion updates include discoverability/docs index, tooling or CI enforcement, and regression-test evidence.
- [x] Any package README alignment/conformance claims are backed by `createPlatformConformanceHarness(...)` tests.

No governance docs or package README alignment claims changed. Docs parity verification was not applicable because docs/book/README locale files were not changed.

## Remaining risks

- The Fastify performance target was not met. The PR records this as no-go evidence.
- The release readiness starter-shape check remains string-based, though it now requires the Fastify platform import plus the helper/call shape and has regression coverage.
