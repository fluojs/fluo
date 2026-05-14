# toolchain contract matrix

<p><strong><kbd>English</kbd></strong> <a href="./toolchain-contract-matrix.ko.md"><kbd>한국어</kbd></a></p>

## generated app baseline

| surface | contract | version / notes |
| --- | --- | --- |
| **TypeScript** | `v6.0+` | `strict: true`, `experimentalDecorators: false`, `module: esnext`, generated configs avoid deprecated `baseUrl` aliasing |
| **Babel** | `v7.26+` | Root workspace pins `@babel/core` `^7.26.10` and `@babel/plugin-proposal-decorators` `^7.28.0` with `{ version: '2023-11' }`. |
| **Vite** | `v6.2+` | Root workspace pins `vite` `^6.2.1` for dev bundling and build orchestration. |
| **Vitest** | `v3.0+` | Root workspace pins `vitest` `^3.0.8`; package-local configs commonly use `^3.2.4`. |
| **Node.js** | `v20+` | Minimum supported runtime baseline declared by the root workspace and published package manifests for Node-based adapters. Bun, Deno, and Cloudflare Workers adapters intentionally omit `engines.node` so their package metadata matches their non-Node runtime contracts. |

## CLI & scaffolding contracts

| goal | command | output contract |
| --- | --- | --- |
| **Project Creation (default HTTP)** | `fluo new my-app` | Generates the compatibility-baseline starter: a single-package Node.js + Fastify HTTP app. |
| **Project Creation (explicit HTTP)** | `fluo new my-app --shape application --transport http --runtime node --platform fastify` | Resolves to the same generated output as the default HTTP starter. |
| **Project Creation (microservice)** | `fluo new my-service --shape microservice --transport tcp --runtime node --platform none` | Generates the runnable single-package TCP microservice starter. `--transport redis-streams`, `--transport nats`, `--transport kafka`, `--transport rabbitmq`, `--transport mqtt`, and `--transport grpc` scaffold the other shipped starter variants with transport-specific dependency/env/proto wiring. Broader packages such as `@fluojs/redis` remain post-scaffold integration choices instead of extra `fluo new --transport` values. |
| **Project Creation (mixed)** | `fluo new my-app --shape mixed --transport tcp --runtime node --platform fastify` | Generates the mixed single-package starter: one Fastify HTTP app with an attached TCP microservice. |
| **Interactive wizard** | `fluo new` in a TTY | Resolves onto the same shape-first schema as the non-interactive flags path: project name, shape, tooling preset, package manager, install choice, and git choice. |
| **CLI self-update prompt** | `fluo <command>` in an interactive TTY | Checks the cached npm `latest` dist-tag for `@fluojs/cli`; when newer, asks before running the package-manager command that appears to own the current global install (`npm install -g`, `pnpm add -g`, `bun add -g`, or `yarn global add`, with npm fallback) and reruns the same argv under the updated `fluo` binary. `fluo new` and `fluo create` bypass the fresh cache before scaffolding so first-run starter creation observes newly published CLI behavior sooner; other non-help commands keep the normal cache TTL. CI, non-TTY, npm-script, `FLUO_NO_UPDATE_CHECK=1`, `--no-update-check`, pure help/version paths, and registry failures skip the prompt. |
| **Development watch restart** | `fluo dev` in a generated application project | Uses the fluo-owned restart runner by default for Node starters. The runner debounces filesystem bursts, hashes content before restart, ignores noisy output/cache/editor paths, and keeps app-log-only output, color preservation, and restart clear/header behavior consistent. This is restart-on-watch, not true HMR. `fluo dev --raw-watch` or `FLUO_DEV_RAW_WATCH=1` restores the runtime-native `node --watch` command for Node debugging. Bun/Deno/Workers keep the `fluo dev` abstraction but default to runtime-owned watch/reload behavior (`bun --watch src/main.ts`, `deno run --watch --allow-env --allow-net src/main.ts`, or `wrangler dev --show-interactive-dev-session=false`); use `fluo dev --runner fluo` or `FLUO_DEV_RUNNER=fluo` when those projects need the fluo-owned restart runner instead. |
| **HTTP starter testing layout** | Generated non-Deno HTTP application starters | Generates fast unit tests under `src/greeting/`, a slice/module graph test at `src/greeting/greeting.slice.test.ts`, app dispatch tests in `src/app.test.ts`, and the default e2e-style suite at `test/app.e2e.test.ts` using `createTestApp({ rootModule })` plus `app.request(...).send()`. Generated Vitest config includes both `src/**/*.test.ts` and `test/**/*.test.ts`, while supported scripts include `test`, `test:watch`, `test:cov`, and `test:e2e`. Existing `src/app.e2e.test.ts` users can move those tests to `test/app.e2e.test.ts` without changing the request helper. |
| **Non-Node production lifecycle** | Generated Bun, Deno, and Cloudflare Workers package scripts | Bun generated projects keep `dev: fluo dev`, then build with `bun build ./src/main.ts --outdir ./dist --target bun` and start with `bun dist/main.js`. Deno generated projects keep `dev: fluo dev`, then build with `deno compile --allow-env --allow-net --output dist/app src/main.ts` and start with `./dist/app`. Cloudflare Workers generated projects keep `dev: fluo dev`, build with `wrangler deploy --dry-run`, expose `preview: wrangler dev --remote --show-interactive-dev-session=false`, expose `deploy: wrangler deploy`, and intentionally omit `start` so deployment uses Wrangler's native publish flow. |
| **Resource Generation** | `fluo g <type>` | Produces consistent naming suffixes (`.service.ts`, `.controller.ts`). Request DTOs may target an explicit feature directory with `fluo g req users CreateUser`. `fluo g module User --with-test` emits `src/users/user.slice.test.ts`, `fluo g resource User --with-slice-test` emits resource-level provider override coverage in `src/users/user.slice.test.ts`, and `fluo g e2e users` emits `test/users.e2e.test.ts` with `createTestApp({ rootModule })`. |
| **Diagnostics (JSON)** | `fluo inspect <module-path> --json` | Exports runtime-produced graph, readiness, health, and diagnostics snapshot data in JSON format. JSON is also the default output mode when no output mode is selected. `--timing` may be used with or without an explicit `--json` flag to include bootstrap timing diagnostics next to the snapshot. |
| **Diagnostics (timing)** | `fluo inspect <module-path> --timing --output artifacts/inspect-with-timing.json` | Writes the default JSON snapshot plus bootstrap timing diagnostics as a `{ snapshot, timing }` artifact. Without `--output`, the same JSON envelope is written to stdout. |
| **Diagnostics report** | `fluo inspect <module-path> --report --output artifacts/inspect-report.json` | Writes a CI/support triage JSON report containing a stable summary, the runtime-produced snapshot, diagnostics, and bootstrap timing. `--output <path>` is an explicit artifact path and does not make inspection own application writes. |
| **Diagnostics (Mermaid)** | `fluo inspect <module-path> --mermaid` | Delegates snapshot-to-Mermaid rendering to the optional `@fluojs/studio` contract. The CLI loads Studio's renderer, writes the Mermaid text to stdout or `--output <path>`, and does not own graph rendering semantics. |

## inspect artifact output contract

`fluo inspect` supports exactly one primary artifact output mode at a time: `--json`, `--mermaid`, or `--report`. `--timing` augments JSON output with bootstrap timing diagnostics and defaults to JSON when no explicit output mode is selected. `--output <path>` writes the selected payload to the requested path, creating parent directories when needed, and omits terminal output for that payload. Without `--output`, the selected payload is written to stdout so shell redirection remains valid for CI artifacts.

| mode | payload | artifact contract |
| --- | --- | --- |
| `--json` | `PlatformShellSnapshot` JSON produced by the runtime platform shell. | Stable machine-readable snapshot for Studio, scripts, and support triage. With `--timing`, the payload becomes `{ snapshot, timing }`, where `timing` is versioned bootstrap timing diagnostics. |
| `--timing` | `{ snapshot, timing }` JSON envelope. | Timing augmentation for profiling bootstrap work while preserving the default snapshot contract. `--timing --output <path>` writes the snapshot-plus-timing envelope to the requested artifact path. |
| `--mermaid` | Mermaid graph text rendered by `@fluojs/studio` from the runtime snapshot. | Requires `@fluojs/studio` to be resolvable from the inspected project or CLI package. Non-interactive runs fail fast with install guidance when Studio is missing. |
| `--report` | Versioned JSON report with `summary`, `snapshot`, `timing`, and `generatedAt`. | Intended for CI/support artifacts such as `artifacts/inspect-report.json`. The summary includes component, diagnostic, warning, and error totals plus readiness status, health status, and total timing milliseconds. |

`--timing` records bootstrap timing diagnostics next to JSON/report workflows. It is not valid with `--mermaid`, because Mermaid rendering remains a Studio-owned snapshot rendering contract rather than a timing artifact format.

## naming conventions (CLI output)

| type | suffix | example |
| --- | --- | --- |
| **Controller** | `.controller.ts` | `users.controller.ts` |
| **Service** | `.service.ts` | `users.service.ts` |
| **Repository** | `.repo.ts` | `users.repo.ts` |
| **DTO (Input)** | `.request.dto.ts` | `users/create-user.request.dto.ts` from `fluo g req users CreateUser` |
| **DTO (Output)** | `.response.dto.ts` | `user.response.dto.ts` |
| **Slice test** | `.slice.test.ts` | `users/user.slice.test.ts` from `fluo g module User --with-test` or `fluo g resource User --with-slice-test` |
| **E2E test** | `.e2e.test.ts` | `test/users.e2e.test.ts` |

## build configuration

| stage | tool | contract |
| --- | --- | --- |
| **Transform** | Babel | Applies the Stage 3 decorator transform through `@babel/plugin-proposal-decorators` with `{ version: '2023-11' }`. |
| **Bundle** | Vite | Bundles generated applications for the selected runtime. |
| **Validate** | Vitest | Runs tests against the same decorator configuration. |
| **Constraint** | Replacement tools | Replacing this chain, for example with direct `esbuild` decorator handling, is outside the documented support contract. |

## related reference

- [package-surface.md](./package-surface.md)
