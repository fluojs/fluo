# @fluojs/cli

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

The canonical CLI for fluo — bootstrap new applications, generate components, export runtime inspection data, and run code transforms.

## Table of Contents

- [Installation](#installation)
- [Version Inspection](#version-inspection)
- [Update Checks](#update-checks)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add -g @fluojs/cli
```

Or run directly without installation:

```bash
pnpm dlx @fluojs/cli new my-app
```

## Release Contract

- `@fluojs/cli` is a public package in the intended publish surface.
- The supported install paths are the global package (`npm install -g @fluojs/cli`, `pnpm add -g @fluojs/cli`, `bun add -g @fluojs/cli`, or `yarn global add @fluojs/cli`) and the no-install runner (`pnpm dlx @fluojs/cli ...`).
- The published `fluo` bin is backed by the dist-built CLI entrypoint declared in `package.json`.

## Version Inspection

Check the installed CLI version without triggering the interactive update check:

```bash
fluo version
fluo --version
fluo -v
```

## Update Checks

When `fluo` runs in an interactive TTY, it checks the public npm `latest` dist-tag for `@fluojs/cli` using a local cache so every invocation does not hit the registry. If a newer version is available, the CLI asks whether to install it. Declining continues the current command with the installed version; accepting updates the global CLI with the package manager that appears to own the current installation (`npm install -g`, `pnpm add -g`, `bun add -g`, or `yarn global add`) and then restarts `fluo` with the same arguments under the updated binary. If the installer cannot be inferred, the CLI falls back to `npm install -g @fluojs/cli@<latest>` because npm owns the default Node.js global installation path.

`fluo new` and its `fluo create` alias attempt a fresh interactive latest-version check before scaffolding, even when the normal update-check cache is still fresh. This keeps first-run project creation aligned with newly published starter behavior, while day-to-day commands such as `fluo dev`, `fluo build`, `fluo generate`, and `fluo inspect` continue to reuse the cached latest-version result until the normal TTL expires.

The update check is skipped in CI, non-TTY output, npm-script contexts, rerun-after-update contexts, registry/network failures, and explicit opt-out paths. Use `--no-update-check` (or the compatibility alias `--no-update-notifier`) for one invocation, or set `FLUO_NO_UPDATE_CHECK=1` when automation must never prompt.

## When to Use

- **Bootstrapping**: When starting a new project with a standard, verifiable structure.
- **Generation**: To create modules, controllers, services, and repositories with consistent naming and automatic wiring.
- **Code transforms**: When aligning an existing codebase with fluo's standard decorator model.
- **Inspection**: To export runtime snapshot data and delegate graph viewing or rendering to Studio-owned helpers.

## Quick Start

### 1. Create a new project
Scaffold a complete starter application in seconds.

```bash
fluo new my-app
cd my-app
pnpm dev
```

`fluo create` is an alias for `fluo new`. Use `fluo version`, `fluo help <command>`, `fluo doctor`/`fluo info`/`fluo analyze`, `fluo add`, and `fluo upgrade` for version checks, command help, diagnostics, first-party package shortcuts, and upgrade guidance.

Generated Node.js `dev`, `build`, and `start` package scripts delegate to `fluo dev`, `fluo build`, and `fluo start`. The CLI owns the Node-oriented lifecycle command, prepends the project-local `node_modules/.bin` when invoking local toolchain binaries, and defaults `NODE_ENV` to `development` for `dev` and `production` for `build`/`start` when the caller has not set it explicitly. Bun, Deno, and Workers generated `dev` scripts keep the same `fluo dev` abstraction but default to Bun, Deno, or Wrangler native watch loops to reduce Node-supervised dev processes; use `fluo dev --runner fluo` (or `FLUO_DEV_RUNNER=fluo`) when you need the fluo-owned restart boundary for its debounce/hash reporter contract. Their production/deployment scripts are runtime-native: Bun uses `bun build ./src/main.ts --outdir ./dist --target bun` and `bun dist/main.js`, Deno uses `deno compile --allow-env --allow-net --output dist/app src/main.ts` and `./dist/app`, and Workers exposes Wrangler `preview`/`deploy` scripts instead of `start`. By default, `fluo dev` and `fluo start` show app logs only (application stdout/stderr) so the lifecycle output shape is unified where the CLI owns the process boundary. Use `--reporter pretty` when you want concise fluo-branded lifecycle status and `app │`-prefixed application stdout/stderr, and use `--verbose` (or `FLUO_VERBOSE=1`) when you need raw runtime/tooling watcher output for debugging.

Generated starters set their `@fluojs/cli` `devDependency` from the generator CLI package version that created the project, so lifecycle scripts such as `pnpm dev`, `pnpm build`, and `pnpm start` keep using the same CLI behavior that scaffolded the starter instead of a stale hard-coded range.

Generated non-Deno starter `vite.config.ts` files import `fluoDecoratorsPlugin()` from `@fluojs/vite`, so decorator transform updates ship through the maintained Vite package instead of being copied inline into every new project.

Generated non-Deno HTTP starters use a TDD-first Vitest layout: fast greeting unit tests and `greeting.slice.test.ts` stay colocated under `src/greeting/`, app dispatch tests stay in `src/app.test.ts`, and the default e2e-style request-pipeline tests live in `test/app.e2e.test.ts` with `createTestApp({ rootModule })` plus `app.request(...).send()`. The generated `vitest.config.ts` includes both `src/**/*.test.ts` and `test/**/*.test.ts`, while generated package scripts expose `test`, `test:watch`, `test:cov`, and `test:e2e`; existing `src/app.e2e.test.ts` tests can move to `test/app.e2e.test.ts` without changing the request helper.

For generated Node.js application projects, `fluo dev` runs through a fluo-owned restart boundary by default. The runner watches source and common config inputs, debounces atomic-save bursts, hashes file content before restarting, loads `.env` for each Node app child process it spawns, and ignores noisy output/cache paths such as `node_modules`, `dist`, `.git`, `.fluo`, coverage, cache folders, and editor swap files. Pressing Ctrl+S without changing file content should not restart the app. Planned restarts and terminal shutdown first send `SIGTERM` to the current app child, then force-kill it after a bounded grace period so a non-cooperative child cannot hang the restart supervisor indefinitely. On terminal app child exit or crash outside a planned restart, the runner closes watchers, clears the pending restart timer and paths, unregisters its `SIGINT`/`SIGTERM` handlers, and exits with the child terminal code. This is full-process restart-on-watch, not module-level HMR; config watch reloads are a separate in-process config concern, and future HMR work must document which modules can be safely hot-swapped. Use `fluo dev --raw-watch` or `FLUO_DEV_RAW_WATCH=1` when you need the runtime-native Node watcher for debugging. Generated Bun/Deno/Workers projects delegate watch/reload behavior to `bun --watch`, `deno run --watch`, or `wrangler dev` by default; use `fluo dev --runner fluo` or `FLUO_DEV_RUNNER=fluo` when those projects should return to the fluo-owned restart runner, and use `FLUO_DEV_WATCH_IGNORE=path,pattern` to add extra ignored paths for that runner.

`fluo new` supports Node.js + Fastify, Express, and raw Node.js HTTP application starters on the same Node-oriented install/build flow:

```bash
fluo new my-app --shape application --transport http --runtime node --platform fastify
fluo new my-express-app --shape application --transport http --runtime node --platform express
fluo new my-node-app --shape application --transport http --runtime node --platform nodejs
```

The application matrix also includes runtime-native Bun, Deno, and Cloudflare Workers starters with runtime-specific entrypoints, scripts, and dependency sets:

```bash
fluo new my-bun-app --shape application --transport http --runtime bun --platform bun
fluo new my-deno-app --shape application --transport http --runtime deno --platform deno
fluo new my-worker-app --shape application --transport http --runtime cloudflare-workers --platform cloudflare-workers
```

`fluo new` also exposes microservice starter paths. TCP is the default when you omit `--transport`, and the starter matrix includes runnable Redis Streams, NATS, Kafka, RabbitMQ, MQTT, and gRPC variants with transport-specific dependencies, env templates, and entrypoints:

```bash
fluo new my-microservice --shape microservice --transport tcp --runtime node --platform none
fluo new my-redis-streams-service --shape microservice --transport redis-streams --runtime node --platform none
fluo new my-nats-service --shape microservice --transport nats --runtime node --platform none
fluo new my-kafka-service --shape microservice --transport kafka --runtime node --platform none
fluo new my-rabbitmq-service --shape microservice --transport rabbitmq --runtime node --platform none
fluo new my-mqtt-service --shape microservice --transport mqtt --runtime node --platform none
fluo new my-grpc-service --shape microservice --transport grpc --runtime node --platform none
```

Supported `--shape microservice --transport` starter values are exactly `tcp`, `redis-streams`, `nats`, `kafka`, `rabbitmq`, `mqtt`, and `grpc`. Use `redis-streams` for the maintained Redis-backed starter, or add `@fluojs/redis` manually after scaffolding when you need broader Redis integration patterns.

The NATS/Kafka/RabbitMQ starter contracts stay explicit about external brokers and caller-owned client libraries. Generated projects wire `nats` + `JSONCodec()`, `kafkajs` producer/consumer collaborators, and `amqplib` publisher/consumer collaborators directly in `src/app.ts` so the starter contract is runnable without pretending the base fluo packages hide those dependencies. Those broker clients are created lazily by the generated transport wrapper when the Fluo lifecycle starts listening, sends, or emits; importing `src/app.ts` for `fluo inspect`, tests, or static tooling does not connect to a broker or open external resources before the application lifecycle owns teardown.

The starter matrix also includes a mixed single-package starter: one Fastify HTTP app with an attached TCP microservice in the same generated project.

```bash
fluo new my-mixed-app --shape mixed --transport tcp --runtime node --platform fastify
```

When `fluo new` runs in an interactive TTY, the wizard uses the same flags/config model. It asks for the project name, shape-first branch (`application` -> runtime + HTTP platform, `microservice` -> transport), the maintained tooling preset, package-manager choice, whether to install dependencies immediately, and whether to initialize a git repository. Non-interactive flags and programmatic `runNewCommand(...)` calls use the same resolved defaults.

Use `--print-plan` when you want to preview the fully resolved starter without side effects:

```bash
fluo new my-app --shape application --runtime node --platform fastify --print-plan
fluo new my-service --shape microservice --transport tcp --print-plan
fluo new my-mixed-app --shape mixed --print-plan
```

Plan preview mode resolves the same project name, shape, runtime, platform, transport, tooling preset, package manager, install choice, and git choice as a real scaffold. It prints the selected starter recipe and dependency sets, then exits without creating files, installing dependencies, or initializing a git repository.

For a docs-level table that separates the shipped starter matrix (Node.js Fastify/Express/raw Node.js HTTP, Bun, Deno, Cloudflare Workers, TCP/Redis Streams/NATS/Kafka/RabbitMQ/MQTT/gRPC microservices, plus mixed) from the remaining broader adapter ecosystem, see the [fluo new support matrix](../../docs/reference/fluo-new-support-matrix.md). Package-level integrations such as `@fluojs/redis` remain part of the broader ecosystem, but they are not extra `fluo new --transport` starter flags.

### 2. Generate a feature
Generate a feature slice; some schematics auto-register in the module, while others are files-only and must be wired manually.

```bash
fluo generate module users
fluo generate module users --with-test
fluo generate resource users
fluo generate resource users --with-slice-test
fluo generate e2e users
fluo generate controller users
fluo generate service users
fluo generate request-dto users CreateUser
fluo generate service users --dry-run
```

Supported generator kinds and aliases are `controller`/`co`, `e2e`, `guard`/`gu`, `interceptor`/`in`, `middleware`/`mi`, `module`/`mo`, `repo`/`repository`, `request-dto`/`req`, `resource`/`resrc`, `response-dto`/`res`, and `service`/`s`.

Auto-registered generators are `controller`, `service`, `repo`, `guard`, `interceptor`, and `middleware`. Files-only generators are `e2e`, `module`, `request-dto`, `response-dto`, and `resource`.

`fluo generate module <name> --with-test` adds a `*.slice.test.ts` that compiles the authored module with `createTestingModule({ rootModule })`. `fluo generate resource <name>` creates a complete feature slice with a module, controller, service, repository, request DTO, response DTO, and tests; add `--with-slice-test` to include a resource-level slice test that demonstrates provider override and service resolution. It does not wire the resource module into a parent module automatically; import the generated module when you are ready to activate the slice.

`fluo generate e2e <name>` writes `test/<name>.e2e.test.ts` with `createTestApp({ rootModule: AppModule })` and imports `AppModule` from the default starter root module at `../src/app`, so request-pipeline tests live in the same app-level test area as generated starters. Use generated unit tests for direct class behavior, slice tests for DI wiring and overrides, and e2e tests for routes, guards, interceptors, DTO validation, and response writing through the virtual app.

Request DTO generation accepts the feature directory separately from the DTO class name, so multiple input contracts such as `CreateUser` and `UpdateUser` can live inside the same `src/users/` slice.

Add `--dry-run` to preview the same target resolution, skipped or overwritten file decisions, module auto-registration plan, files-only wiring status, and next-step hint without creating directories, writing files, or updating modules. `--force` still changes existing-file plan entries from `SKIP` to `OVERWRITE` when content would change, and `--target-directory` scopes the preview to that source directory exactly as it does for a real run.

Generator discovery is intentionally limited to the built-in `@fluojs/cli/builtin` collection. External package-owned or app-local generator collections are deferred: `fluo generate` does not scan config files, load arbitrary packages, or execute workspace-owned collection code. This keeps generator metadata, option schemas, help output, and file-write boundaries deterministic and testable while preserving the shipped generator contract.

## Common Patterns

### Diagnostics and project scripts
Use `doctor`/`info` when you need to debug the installed CLI, npm dist-tags, update-check cache state, runtime, and project scripts:

```bash
fluo doctor
fluo info
fluo analyze
```

`fluo analyze` stays read-only and points to deeper `inspect --report` and `migrate --json` workflows. For generated Node.js projects, `fluo dev`, `fluo build`, and `fluo start` run the generated lifecycle directly with environment defaults and project-local toolchain binaries. For generated Bun, Deno, and Cloudflare Workers projects, `fluo dev` defaults to the runtime-owned watch loop while `fluo dev --runner fluo` restores the CLI-owned restart boundary; production/deployment scripts are the generated package scripts (`bun dist/main.js`, `./dist/app`, or Wrangler `preview`/`deploy`). Use `--dry-run` to preview lifecycle commands:

```bash
fluo dev --dry-run
fluo build --dry-run
fluo start --dry-run
```

`fluo dev --dry-run` also reports the watch boundary. Generated Node projects show `Watch mode: fluo-restart` by default, Node `--raw-watch` and `FLUO_DEV_RAW_WATCH=1` show `Watch mode: native-watch`, and Bun/Deno/Workers projects show `Watch mode: runtime-native-watch` by default. Use `--runner fluo` or `FLUO_DEV_RUNNER=fluo` in Bun/Deno/Workers projects to show `Watch mode: fluo-restart` and restore the fluo-owned restart runner.

Use reporter flags when you need to tune the CLI process boundary rather than runtime app logging:

```bash
# Default: child stdout/stderr only, no fluo lifecycle UI
fluo dev

# Opt-in pretty lifecycle UI + app │ prefixes
fluo dev --reporter pretty

# Raw runtime/tooling output for debugging (watcher banners, native dev UI, etc.)
fluo dev --reporter stream
fluo dev --verbose
FLUO_VERBOSE=1 fluo dev

# Suppress wrapper/tool status while keeping child stderr and failures visible
fluo build --reporter silent
```

Runtime application logs are configured separately through `ApplicationLogger`, for example `createConsoleApplicationLogger({ mode: 'minimal', level: 'warn' })` or `createJsonApplicationLogger()` from `@fluojs/runtime/node`.

Use `fluo add <package>` for first-party package installation shortcuts and `fluo upgrade` for CLI/latest-version and migration guidance:

```bash
fluo add studio --dev --dry-run
fluo upgrade
```

### Decorator Codemods
Run codemods to align your codebase with TC39 standard decorators.

```bash
# Preview changes (dry-run)
fluo migrate ./src
fluo migrate ./src --json

# Apply transformations
fluo migrate ./src --apply
fluo migrate ./src --apply --json
fluo migrate ./src --only imports,inject-params
fluo migrate ./src --skip tests
```

Use `--json` when CI jobs, dashboards, or migration reports need a stable machine-readable result. Human output remains the default. JSON mode writes only the structured report to stdout on success, while parser errors and invalid flag combinations still write their message to stderr and return exit code `1` without partial JSON output. The report includes `mode` (`dry-run` or `apply`), `dryRun`, `apply`, enabled `transforms`, `scannedFiles`, `changedFiles`, aggregate `warningCount`, and per-file metadata with `filePath`, `changed`, `appliedTransforms`, `warningCount`, and warnings including category labels and source line numbers.

**Key Transformations:**
- Rewrites imports from `@nestjs/common` to `@fluojs/core` or `@fluojs/http`.
- Rewrites bootstrap patterns and folds supported `listen(port)` calls into fluo runtime startup conventions.
- Migrates constructor parameter `@Inject(...)` usage into fluo-compatible dependency declarations.
- Removes `@Injectable()` and maps scopes to `@Scope()`.
- Migrates test templates toward `@fluojs/testing` helpers where the codemod can do so safely.
- Updates `tsconfig.json` to disable `experimentalDecorators` and rewrites `baseUrl`-backed path aliases to TS6-safe `paths` entries.

### Runtime Inspection
Export your application structure and troubleshoot initialization issues without making the CLI own graph rendering.

```bash
# Export Mermaid through the optional Studio renderer
fluo inspect ./src/app.module.ts --mermaid

# Export snapshot for @fluojs/studio
fluo inspect ./src/app.module.ts --json > snapshot.json

# Write the same JSON snapshot to a CI artifact path without shell redirection
fluo inspect ./src/app.module.ts --json --output artifacts/inspect-snapshot.json

# Include bootstrap timing next to the runtime-produced snapshot
fluo inspect ./src/app.module.ts --timing

# Emit a support triage report with summary, snapshot, diagnostics, and timing
fluo inspect ./src/app.module.ts --report --output artifacts/inspect-report.json

# Inspect a named module export; defaults to AppModule
fluo inspect ./src/app.module.ts --export AdminModule --json
```

The runtime produces the inspection snapshot. `fluo inspect` accepts generated TypeScript source modules such as `./src/app.ts` or `./src/app.module.ts` through an explicit TypeScript loader boundary, while existing `.js` and `.mjs` module paths continue to load through native Node.js ESM. `fluo inspect` serializes the snapshot as JSON by default when no output mode flag is provided, and `fluo inspect --mermaid` delegates snapshot-to-Mermaid rendering to the optional `@fluojs/studio` contract. `--export <name>` selects the module export to bootstrap and defaults to `AppModule`; `--timing` records bootstrap timing diagnostics next to the JSON snapshot output, including when `--timing` is provided without an explicit `--json` flag, and `--report` wraps the runtime-produced snapshot with a stable summary for CI/support triage. `--timing` cannot be combined with Mermaid output. `--output <path>` writes the selected inspect payload to an explicit artifact path instead of stdout; it does not make the inspected application writable or change module graph state beyond the normal bootstrap/close cycle. Install Studio in the project that runs the command when you need Mermaid output:

```bash
pnpm add -D @fluojs/studio
```

If Studio is missing, CI and other non-interactive runs fail fast with install guidance instead of prompting or running a package manager. Interactive runs may ask whether you want to install Studio, but `fluo inspect` does not run installs unless an explicit install flow is implemented and approved.

## Public API

The package can be used programmatically to trigger CLI actions from within other tools.

| Export | Description |
|---|---|
| `runCli(argv?, options?)` | Main entry point to execute any CLI command. |
| `newUsage()` | Returns the current `fluo new` usage text for help surfaces and tests. |
| `runNewCommand(argv, options?)` | Programmatic access to the project scaffolding logic. |
| `CliPromptCancelledError` | Stable sentinel that caller-supplied prompt hooks can throw to report normal cancellation. |
| `GenerateOptions` | Type for programmatic generator options. |
| `GeneratedFile` | Type describing generated file paths, content, and write status. |
| `GeneratorKind` | Union type of all supported generator types (e.g., `'controller'`, `'service'`). |
| `ModuleRegistration` | Type describing module wiring results from generator runs. |

Programmatic entry points preserve caller process ownership. `runCli(...)` and `runNewCommand(...)` return numeric exit codes instead of calling `process.exit(...)`; prompt cancellation resolves as exit code `0` through the command runner, and setup actions such as dependency installation or git initialization only run when the resolved `fluo new` options request them. Caller-supplied prompt hooks can throw `CliPromptCancelledError` from the public package entrypoint to express normal cancellation without depending on CLI-internal files.

## Related Packages

- **[@fluojs/runtime](../runtime/README.md)**: The underlying engine that produces inspection snapshots during bootstrap-safe runtime inspection.
- **[@fluojs/studio](../studio/README.md)**: The web-based UI for viewing `inspect --json` exports and the canonical renderer used by `inspect --mermaid`.
- **[@fluojs/testing](../testing/README.md)**: Used by generated test templates for integration and E2E testing.
- **[@fluojs/vite](../vite/README.md)**: Provides the generated starter Vite decorator transform plugin.
- **[Canonical Runtime Package Matrix](../../docs/reference/package-surface.md)**: The source of truth for official runtime/package combinations.

## Example Sources

- [cli.ts](./src/cli.ts) - Command dispatcher and argument parsing.
- [commands/new.ts](./src/commands/new.ts) - Project scaffolding implementation.
- [commands/inspect.ts](./src/commands/inspect.ts) - Runtime inspection export modes and Studio delegation.
- [commands/migrate.ts](./src/commands/migrate.ts) - Decorator codemods, JSON reporting, and transform filters.
- [commands/package-workflow.ts](./src/commands/package-workflow.ts) - `fluo add` and `fluo upgrade` workflows.
- [commands/scripts.ts](./src/commands/scripts.ts) - `dev`, `build`, and `start` lifecycle command boundaries.
- [update-check.ts](./src/update-check.ts) - Interactive latest-version update checks and opt-out handling.
- [new/](./src/new/) - Starter matrix resolution, prompts, and scaffold execution.
- [dev-runner/](./src/dev-runner/) - Node restart-on-watch process boundary.
- [generators/](./src/generators/) - Template-based file generation logic.
- [transforms/](./src/transforms/) - Code transformation implementations.
