# toolchain contract matrix

<p><strong><kbd>English</kbd></strong> <a href="./toolchain-contract-matrix.ko.md"><kbd>한국어</kbd></a></p>

## generated app baseline

| surface | contract | version / notes |
| --- | --- | --- |
| **TypeScript** | `v6.0+` | `strict: true`, `experimentalDecorators: false`, `module: esnext`, generated configs avoid deprecated `baseUrl` aliasing |
| **Babel** | `v7.26+` | Root workspace pins `@babel/core` `^7.26.10`, `@babel/plugin-proposal-decorators` `^7.28.0` with `{ version: '2023-11' }`, and `@babel/preset-typescript` `^7.27.0`. |
| **Vite** | `v6.2+` | Root workspace pins `vite` `^6.2.1` for dev bundling and build orchestration. |
| **@fluojs/vite** | `v1.0+`; Node.js `>=20.0.0` | Generated non-Deno Vite config files import `fluoDecoratorsPlugin()` from `@fluojs/vite`; the React SSR starter applies it at the server-build boundary. The plugin owns Vite application-file decorator transforms, requires Vite `>=6.2.0`, and keeps Babel peer loading lazy until an eligible transform runs. |
| **Vitest** | `v3.0+` | Root workspace pins `vitest` `^3.0.8`; package-local configs commonly use `^3.2.4`. |
| **Node.js** | `>=20.19.3` for the root workspace and Node HTTP listeners | Minimum listener baseline required for RFC `QUERY` to reach fluo dispatch. Generated Node HTTP and mixed starters use the same floor; Node microservice-only starters and the CLI process retain their independently documented tooling floors. Bun, Deno, and Cloudflare Workers adapters intentionally omit `engines.node` so their package metadata matches their non-Node runtime contracts. |

## CLI & scaffolding contracts

| goal | command | output contract |
| --- | --- | --- |
| **Project Creation (default HTTP)** | `fluo new my-app` | Generates the compatibility-baseline starter: a single-package Node.js + Fastify HTTP app. |
| **Project Creation (explicit HTTP)** | `fluo new my-app --shape application --transport http --runtime node --platform fastify` | Resolves to the same generated output as the default HTTP starter. |
| **Project Creation (React SSR + Vite)** | `fluo new my-app --starter react-vite-ssr` | Generates the fixed Node.js + Fastify HTTP React starter with explicit client/server entries, Vite manifest loading at `src/main.ts`, application-owned page rendering, direct JSX, hydration, real anchors, full-document navigation, and focused Vitest/Playwright checks. RSC, Server Functions, file routing, client route tables, prefetch, and data caches are excluded. |
| **Project Creation (microservice)** | `fluo new my-service --shape microservice --transport tcp --runtime node --platform none` | Generates the runnable single-package TCP microservice starter. `--transport redis-streams`, `--transport nats`, `--transport kafka`, `--transport rabbitmq`, `--transport mqtt`, and `--transport grpc` scaffold the other shipped starter variants with transport-specific dependency/env/proto wiring. Broader packages such as `@fluojs/redis` remain post-scaffold integration choices instead of extra `fluo new --transport` values. |
| **Project Creation (mixed)** | `fluo new my-app --shape mixed --transport tcp --runtime node --platform fastify` | Generates the mixed single-package starter: one Fastify HTTP app with an attached TCP microservice. |
| **Interactive wizard** | `fluo new` in a TTY | Selects the same `standard` or `react-vite-ssr` named starter as the non-interactive flag path. The standard branch continues through the shape-first schema; the React branch fixes Node.js + Fastify HTTP before collecting tooling, package manager, install, and git choices. |
| **CLI self-update prompt** | `fluo <command>` in an interactive TTY | Checks the cached npm `latest` dist-tag for `@fluojs/cli`; when newer, asks before running the package-manager command that appears to own the current global install (`npm install -g`, `pnpm add -g`, `bun add -g`, or `yarn global add`, with npm fallback) and reruns the same argv under the updated `fluo` binary. `fluo new` and `fluo create` bypass the fresh cache before scaffolding so first-run starter creation observes newly published CLI behavior sooner; other non-help commands keep the normal cache TTL. CI, non-TTY, npm-script, `FLUO_NO_UPDATE_CHECK=1`, `--no-update-check`, pure help/version paths, and registry failures skip the prompt. |
| **Development watch restart** | `fluo dev` in a generated application project | Uses the fluo-owned restart runner by default for Node starters. The runner debounces filesystem bursts, hashes content before restart, ignores noisy output/cache/editor paths, and keeps app-log-only output, color preservation, and restart clear/header behavior consistent. A terminal error from a primary or fallback watcher closes all watchers, clears pending restart work, removes signal handlers, terminates the app child within the existing bound, and exits with code `1`. This is restart-on-watch, not true HMR. `fluo dev --raw-watch` or `FLUO_DEV_RAW_WATCH=1` restores the runtime-native `node --watch` command for Node debugging. Bun/Deno/Workers keep the `fluo dev` abstraction but default to runtime-owned watch/reload behavior (`bun --watch src/main.ts`, `deno run --watch --allow-env --allow-net src/main.ts`, or `wrangler dev --show-interactive-dev-session=false`); Deno keeps broad env access because the generated `AppModule` snapshots application-owned values with `Deno.env.toObject()`. Use `fluo dev --runner fluo` or `FLUO_DEV_RUNNER=fluo` when those projects need the fluo-owned restart runner instead. |
| **HTTP starter testing layout** | Generated non-Deno HTTP application starters | Generates fast unit tests under `src/greeting/`, a slice/module graph test at `src/greeting/greeting.slice.test.ts`, app dispatch tests in `src/app.test.ts`, and the default e2e-style suite at `test/app.e2e.test.ts` using `createTestApp({ rootModule })` plus `app.request(...).send()`. Generated Vitest config includes both `src/**/*.test.ts` and `test/**/*.test.ts`, while supported scripts include `test`, `test:watch`, `test:cov`, and `test:e2e`. Existing `src/app.e2e.test.ts` users can move those tests to `test/app.e2e.test.ts` without changing the request helper. |
| **React starter verification** | Generated `react-vite-ssr` project | `typecheck`, `test`, `build`, and `start` cover the generated project lifecycle. `test:browser` starts the built server and verifies streamed HTML, generated manifest assets, warning-free hydration, real-anchor navigation, and full-document `router.push(...)` navigation. |
| **React page type generation** | `fluo typegen <module-path> --output <path>` | Bootstraps the selected module with runtime logs suppressed in a short-lived generation child, waits for child exit, projects authoritative compiled `HandlerDescriptor` values through `createReactPageCatalog(...)`, and atomically publishes a versioned artifact. Reports `CREATE`, `UPDATE`, or `UNCHANGED`; identical output is not rewritten. |
| **React page type check** | `fluo typegen <module-path> --output <path> --check` | Performs the same bootstrap and generation without target writes. Exact current bytes return `UNCHANGED`/`0`; missing, stale, malformed, and unsupported-version targets have dedicated diagnostics and exit codes. |
| **React page type watch** | `fluo typegen <module-path> --output <path> --watch` | Generates before readiness, recursively watches only the module directory, coalesces 100 ms change bursts, serializes regeneration, ignores its own output/temp files, preserves the last valid artifact after generation failure, and releases watchers/signals on shutdown or setup failure. |
| **React consumer testing loop** | Vitest + `createTestApp(...)` + TypeScript compile fixtures + Playwright | Covers render-policy units, direct page/missing-renderer request dispatch, typed route ids/params and stale generation, aligned and mismatched hydration, production assets, and JavaScript-disabled native form fallback. Existing fixtures compose real package seams; no React-specific testing helper is provided. |
| **Non-Node production lifecycle** | Generated Bun, Deno, and Cloudflare Workers package scripts | Bun generated projects keep `dev: fluo dev`, then build with `bun build ./src/main.ts --outdir ./dist --target bun` and start with `bun dist/main.js`. Deno generated projects keep `dev: fluo dev`, then build with `deno compile --allow-env --allow-net --output dist/app src/main.ts` and start with `./dist/app`; broad env access is compiled in because the generated `AppModule` reads the complete application-owned environment snapshot. Signal listeners require no separate Deno permission. Cloudflare Workers generated projects keep `dev: fluo dev`, build with `wrangler deploy --dry-run`, expose `preview: wrangler dev --remote --show-interactive-dev-session=false`, expose `deploy: wrangler deploy`, and intentionally omit `start` so deployment uses Wrangler's native publish flow. |
| **Resource Generation** | `fluo g <type>` | Produces consistent naming suffixes (`.service.ts`, `.controller.ts`). Request DTOs may target an explicit feature directory with `fluo g req users CreateUser`. `fluo g module User --with-test` emits `src/users/user.slice.test.ts`, `fluo g resource User --with-slice-test` emits resource-level provider override coverage in `src/users/user.slice.test.ts`, and `fluo g e2e users` emits `test/users.e2e.test.ts` with `createTestApp({ rootModule })`. |
| **Diagnostics (JSON)** | `fluo inspect <module-path> --json` | Exports runtime-produced graph, readiness, health, diagnostics, and compiled route inspection data in JSON format. Route entries contain effective path/version and parameter names, with `kind: 'react-page'` for React pages and `kind: 'http'` for ordinary handlers. JSON is also the default output mode when no output mode is selected. `--timing` may be used with or without an explicit `--json` flag to include bootstrap timing diagnostics next to the snapshot. |
| **Diagnostics (timing)** | `fluo inspect <module-path> --timing --output artifacts/inspect-with-timing.json` | Writes the default JSON snapshot plus bootstrap timing diagnostics as a `{ snapshot, timing }` artifact. Without `--output`, the same JSON envelope is written to stdout. |
| **Diagnostics report** | `fluo inspect <module-path> --report --output artifacts/inspect-report.json` | Writes a CI/support triage JSON report containing a stable summary, the runtime-produced snapshot, diagnostics, and bootstrap timing. `--output <path>` is an explicit artifact path and does not make inspection own application writes. |
| **Diagnostics (Mermaid)** | `fluo inspect <module-path> --mermaid` | Delegates snapshot-to-Mermaid rendering to the optional `@fluojs/studio` contract. The CLI loads Studio's renderer, writes the Mermaid text to stdout or `--output <path>`, and does not own graph rendering semantics. |

## React typegen artifact and process contract

Generated source starts with the current `@fluojs/react/typegen` artifact version and ends with a
completion marker. Check mode classifies a missing target before parsing, exact bytes as unchanged,
an incomplete current artifact as malformed, a different recognized version as unsupported, and a
complete current artifact with different bytes as stale. Neither check mode nor a failed generation
writes the target.

Default write, check, and watch generations co-import the application and tooling namespaces in one
short-lived child, wait for its exit, and remove parent IPC/error/exit listeners before completing.
This bounds loader and native module-graph lifetime across repeated watch runs. The explicit
programmatic `loadReactTypegenModules` override is the compatibility exception: generation remains
in the caller process and uses those supplied namespaces for TypeScript and native inputs.

| mode/result | stdout | stderr | exit code | target mutation |
| --- | --- | --- | ---: | --- |
| write `CREATE` / `UPDATE` / `UNCHANGED` | `<ACTION> <absolute-output-path>` | none | `0` | Atomic create/update; unchanged skips the write. |
| check `UNCHANGED` | `UNCHANGED <absolute-output-path>` | none | `0` | Never. |
| check `MISSING` | none | `MISSING <path>: <guidance>` | `2` | Never. |
| check `STALE` | none | `STALE <path>: <guidance>` | `3` | Never. |
| check `MALFORMED` | none | `MALFORMED <path>: <guidance>` | `4` | Never. |
| check `UNSUPPORTED_VERSION` | none | `UNSUPPORTED_VERSION <path>: <version guidance>` | `5` | Never. |
| command/setup/bootstrap/filesystem failure | none | failure message | `1` | No partial artifact is published. |
| watch ready/regeneration | initial action and any startup-buffered action, `WATCHING <module-directory>`, then actions | recoverable `ERROR <output>: <message>` | `0` on signal shutdown; `1` on watcher/command failure | The watcher is active before startup generation and readiness follows its buffered rerun. Only complete atomic generations publish; failed generations preserve the last valid file. |

A current-version check target is `MALFORMED` unless its complete body can be reproduced by the
canonical generator grammar. A complete generated artifact that differs only because its catalog is
older is `STALE`. Watch generations evaluate current native `.js` and `.mjs` dependency graphs
without adding a source scanner or another route discovery path.

## inspect artifact output contract

`fluo inspect` supports exactly one primary artifact output mode at a time: `--json`, `--mermaid`, or `--report`. `--timing` augments JSON output with bootstrap timing diagnostics and defaults to JSON when no explicit output mode is selected. `--output <path>` writes the selected payload to the requested path, creating parent directories when needed, and omits terminal output for that payload. Without `--output`, the selected payload is written to stdout so shell redirection remains valid for CI artifacts.

| mode | payload | artifact contract |
| --- | --- | --- |
| `--json` | `RuntimeInspectionSnapshot` JSON composed from the runtime platform shell and authoritative compiled HTTP descriptors. | Stable machine-readable snapshot for Studio, scripts, and support triage. `routes[]` contains route identity and parameter names only; it excludes request values, bodies, cookies, headers, and query values. With `--timing`, the payload becomes `{ snapshot, timing }`, where `timing` is versioned bootstrap timing diagnostics. |
| `--timing` | `{ snapshot, timing }` JSON envelope. | Timing augmentation for profiling bootstrap work while preserving the default snapshot contract. `--timing --output <path>` writes the snapshot-plus-timing envelope to the requested artifact path. |
| `--mermaid` | Mermaid graph text rendered by `@fluojs/studio` from the runtime snapshot. | Requires `@fluojs/studio` to be resolvable from the inspected project or CLI package. Non-interactive runs fail fast with install guidance when Studio is missing. |
| `--report` | Versioned JSON report with `summary`, a route-aware `snapshot`, `timing`, and `generatedAt`. | Intended for CI/support artifacts such as `artifacts/inspect-report.json`. The summary includes component, diagnostic, warning, and error totals plus readiness status, health status, and total timing milliseconds. |

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
| **Vite app transform** | `@fluojs/vite` | Generated `vite.config.ts` applies `fluoDecoratorsPlugin()` to application `.ts` files, skips tests/declarations/dependencies/non-TypeScript files, runs `@babel/plugin-proposal-decorators` plus `@babel/preset-typescript`, and reports missing Babel peers from the transform hook. Importing `@fluojs/vite` or creating the plugin does not load `@babel/core`. |
| **Bundle** | Vite | Bundles generated applications for the selected runtime. |
| **Validate** | `@fluojs/testing/vitest` + Vitest | Generated `vitest.config.ts` keeps `*.test.ts` and `*.spec.ts` files on the testing-specific Babel decorator transform instead of the Vite application transform. |
| **Constraint** | Replacement tools | Replacing this chain, for example with direct `esbuild` decorator handling, is outside the documented support contract. |

## related reference

- [package-surface.md](./package-surface.md)
