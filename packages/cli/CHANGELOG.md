# @fluojs/cli

## 1.0.3

### Patch Changes

- [#1885](https://github.com/fluojs/fluo/pull/1885) [`acf0a8d`](https://github.com/fluojs/fluo/commit/acf0a8d5a0f881028caedf6f1001f1a1e89281f4) Thanks [@ayden94](https://github.com/ayden94)! - Align generated e2e test imports with the default `fluo new` starter root module at `src/app` while preserving explicit root module import overrides.

- [#1886](https://github.com/fluojs/fluo/pull/1886) [`66179a9`](https://github.com/fluojs/fluo/commit/66179a93827fb4af969f26cd2ee6747fa75657fa) Thanks [@ayden94](https://github.com/ayden94)! - Harden the fluo-owned dev restart runner fallback so platforms without recursive `fs.watch` still restart on nested source-tree changes.

- [#1884](https://github.com/fluojs/fluo/pull/1884) [`6f3fd14`](https://github.com/fluojs/fluo/commit/6f3fd142bde826706b6f6a458a7908b720646655) Thanks [@ayden94](https://github.com/ayden94)! - Keep generated NATS, Kafka, and RabbitMQ starters import-safe by lazily creating broker clients inside the Fluo-owned transport lifecycle instead of during module import.

- [#1887](https://github.com/fluojs/fluo/pull/1887) [`3a13112`](https://github.com/fluojs/fluo/commit/3a13112624e3f089197c97a501c72b1592a16d92) Thanks [@ayden94](https://github.com/ayden94)! - Preserve default JSON snapshot output when `fluo inspect --timing` is used without an explicit output mode, emitting the same `{ snapshot, timing }` envelope as `--json --timing`.

- [#1882](https://github.com/fluojs/fluo/pull/1882) [`c37a61a`](https://github.com/fluojs/fluo/commit/c37a61a9cdb12b02899de7ee18f42c5f109aa2b7) Thanks [@ayden94](https://github.com/ayden94)! - Support documented TypeScript source module paths in `fluo inspect` while preserving native `.js` and `.mjs` module loading.

- [#1888](https://github.com/fluojs/fluo/pull/1888) [`43b3072`](https://github.com/fluojs/fluo/commit/43b3072bfa0bacf37145bcf647c07f93c280b2a0) Thanks [@ayden94](https://github.com/ayden94)! - Skip the interactive CLI update check for pure help invocations and print `fluo help info` with info-branded usage text.

## 1.0.1

### Patch Changes

- [#1853](https://github.com/fluojs/fluo/pull/1853) [`010f5ac`](https://github.com/fluojs/fluo/commit/010f5ac256a65f616b39ff5fc6bad049b14efd8c) Thanks [@ayden94](https://github.com/ayden94)! - Keep generated starter CLI scripts aligned to the generator version and bound `fluo dev` restart shutdowns so non-cooperative child processes cannot hang restarts indefinitely.

- Updated dependencies [[`92636ee`](https://github.com/fluojs/fluo/commit/92636eee23991859a04f4590871179508dee12fb), [`5fa7b54`](https://github.com/fluojs/fluo/commit/5fa7b549e760cb6b1be82a7e7e7c1f7e011b0ea2)]:
  - @fluojs/studio@1.0.1
  - @fluojs/runtime@1.1.0

## 1.0.0

### Minor Changes

- 185487f: Expand CLI automation outputs for generation, inspection, migration, scaffolding, and generator metadata.

  Expose Studio-owned snapshot-to-Mermaid rendering helpers and platform snapshot types.

  Refresh the published Fastify adapter dependency metadata to fastify@^5.8.5.

- 45a84a8: Align generated project lifecycle scripts around `fluo dev`, `fluo build`, and `fluo start`, with CLI-owned runtime commands, project-local toolchain binary resolution, Workers preview-safe start behavior, and Next.js-like `NODE_ENV` defaults that preserve explicitly provided environment values.
- 6cb8d78: Add CLI roadmap command MVPs for version inspection, diagnostics, script orchestration, package workflow guidance, and composite resource generation.
- 922fa87: Update the CLI self-update flow to reuse the package manager that owns the current global install instead of always invoking pnpm.
- b6ab426: Add module slice-test, resource slice-test, and e2e test generators so generated projects can scaffold the canonical fluo TDD ladder with `createTestingModule({ rootModule })` and `createTestApp({ rootModule })`.
- f516e5f: Replace the generated starter-owned `src/health/*` example slice and `/health-info` route with a `src/greeting/*` feature slice exposed at `/greeting`. Runtime operational health remains owned by `HealthModule.forRoot(...)`, so new projects should treat `/health` and `/ready` as runtime endpoints and use the greeting slice as the starter application-structure example.
- 1b75835: Extract the generated Vite decorator transform into the new `@fluojs/vite` package so `fluo new` projects import a maintained plugin instead of copying the Babel implementation inline.
- f28a8c8: Add configurable runtime console logger modes and level filtering, and add CLI lifecycle reporter controls for quieter interactive dev output while preserving raw passthrough for CI and debugging.

### Patch Changes

- 6c877e2: Preserve Bun app terminal color detection when `fluo dev` or `fluo start` pipes child output through the CLI lifecycle reporter.
- e0427f6: Include Bun globals in generated Bun starter TypeScript configuration so pnpm typecheck succeeds when the starter references `Bun.env`.
- 292634e: Keep interactive `fluo dev` application output visible with an `app │` prefix so CLI lifecycle status and runtime logs remain easy to distinguish.
- 207de57: Preserve `runCli(...)` numeric exit-code behavior when lifecycle command spawning fails, and align CLI learning docs with the Node.js 20+ package baseline.
- ca1bbdd: Update generated `fluo new` starters to import `HealthModule` directly from `@fluojs/runtime`, call `HealthModule.forRoot()`, and omit explicit metadata symbol setup from the greeting controller scaffold.
- cf2be08: Generated starter e2e templates now use the application-level `app.request(...).send()` testing helper as the default HTTP request path.
- 0b0bb10: Refresh `fluo new` starter dependency pins to the latest published beta versions of the generated `@fluojs/*` packages.
- 2239996: Refresh the interactive CLI latest-version check for `fluo new` and `fluo create` before scaffolding while preserving cached update checks for normal commands.
- 2e3408f: Keep colorized application logs consistent between `fluo dev` and `fluo start` by preserving ANSI color intent through the CLI development reporter.
- 93fc34b: Add `HealthModule.forRoot(...)` as the application-facing runtime health facade and update generated starters to use it while preserving the deprecated `createHealthModule(...)` compatibility helper.
- c7a31c3: Preserve fluo application log colors when generated Bun, Deno, and Cloudflare Workers dev lifecycles run through the CLI reporter.
- 6adc9dc: Clarify generated Node.js starter logging defaults and point JSON-log opt-ins to the runtime logger factory.
- 9295ce5: Update generated Bun, Deno, and Cloudflare Workers starter lifecycles so `fluo dev` defaults to runtime-native watch loops with an explicit `--runner fluo` fallback, while production and deployment use runtime-native commands.
- fd0aeda: Normalize generated HTTP starter tests around colocated unit/slice coverage plus a dedicated `test/app.e2e.test.ts` suite, and expose `test:cov`/`test:e2e` scripts for Vitest-backed starters.
- 1f312e0: Add a fluo-owned Node dev restart runner that dedupes unchanged file saves before restart while preserving raw runtime watcher escape hatches. Config watch reloads now also skip unchanged env file saves and change-then-revert bursts before replacing the in-process snapshot.
- Updated dependencies [185487f]
- Updated dependencies [da003a1]
- Updated dependencies [1b0a68a]
- Updated dependencies [93fc34b]
- Updated dependencies [37ae1c5]
- Updated dependencies [48a9f97]
- Updated dependencies [53a2b8e]
- Updated dependencies [005d3d7]
- Updated dependencies [f8d05fa]
- Updated dependencies [b74832f]
- Updated dependencies [4333cee]
- Updated dependencies [f28a8c8]
- Updated dependencies [6b8e8a9]
- Updated dependencies [89f6379]
- Updated dependencies [f0dce1f]
- Updated dependencies [c509e27]
- Updated dependencies [c3ef937]
- Updated dependencies [69936b1]
- Updated dependencies [35f60fd]
- Updated dependencies [ec504ae]
- Updated dependencies [db1723c]
- Updated dependencies [3ccf4e1]
- Updated dependencies [d3504c6]
  - @fluojs/studio@1.0.0
  - @fluojs/runtime@1.0.0

## 1.0.0-beta.8

### Minor Changes

- [#1581](https://github.com/fluojs/fluo/pull/1581) [`b6ab426`](https://github.com/fluojs/fluo/commit/b6ab4260fd6b641d94eb144d771a5cac311d2de0) Thanks [@ayden94](https://github.com/ayden94)! - Add module slice-test, resource slice-test, and e2e test generators so generated projects can scaffold the canonical fluo TDD ladder with `createTestingModule({ rootModule })` and `createTestApp({ rootModule })`.

### Patch Changes

- [#1626](https://github.com/fluojs/fluo/pull/1626) [`207de57`](https://github.com/fluojs/fluo/commit/207de57ffb524d1a6150304030d50831f9085101) Thanks [@ayden94](https://github.com/ayden94)! - Preserve `runCli(...)` numeric exit-code behavior when lifecycle command spawning fails, and align CLI learning docs with the Node.js 20+ package baseline.

- [#1580](https://github.com/fluojs/fluo/pull/1580) [`cf2be08`](https://github.com/fluojs/fluo/commit/cf2be087c19465aa01ad4d58ecb6ffd6452eed25) Thanks [@ayden94](https://github.com/ayden94)! - Generated starter e2e templates now use the application-level `app.request(...).send()` testing helper as the default HTTP request path.

- [#1578](https://github.com/fluojs/fluo/pull/1578) [`fd0aeda`](https://github.com/fluojs/fluo/commit/fd0aedaf385e79bb1cefd0bd7e05d3d71a9509ef) Thanks [@ayden94](https://github.com/ayden94)! - Normalize generated HTTP starter tests around colocated unit/slice coverage plus a dedicated `test/app.e2e.test.ts` suite, and expose `test:cov`/`test:e2e` scripts for Vitest-backed starters.

- Updated dependencies [[`b74832f`](https://github.com/fluojs/fluo/commit/b74832f7d3d17a7d0bb071dabcced291f3543f44), [`f0dce1f`](https://github.com/fluojs/fluo/commit/f0dce1f493688907e60b27701b6d7d664a352294), [`db1723c`](https://github.com/fluojs/fluo/commit/db1723cde769526a6ad73e19424fc78297ec745a), [`d3504c6`](https://github.com/fluojs/fluo/commit/d3504c6a822bdab95bb638852dba2d9b865fc34f)]:
  - @fluojs/runtime@1.0.0-beta.12
  - @fluojs/studio@1.0.0-beta.4

## 1.0.0-beta.7

### Patch Changes

- [#1566](https://github.com/fluojs/fluo/pull/1566) [`6adc9dc`](https://github.com/fluojs/fluo/commit/6adc9dca23341bd97cc6c64aeb041c80f29f15dc) Thanks [@ayden94](https://github.com/ayden94)! - Clarify generated Node.js starter logging defaults and point JSON-log opt-ins to the runtime logger factory.

## 1.0.0-beta.6

### Minor Changes

- [#1556](https://github.com/fluojs/fluo/pull/1556) [`f516e5f`](https://github.com/fluojs/fluo/commit/f516e5f10dd6aaaf9a8cde44031f4eebd42d6fc5) Thanks [@ayden94](https://github.com/ayden94)! - Replace the generated starter-owned `src/health/*` example slice and `/health-info` route with a `src/greeting/*` feature slice exposed at `/greeting`. Runtime operational health remains owned by `HealthModule.forRoot(...)`, so new projects should treat `/health` and `/ready` as runtime endpoints and use the greeting slice as the starter application-structure example.

- [#1563](https://github.com/fluojs/fluo/pull/1563) [`1b75835`](https://github.com/fluojs/fluo/commit/1b7583508375a8a4cd7b5cbfa69bced006e5df5d) Thanks [@ayden94](https://github.com/ayden94)! - Extract the generated Vite decorator transform into the new `@fluojs/vite` package so `fluo new` projects import a maintained plugin instead of copying the Babel implementation inline.

### Patch Changes

- [#1558](https://github.com/fluojs/fluo/pull/1558) [`6c877e2`](https://github.com/fluojs/fluo/commit/6c877e2dfb07b4514aae027eece38db673cc9a05) Thanks [@ayden94](https://github.com/ayden94)! - Preserve Bun app terminal color detection when `fluo dev` or `fluo start` pipes child output through the CLI lifecycle reporter.

- [#1551](https://github.com/fluojs/fluo/pull/1551) [`e0427f6`](https://github.com/fluojs/fluo/commit/e0427f6d260f2dffaf0dc34a98909ddab0eecb40) Thanks [@ayden94](https://github.com/ayden94)! - Include Bun globals in generated Bun starter TypeScript configuration so pnpm typecheck succeeds when the starter references `Bun.env`.

- [#1547](https://github.com/fluojs/fluo/pull/1547) [`292634e`](https://github.com/fluojs/fluo/commit/292634e5be6b17257c3248d4fe79d82d29ea8c3b) Thanks [@ayden94](https://github.com/ayden94)! - Keep interactive `fluo dev` application output visible with an `app │` prefix so CLI lifecycle status and runtime logs remain easy to distinguish.

- [#1557](https://github.com/fluojs/fluo/pull/1557) [`ca1bbdd`](https://github.com/fluojs/fluo/commit/ca1bbdd84b71bfe3e5f8af9321cd4624aa376c52) Thanks [@ayden94](https://github.com/ayden94)! - Update generated `fluo new` starters to import `HealthModule` directly from `@fluojs/runtime`, call `HealthModule.forRoot()`, and omit explicit metadata symbol setup from the greeting controller scaffold.

- [#1549](https://github.com/fluojs/fluo/pull/1549) [`2e3408f`](https://github.com/fluojs/fluo/commit/2e3408f93675e0aa8a2740209ce4061692183292) Thanks [@ayden94](https://github.com/ayden94)! - Keep colorized application logs consistent between `fluo dev` and `fluo start` by preserving ANSI color intent through the CLI development reporter.

- [#1554](https://github.com/fluojs/fluo/pull/1554) [`93fc34b`](https://github.com/fluojs/fluo/commit/93fc34bba9d82870da49d9e69ad6e62821f598b0) Thanks [@ayden94](https://github.com/ayden94)! - Add `HealthModule.forRoot(...)` as the application-facing runtime health facade and update generated starters to use it while preserving the deprecated `createHealthModule(...)` compatibility helper.

- [#1562](https://github.com/fluojs/fluo/pull/1562) [`c7a31c3`](https://github.com/fluojs/fluo/commit/c7a31c356942556f4f4c84e8bec0ef62e1d94785) Thanks [@ayden94](https://github.com/ayden94)! - Preserve fluo application log colors when generated Bun, Deno, and Cloudflare Workers dev lifecycles run through the CLI reporter.

- [#1560](https://github.com/fluojs/fluo/pull/1560) [`9295ce5`](https://github.com/fluojs/fluo/commit/9295ce57d965639baec9ed03d806b743e66d3251) Thanks [@ayden94](https://github.com/ayden94)! - Update generated Bun, Deno, and Cloudflare Workers starter lifecycles so `fluo dev` defaults to runtime-native watch loops with an explicit `--runner fluo` fallback, while production and deployment use runtime-native commands.

- Updated dependencies [[`93fc34b`](https://github.com/fluojs/fluo/commit/93fc34bba9d82870da49d9e69ad6e62821f598b0)]:
  - @fluojs/runtime@1.0.0-beta.11

## 1.0.0-beta.5

### Minor Changes

- [#1535](https://github.com/fluojs/fluo/pull/1535) [`45a84a8`](https://github.com/fluojs/fluo/commit/45a84a87fe77d2936ab075d2c7b3eafd870d3b41) Thanks [@ayden94](https://github.com/ayden94)! - Align generated project lifecycle scripts around `fluo dev`, `fluo build`, and `fluo start`, with CLI-owned runtime commands, project-local toolchain binary resolution, Workers preview-safe start behavior, and Next.js-like `NODE_ENV` defaults that preserve explicitly provided environment values.

- [#1531](https://github.com/fluojs/fluo/pull/1531) [`6cb8d78`](https://github.com/fluojs/fluo/commit/6cb8d781f3ac62f7848da71aad292d78948abf04) Thanks [@ayden94](https://github.com/ayden94)! - Add CLI roadmap command MVPs for version inspection, diagnostics, script orchestration, package workflow guidance, and composite resource generation.

- [#1539](https://github.com/fluojs/fluo/pull/1539) [`f28a8c8`](https://github.com/fluojs/fluo/commit/f28a8c8e01a2dea8906c1d0b47ed60c4966b8081) Thanks [@ayden94](https://github.com/ayden94)! - Add configurable runtime console logger modes and level filtering, and add CLI lifecycle reporter controls for quieter interactive dev output while preserving raw passthrough for CI and debugging.

### Patch Changes

- [#1538](https://github.com/fluojs/fluo/pull/1538) [`2239996`](https://github.com/fluojs/fluo/commit/2239996bcc61c5fa63427511c6927ad0e248b78c) Thanks [@ayden94](https://github.com/ayden94)! - Refresh the interactive CLI latest-version check for `fluo new` and `fluo create` before scaffolding while preserving cached update checks for normal commands.

- [#1540](https://github.com/fluojs/fluo/pull/1540) [`1f312e0`](https://github.com/fluojs/fluo/commit/1f312e02ff7123a82c63d86d022ec9d3bb8c92eb) Thanks [@ayden94](https://github.com/ayden94)! - Add a fluo-owned Node dev restart runner that dedupes unchanged file saves before restart while preserving raw runtime watcher escape hatches. Config watch reloads now also skip unchanged env file saves and change-then-revert bursts before replacing the in-process snapshot.

- Updated dependencies [[`f28a8c8`](https://github.com/fluojs/fluo/commit/f28a8c8e01a2dea8906c1d0b47ed60c4966b8081)]:
  - @fluojs/runtime@1.0.0-beta.10

## 1.0.0-beta.4

### Patch Changes

- [#1527](https://github.com/fluojs/fluo/pull/1527) [`0b0bb10`](https://github.com/fluojs/fluo/commit/0b0bb10f2efa206e6c71cd5cf88ea0f28685b5e2) Thanks [@ayden94](https://github.com/ayden94)! - Refresh `fluo new` starter dependency pins to the latest published beta versions of the generated `@fluojs/*` packages.

## 1.0.0-beta.3

### Minor Changes

- [#1525](https://github.com/fluojs/fluo/pull/1525) [`922fa87`](https://github.com/fluojs/fluo/commit/922fa87998ecc4c3c4b94dffb921439171663460) Thanks [@ayden94](https://github.com/ayden94)! - Update the CLI self-update flow to reuse the package manager that owns the current global install instead of always invoking pnpm.

## 1.0.0-beta.2

### Minor Changes

- [#1285](https://github.com/fluojs/fluo/pull/1285) [`185487f`](https://github.com/fluojs/fluo/commit/185487f01a8aaa0fe723b536f6bcaa2ab75cd84f) Thanks [@ayden94](https://github.com/ayden94)! - Expand CLI automation outputs for generation, inspection, migration, scaffolding, and generator metadata.

  Expose Studio-owned snapshot-to-Mermaid rendering helpers and platform snapshot types.

  Refresh the published Fastify adapter dependency metadata to fastify@^5.8.5.

### Patch Changes

- Updated dependencies [[`185487f`](https://github.com/fluojs/fluo/commit/185487f01a8aaa0fe723b536f6bcaa2ab75cd84f)]:
  - @fluojs/studio@1.0.0-beta.2
