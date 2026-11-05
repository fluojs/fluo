# Node.js Support

<p><strong><kbd>English</kbd></strong> <a href="./node-support.ko.md"><kbd>한국어</kbd></a></p>

## Support matrix

Node floors are classified by role. The 15 Node-bound public packages that are pure runtime — including [`@fluojs/platform-fastify`](../../packages/platform-fastify/README.md) — keep `engines.node: ">=24.0.0 <27"`. The Babel 8 compiler tooling packages — [`@fluojs/cli`](../../packages/cli/README.md), [`@fluojs/vite`](../../packages/vite/README.md), and [`@fluojs/platform-nextjs`](../../packages/platform-nextjs/README.md) — plus the private root workspace, the examples, and generated Node-toolchain projects raise to `engines.node: ">=24.11.0 <27"`, because Babel 8 requires Node `^22.18.0 || >=24.11.0` upstream and fluo keeps excluding Node 22. Exact Node `24.0.0` remains a supported runtime floor for packages that do not compile. Adopting Node 24 LTS is a lifecycle and support-policy decision, not a claim that a dependency or a new runtime API requires Node 24. Node 20 and Node 22 are not supported by the upcoming major release.

| Runtime | CI verification | Release role |
| --- | --- | --- |
| Exact Node `24.0.0` | Runtime-only floor lane: artifacts built under a supported compiler Node, then real public runtime entry imports with HTTP listener, dispatch, config, and shutdown behavior; no Babel 8 load and no install on 24.0.0 | Minimum supported runtime floor, not the release runtime |
| Exact Node `24.11.0` | PR: independent frozen install/fresh build and affected package tests, relevant four-starter smoke; full PR: all packages; extended: full verification and browser journeys | Minimum compiler toolchain floor for Babel 8 |
| Locked Node `24.x` | Selected primary PR verification, relevant docs and generated starter dev/production browser matrix; full PR and extended retain all primary checks | Canonical development verification and Changesets release runtime |
| Locked Node `26.x` | PR: independent frozen install/fresh build and affected package tests, relevant four-starter smoke; full PR: all packages; extended: full verification and browser journeys | Forward verification only; never publish |
| Bun, Cloudflare Workers | Their existing independent adapter/native-runtime lanes | Runtime-native deployment contracts |

The shared catalog in `tooling/ci/local-verification-manifest.json` retains 17 task definitions. Definition counts differ from profile-specific execution task counts. `tooling/ci/local-verification.mjs` freezes the plan, `tooling/ci/verification-runner.mjs` executes it, and `.github/workflows/node-verification.yml` hosts one task per invocation. Job counts for `.github/workflows/ci.yml` include plan resolution and the required `Verify` aggregate.

| Plan | Manifest definitions | Execution tasks | Expanded jobs | Secondary compatibility |
| --- | --- | --- | --- | --- |
| Full PR (`profile=pr`, `mode=full`) | 17 | 25 | 27 | Four package shards + one starter smoke task per runtime |
| Extended (`profile=extended`, `mode=full`) | 17 | 17 | 19 | One composite task with full verification per runtime |
| Scoped PR (`profile=pr`, `mode=scoped`) | 17 | Selection-dependent | Selection-dependent | Existing composite tasks when selected; no full PR shard expansion |

Only full PR plans expand the `compatibility-floor` and `compatibility-next` definitions into `compatibility-floor-1`–`compatibility-floor-4` plus `compatibility-floor-smoke`, and `compatibility-next-1`–`compatibility-next-4` plus `compatibility-next-smoke`. Each task independently runs `pnpm install --frozen-lockfile` and a fresh `pnpm build` under its secondary Node. Package tasks run with `--shard=i/4 --maxWorkers=1`, JSON/default reporters and `/evidence/<task-id>-vitest.json`. Smoke tasks run the existing locked four-starter smoke once per runtime. This means ten independent installs/builds across the secondary runtimes; primary build artifacts do not replace secondary compiler verification. Scoped PRs retain affected package tests and conditional starter smoke in the same composite task. Extended retains full typecheck, lint, `test:verify` and the full starter matrix once per secondary runtime. Workflow partitions for build, compatibility and remaining verification tasks must be disjoint and cover every planned task.

Full primary package tests retain four shards and tooling retains two. Selected apps/examples and direct Node regressions remain in `tooling-1`; an apps command with no matching suite is explicitly recorded as not applicable. `react-product`, which depends on the primary build, exclusively owns browser installation and the entire `capture tooling`, and is the required producer of the tooling domain receipt. A successful `tooling-1` cannot replace a missing product receipt. Scoped PRs select the product task exactly once only when the existing React/example selection condition holds. Capture's internal build/browser/fault/recovery order and normal deployment restoration remain intact, as does the separate `capture starters` in `starters`. The primary build supplies selected package artifacts and, when required, the runtime-floor bundle. Exact Node `24.0.0` executes that bundle without installing workspace dependencies or loading Babel.

Selected `react-product` is emitted first in the existing post-build task matrix, preserving the relative order of all other tasks and the frozen plan order. This is a matrix creation preference, not a guarantee of GitHub start times. Speed improvement remains unverified until fresh CI measurement.

This replaces the previous full three-version PR matrix with a full primary profile and two compatibility profiles. Supported package engine ranges do not change, but per-PR assurance on secondary versions is narrower: full secondary typecheck, lint, tooling, apps/examples and browser verification moves to `.github/workflows/extended-verification.yml` and the exact-source prerequisite of `.github/workflows/release.yml`. A previous scheduled success never substitutes for the publishing commit's extended verification.

`tooling/ci/environment.lock.json` pins exact versions and download checksums instead of resolving floating Node tags independently on each runner. Refresh the lock through a reviewed change when adopting newer releases. Both local and remote tasks use the same Debian Linux/arm64 image recipe, browser and native-runtime versions.

Scheduled runs report available Node 24/26 releases without changing the lock automatically. Generated starter PR checks use the four reviewed snapshots in `tooling/cli/verification-locks/`: external resolutions stay frozen, while current-source internal tarball integrity is rebound only after its dependency graph matches the snapshot. A changed graph fails with regeneration guidance. Capture replacement snapshots from real fresh installations with `captureStarterSnapshot` in `tooling/cli/starter-lockfile.mjs` and the pinned Bun YAML parser, review their dependency changes, then run the locked matrix. Standalone sandbox commands retain fresh resolution by default; the extended profile also runs a separate fresh-resolution starter matrix.

The plan job and canonical local command both execute the real Docker runner fixture on the host before task fan-out. This verifies source isolation, artifact restoration and failure evidence without recursively starting Docker fixtures inside test containers. An unavailable daemon fails this gate rather than skipping it.

Tasks reuse pnpm's integrity-checked package store, but retain separate checkouts and `node_modules` layouts. Workspace build outputs cross task boundaries only through the verified build archive. Retried jobs update canonical artifact aliases only after saving attempt-specific task evidence, so earlier failure logs and browser traces remain available.

Compatibility tasks do not share workspaces, `dist` or `node_modules`. The concurrent isolation check at the same relative `dist` path writes each task's token, waits for both ready events before release, then checks that each task sees only its own token. Fixed sleeps or coincidentally overlapping completion times do not prove isolation. The immutable image cache is keyed by the environment lock and Dockerfile recipe; cache hits still require each job's image restore/load and runtime probe. Additional tasks do not eliminate repeated image preparation, installation or build costs.

`pnpm verify:local --base-ref <sha>` runs the same PR tasks in isolated Linux/arm64
containers and records an exact-head receipt. `--plan` prints the frozen plan
without passing evidence; `--profile extended` also runs full secondary coverage.
Docker must support arm64 execution, Linux-owned writable volumes, Unix-socket
access and host-network fixture connections. Apple Silicon and GitHub
`ubuntu-24.04-arm` use native execution. Source and file-watch tests run inside
Linux volumes rather than macOS bind mounts. An unavailable environment fails;
native macOS or Linux/amd64 execution never silently replaces canonical verification.

The repeated-development PR verification budgets are 15 minutes (900 seconds)
locally and a further 15 minutes (900 seconds) on GitHub, judged separately from
completed canonical runs. The GitHub budget interval is the earliest job's
`started_at` through the required `Verify` job's `completed_at`. Retain overall
run creation-to-completion time as well. Report initial queue time and
dependency-release-to-runner wait separately without subtracting them from
user-visible overall elapsed time. Only initial provisioning of the locked
environment is classified separately. Recurring image restore/load/probe,
artifact transfer, source installation, builds, tests, evidence upload and final
aggregation remain in the repeated-execution budget.

Parallelization is intended to reduce waiting, not proof of speed or cost savings.
Additional jobs and repeated runtime builds may increase summed runner elapsed
time, which must be reported separately. Summed job elapsed is neither CPU usage
nor billed cost. Job counts or successful `--plan` output do not establish budget
compliance. For example, an actual final verdict of 17 minutes (1020 seconds)
is a FAIL against the 15-minute budget even if faster than before. A budget miss
requires the measured result and a separate owner decision before completion or
merge. Without a completed canonical local run, the local 15-minute budget is
NOT MEASURED; GitHub success or host-native checks cannot prove it. Speed
improvement remains unknown until measured. Prepared outputs may be reused only
after source and output-inventory validation; standalone preparation and tests
whose subject is a fresh build still execute their builds.

Receipts bind the source tree, base/diff, profile, catalog, environment lock,
actual runtime/browser versions, required task results and log/artifact digests.
Old host-native receipts do not prove this Linux profile. GitHub permissions,
artifact transport, queueing and external outages still require remote evidence.
Failure census reports retain failed attempts even when a later run succeeds.

Receipt identity also binds a clean Git status digest at startup, each command
boundary, and finalization. Artifact consumers use exact run/name/SHA/digest
provenance and bounded retries only for observed intermediary `403` and narrow
transient `5xx` responses; authentication, ordinary authorization, malformed
metadata, expired artifacts, and digest mismatch fail immediately. The census
queries attempt details and attempt-specific jobs, applies a strict UTC
`[since, until)` window, and records pagination/completeness limits rather than
silently treating unavailable data as success.

Full-verification package builds are transferred only within the same workflow run, commit, and Node version. The runtime-floor bundle intentionally crosses from compiler Node to exact Node `24.0.0`, while retaining the same run, commit, artifact identity, and digest checks. A tar archive preserves package `dist` directories and the CLI's generated dependency metadata, including executable permissions and symbolic links; it does not bypass public declaration fixtures or package global setup. Generated starter verification runs after the build without waiting for tests to finish. Latest `24.x` consolidates the former duplicate PR verification and runs `pnpm verify:docs` once. The aggregate gate does not treat a required job's failure, cancellation, or skip as success.

Two native tasks preserve all maintained runtime-specific checks. `native-bun` runs Bun routing/lifecycle and Drizzle using their respective locked versions. `native-web` runs every Bun/Workers portability case and both native cookie commands. Grouping does not replace a floor runtime with a newer one. Any required command failure, missing evidence, cancellation or unexpected skip blocks `Verify`.

The focused `test:node-floor` command remains available for local checks, not as a substitute for full CI verification. It covers manifest classification, all scaffold profiles, config env-file/watch behavior, the published portable runtime import, Node HTTP listeners, adapter portability, and the existing Vite compatibility seam. The required runtime-only lane executes on exact Node `24.0.0`, so CI does not substitute a later 24.x patch for the runtime floor claim.

## PR verification selection

The frozen PR plan selects changed workspace owners and transitive reverse
dependents through dependencies, devDependencies, peerDependencies and
optionalDependencies. Prerequisite builds include emitted declarations and
explicit native/starter/browser/packed-consumer edges absent from package
manifests. Packed/starter inventories and tooling declaration checks can require
all package builds without selecting unrelated package tests. Selected examples
retain the shared `examples/tsconfig.json` typecheck; filtering a workspace does
not narrow that shared compiler contract.

Prose-only changes run documentation and governance without package runtime
suites. Executable docs and enforcement are not prose. Changesets request release
checks, not a docs-site build. Unknown ownership, unresolved local graph edges,
manifest changes and global CI/build/test inputs force full verification.
`--full`, `CI_FORCE_FULL_VERIFY=1` and the `ci:full-verify` PR label explicitly
request full verification, frozen into the canonical plan. Extended verification
always selects the full suite regardless of the diff.

Build restoration authenticates the selected inventory and plan digest before
prepared output reuse. Standalone global setup retains its existing builds.
Workflow matrices, artifact production/acquisition and aggregation follow that
same plan. Only unselected groups may be skipped; a selected skipped, missing,
failed, cancelled, stale or tampered result blocks the always-running `Verify`.
Documentation execution remains eligible when the unselected build job is skipped.

## Portable package boundaries

`engines.node` is installation metadata for Node versions, not a runtime selector. npm normally warns on an incompatible version; `engine-strict` can reject installation, including transitive dependencies. It does not execute a Node version check inside a Worker or make a package portable. Bun currently does not enforce this field. Do not add both `node` and `bun` expecting an either/or runtime expression, or invent a Workers engine version: Workers deployment compatibility belongs to its host configuration.

All 46 public packages are classified below. Names in the table use the `@fluojs/` prefix.

| Installation policy | Packages | Reason |
| --- | --- | --- |
| No package-wide Node engine: shared roots (23) | `auth`, `cache-manager`, `config`, `core`, `cqrs`, `cron`, `di`, `diagnostics`, `discord`, `email`, `event-bus`, `http`, `i18n`, `notifications`, `openapi`, `persistence`, `react`, `runtime`, `serialization`, `slack`, `terminus`, `throttler`, `validation` | Shared contracts, runtime-neutral composition or explicit host-specific feature boundaries. Keep mandatory first-party dependencies free of Node installation gates. |
| No package-wide Node engine: native/mixed hosts (5) | `drizzle`, `platform-bun`, `platform-cloudflare-workers`, `socket.io`, `websockets` | Existing Bun or Workers paths must remain installable without a first-party Node gate. Drizzle supports only the documented async Bun driver path; Socket.IO supports Node/Bun, not Workers. |
| Node runtime engine `>=24.0.0 <27` (15) | `auth-http`, `graphql`, `jwt`, `metrics`, `microservices`, `mongoose`, `passport`, `platform-express`, `platform-fastify`, `platform-nodejs`, `prisma`, `queue`, `redis`, `studio`, `testing` | Retain their existing package-owned Node support contracts. Import safety or absence of eager Node imports alone does not establish a complete native-runtime contract. |
| Node compiler engine `>=24.11.0 <27` (3) | `cli`, `platform-nextjs`, `vite` | Babel-dependent Node tooling. The private root, examples and generated developer toolchains retain their existing engines. |

The 28 shared/native-host packages omit `engines.node`; they do not declare universal runtime compatibility. When running on Node, the supported runtime window remains `>=24.0.0 <27`. Optional peers, external dependencies, drivers and runtime-specific subpaths retain their own installation and execution requirements. The recursive manifest regression follows mandatory first-party dependencies only; it does not certify optional integrations or third-party runtime behavior.

For example, Workers HTTP depends on `http` → `auth`, `core`, `di`, `validation`, plus `runtime` → `diagnostics`, `persistence`. A Node gate anywhere in this shared closure would still affect a strict installer even when the Workers adapter itself omits it. Node-only tools may be installed separately under their required Node version.

References: [npm engines semantics](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#engines), [Bun installer engine handling](https://github.com/oven-sh/bun/blob/main/src/install/PackageManager/CommandLineArguments.rs), and [Workers Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).

Diagnostics root and all public subpaths are data contracts/readers without host builtins, runtime implementation, Studio UI or import-time resources. Studio remains Node `>=24.0.0 <27`; CLI remains Node `>=24.11.0 <27`. Moving declaration ownership does not narrow consumer support.

Package-wide Node metadata is not a claim about every conditional export or runtime-native adapter. Existing Bun and Workers behavior remains governed by each package's README. Config's in-memory root stays portable; env-file/default `.env` loading and watch mode are Node-only features supported on `>=24.0.0 <27`. Their existing capability guard still raises `CONFIG_RUNTIME_UNAVAILABLE` when the host cannot supply the builtin boundary. There is no new Node version check at import or feature invocation.

Generated Node HTTP (Fastify, Express, raw Node), mixed, all seven microservice transports, and React SSR + Fastify starters declare the compiler toolchain engine range `>=24.11.0 <27`, build for `node24`, use `@types/node@^24.0.0`, and generate Babel 8 dependencies with a Babel 8-compatible config. Bun engines and native build/start commands remain unchanged. Workers' existing Node engine describes local CLI/Wrangler tooling, not the deployed isolate.

## Migration

1. Before upgrading affected packages, replace Node 20/22 local installations, CI runners, and deployment hosts with latest Node 24 LTS. Use `>=24.0.0 <27` for runtime-package applications and `>=24.11.0 <27` for Babel 8 compiler toolchain hosts such as CLI-generated projects; do not use `--ignore-engines` as a migration.
2. Replace container base images such as `node:20-slim` with `node:24-slim` in both build and runtime stages. Rebuild the image and reinstall dependencies, including native addons, under the new runtime.
3. Existing generated Node projects are not rewritten by upgrading the CLI. Update their Vite server build target from `node20` to `node24`, their Node typings to `@types/node@^24.0.0`, their Babel dependencies to the Babel 8 baseline, and their `engines.node` to `>=24.11.0 <27`; refresh the lockfile with the project's selected package manager.
4. Run the application's install, build, typecheck, and tests on Node 24. Check its HTTP listener and microservice startup/shutdown, or the first React page and hydration when applicable. Keep exact `24.0.0` and latest `26.x` checks if the application advertises this complete range.
5. For non-Node deployments, retain native engine metadata and deployment commands. Upgrade only Node-hosted developer tooling. Pass explicit in-memory config maps on portable hosts instead of assuming Node env-file/watch support.

For the complete upcoming coordinated-release order (Node, packages, imports, then config/toolchain), follow the [consumer migration guide](../getting-started/migrate-node24.md). Every stable public package has explicit major intent, including config's Node-only feature support; React remains a 0.x minor. Only Changesets generates package versions and changelogs, and the maintainer owns actual release and document publication. #3169 remains the umbrella until the user-run release.
