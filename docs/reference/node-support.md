# Node.js Support

<p><strong><kbd>English</kbd></strong> <a href="./node-support.ko.md"><kbd>한국어</kbd></a></p>

## Support matrix

Node floors are classified by role. The 32 Node-bound public packages that are pure runtime — including [`@fluojs/platform-fastify`](../../packages/platform-fastify/README.md) — keep `engines.node: ">=24.0.0 <27"`. The Babel 8 compiler tooling packages — [`@fluojs/cli`](../../packages/cli/README.md), [`@fluojs/vite`](../../packages/vite/README.md), and [`@fluojs/platform-nextjs`](../../packages/platform-nextjs/README.md) — plus the private root workspace, the examples, and generated Node-toolchain projects raise to `engines.node: ">=24.11.0 <27"`, because Babel 8 requires Node `^22.18.0 || >=24.11.0` upstream and fluo keeps excluding Node 22. Exact Node `24.0.0` remains a supported runtime floor for packages that do not compile. Adopting Node 24 LTS is a lifecycle and support-policy decision, not a claim that a dependency or a new runtime API requires Node 24. Node 20 and Node 22 are not supported by the upcoming major release.

| Runtime | CI verification | Release role |
| --- | --- | --- |
| Exact Node `24.0.0` | Runtime-only floor lane: artifacts built under a supported compiler Node, then real public runtime entry imports with HTTP listener, dispatch, config, and shutdown behavior; no Babel 8 load and no install on 24.0.0 | Minimum supported runtime floor, not the release runtime |
| Exact Node `24.11.0` | PR: frozen install, fresh build, all package tests and four-starter smoke; extended: full verification and browser journeys | Minimum compiler toolchain floor for Babel 8 |
| Locked Node `24.x` | Full primary PR verification, `pnpm verify:docs`, generated starter dev/production browser matrix | Canonical development verification and Changesets release runtime |
| Locked Node `26.x` | PR: frozen install, fresh build, all package tests and four-starter smoke; extended: full verification and browser journeys | Forward verification only; never publish |
| Bun, Deno, Cloudflare Workers | Their existing independent adapter/native-runtime lanes | Runtime-native deployment contracts |

`.github/workflows/ci.yml` expands to 18 jobs including plan resolution and the required `Verify` aggregate. Sixteen execution tasks use the shared catalog in `tooling/ci/local-verification-manifest.json` and the runner in `tooling/ci/verification-runner.mjs`; `.github/workflows/node-verification.yml` hosts one task per invocation. Primary package tests retain four shards, tooling retains two, and apps/examples run once in the first tooling shard. The primary build supplies package artifacts and the runtime-floor bundle. Exact Node `24.0.0` executes that bundle without installing workspace dependencies or loading Babel.

This replaces the previous full three-version PR matrix with a full primary profile and two compatibility profiles. Supported package engine ranges do not change, but per-PR assurance on secondary versions is narrower: full secondary typecheck, lint, tooling, apps/examples and browser verification moves to `.github/workflows/extended-verification.yml` and the exact-source prerequisite of `.github/workflows/release.yml`. A previous scheduled success never substitutes for the publishing commit's extended verification.

`tooling/ci/environment.lock.json` pins exact versions and download checksums instead of resolving floating Node tags independently on each runner. Refresh the lock through a reviewed change when adopting newer releases. Both local and remote tasks use the same Debian Linux/arm64 image recipe, browser and native-runtime versions.

Scheduled runs report available Node 24/26 releases without changing the lock automatically. Generated starter PR checks use the four reviewed snapshots in `tooling/cli/verification-locks/`: external resolutions stay frozen, while current-source internal tarball integrity is rebound only after its dependency graph matches the snapshot. A changed graph fails with regeneration guidance. Capture replacement snapshots from real fresh installations with `captureStarterSnapshot` in `tooling/cli/starter-lockfile.mjs` and the pinned Bun YAML parser, review their dependency changes, then run the locked matrix. Standalone sandbox commands retain fresh resolution by default; the extended profile also runs a separate fresh-resolution starter matrix.

The plan job and canonical local command both execute the real Docker runner fixture on the host before task fan-out. This verifies source isolation, artifact restoration and failure evidence without recursively starting Docker fixtures inside test containers. An unavailable daemon fails this gate rather than skipping it.

Tasks reuse pnpm's integrity-checked package store, but retain separate checkouts and `node_modules` layouts. Workspace build outputs cross task boundaries only through the verified build archive. Retried jobs update canonical artifact aliases only after saving attempt-specific task evidence, so earlier failure logs and browser traces remain available.

`pnpm verify:local --base-ref <sha>` runs the same PR tasks in isolated Linux/arm64
containers and records an exact-head receipt. `--plan` prints the frozen plan
without passing evidence; `--profile extended` also runs full secondary coverage.
Docker must support arm64 execution, Linux-owned writable volumes, Unix-socket
access and host-network fixture connections. Apple Silicon and GitHub
`ubuntu-24.04-arm` use native execution. Source and file-watch tests run inside
Linux volumes rather than macOS bind mounts. An unavailable environment fails;
native macOS or Linux/amd64 execution never silently replaces canonical verification.

The repeated-development PR verification budget is 15 minutes locally and a
further 15 minutes on GitHub, including source installation, builds, tests and
final aggregation. Initial provisioning of the locked environment is measured
separately; GitHub queue time is reported separately from execution. A lower job
count alone is not evidence of meeting these budgets. Prepared outputs may be
reused only after source and output-inventory validation; standalone preparation
and tests whose subject is a fresh build still execute their builds.

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

Two native tasks preserve all runtime-specific checks. `native-bun` runs Bun routing/lifecycle and Drizzle using their respective locked versions. `native-web` runs the Deno adapter, every Bun/Deno/Workers portability case, and all three native cookie commands. Grouping does not replace a floor runtime with a newer one. Any required command failure, missing evidence, cancellation or unexpected skip blocks `Verify`.

The focused `test:node-floor` command remains available for local checks, not as a substitute for full CI verification. It covers manifest classification, all scaffold profiles, config env-file/watch behavior, the published portable runtime import, Node HTTP listeners, adapter portability, and the existing Vite compatibility seam. The required runtime-only lane executes on exact Node `24.0.0`, so CI does not substitute a later 24.x patch for the runtime floor claim.

## Portable package boundaries

These nine public roots intentionally omit `engines.node`: `@fluojs/config`, `@fluojs/diagnostics`, `@fluojs/email`, `@fluojs/i18n`, `@fluojs/platform-bun`, `@fluojs/platform-cloudflare-workers`, `@fluojs/platform-deno`, `@fluojs/react`, and `@fluojs/runtime`. Do not restore engines merely to match neighboring manifests.

Diagnostics root and all public subpaths are data contracts/readers without host builtins, runtime implementation, Studio UI or import-time resources. Studio remains Node `>=24.0.0 <27`; CLI remains Node `>=24.11.0 <27`. Moving declaration ownership does not narrow consumer support.

Package-wide Node metadata is not a claim about every conditional export or runtime-native adapter. Existing Bun, Deno, and Workers behavior remains governed by each package's README. Config's in-memory root stays portable; env-file/default `.env` loading and watch mode are Node-only features supported on `>=24.0.0 <27`. Their existing capability guard still raises `CONFIG_RUNTIME_UNAVAILABLE` when the host cannot supply the builtin boundary. There is no new Node version check at import or feature invocation.

Generated Node HTTP (Fastify, Express, raw Node), mixed, all seven microservice transports, and React SSR + Fastify starters declare the compiler toolchain engine range `>=24.11.0 <27`, build for `node24`, use `@types/node@^24.0.0`, and generate Babel 8 dependencies with a Babel 8-compatible config. Bun and Deno engines and native build/start commands remain unchanged. Workers' existing Node engine describes local CLI/Wrangler tooling, not the deployed isolate.

## Migration

1. Before upgrading affected packages, replace Node 20/22 local installations, CI runners, and deployment hosts with latest Node 24 LTS. Use `>=24.0.0 <27` for runtime-package applications and `>=24.11.0 <27` for Babel 8 compiler toolchain hosts such as CLI-generated projects; do not use `--ignore-engines` as a migration.
2. Replace container base images such as `node:20-slim` with `node:24-slim` in both build and runtime stages. Rebuild the image and reinstall dependencies, including native addons, under the new runtime.
3. Existing generated Node projects are not rewritten by upgrading the CLI. Update their Vite server build target from `node20` to `node24`, their Node typings to `@types/node@^24.0.0`, their Babel dependencies to the Babel 8 baseline, and their `engines.node` to `>=24.11.0 <27`; refresh the lockfile with the project's selected package manager.
4. Run the application's install, build, typecheck, and tests on Node 24. Check its HTTP listener and microservice startup/shutdown, or the first React page and hydration when applicable. Keep exact `24.0.0` and latest `26.x` checks if the application advertises this complete range.
5. For non-Node deployments, retain native engine metadata and deployment commands. Upgrade only Node-hosted developer tooling. Pass explicit in-memory config maps on portable hosts instead of assuming Node env-file/watch support.

For the complete upcoming coordinated-release order (Node, packages, imports, then config/toolchain), follow the [consumer migration guide](../getting-started/migrate-node24.md). Every stable public package has explicit major intent, including config's Node-only feature support; React remains a 0.x minor. Only Changesets generates package versions and changelogs, and the maintainer owns actual release and document publication. #3169 remains the umbrella until the user-run release.
