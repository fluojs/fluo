# @fluojs/cli

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

The canonical CLI for fluo — bootstrap new applications, generate components, export runtime inspection data, and run code transforms.

## Table of Contents

- [Installation](#installation)
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
- The supported install paths are the global package (`pnpm add -g @fluojs/cli`) and the no-install runner (`pnpm dlx @fluojs/cli ...`).
- The published `fluo` bin is backed by the dist-built CLI entrypoint declared in `package.json`.

## Update Checks

When `fluo` runs in an interactive TTY, it checks the public npm `latest` dist-tag for `@fluojs/cli` using a local cache so every invocation does not hit the registry. If a newer version is available, the CLI asks whether to install it. Declining continues the current command with the installed version; accepting runs `pnpm add -g @fluojs/cli@<latest>` and then restarts `fluo` with the same arguments under the updated binary.

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

Supported `--shape microservice --transport` starter values are exactly `tcp`, `redis-streams`, `nats`, `kafka`, `rabbitmq`, `mqtt`, and `grpc`. Earlier docs mentioned `redis`, but that value is no longer part of the shipped starter contract; use `redis-streams` for the maintained Redis-backed starter, or add `@fluojs/redis` manually after scaffolding when you need broader Redis integration patterns.

The NATS/Kafka/RabbitMQ starter contracts stay explicit about external brokers and caller-owned client libraries. Generated projects wire `nats` + `JSONCodec()`, `kafkajs` producer/consumer collaborators, and `amqplib` publisher/consumer collaborators directly in `src/app.ts` so the starter contract is runnable without pretending the base fluo packages hide those dependencies.

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
Add a new resource with a controller and service, automatically wired into the module.

```bash
fluo generate module users
fluo generate controller users
fluo generate service users
fluo generate request-dto users CreateUser
fluo generate service users --dry-run
```

Request DTO generation accepts the feature directory separately from the DTO class name, so multiple input contracts such as `CreateUser` and `UpdateUser` can live inside the same `src/users/` slice.

Add `--dry-run` to preview the same target resolution, skipped or overwritten file decisions, module auto-registration plan, files-only wiring status, and next-step hint without creating directories, writing files, or updating modules. `--force` still changes existing-file plan entries from `SKIP` to `OVERWRITE` when content would change, and `--target-directory` scopes the preview to that source directory exactly as it does for a real run.

Generator discovery is intentionally limited to the built-in `@fluojs/cli/builtin` collection. External package-owned or app-local generator collections are deferred: `fluo generate` does not scan config files, load arbitrary packages, or execute workspace-owned collection code. This keeps generator metadata, option schemas, help output, and file-write boundaries deterministic and testable while preserving the shipped generator contract.

## Common Patterns

### Decorator Codemods
Run codemods to align your codebase with TC39 standard decorators.

```bash
# Preview changes (dry-run)
fluo migrate ./src
fluo migrate ./src --json

# Apply transformations
fluo migrate ./src --apply
fluo migrate ./src --apply --json
```

Use `--json` when CI jobs, dashboards, or migration reports need a stable machine-readable result. Human output remains the default. JSON mode writes only the structured report to stdout on success, while parser errors and invalid flag combinations still write their message to stderr and return exit code `1` without partial JSON output. The report includes `mode` (`dry-run` or `apply`), `dryRun`, `apply`, enabled `transforms`, `scannedFiles`, `changedFiles`, aggregate `warningCount`, and per-file metadata with `filePath`, `changed`, `appliedTransforms`, `warningCount`, and warnings including category labels and source line numbers.

**Key Transformations:**
- Rewrites imports from `@nestjs/common` to `@fluojs/core` or `@fluojs/http`.
- Removes `@Injectable()` and maps scopes to `@Scope()`.
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
fluo inspect ./src/app.module.ts --json --timing

# Emit a support triage report with summary, snapshot, diagnostics, and timing
fluo inspect ./src/app.module.ts --report --output artifacts/inspect-report.json
```

The runtime produces the inspection snapshot. `fluo inspect` serializes that snapshot as JSON, and `fluo inspect --mermaid` delegates snapshot-to-Mermaid rendering to the optional `@fluojs/studio` contract. `--timing` records bootstrap timing diagnostics for JSON output, and `--report` wraps the runtime-produced snapshot with a stable summary for CI/support triage. `--output <path>` writes the selected inspect payload to an explicit artifact path instead of stdout; it does not make the inspected application writable or change module graph state beyond the normal bootstrap/close cycle. Install Studio in the project that runs the command when you need Mermaid output:

```bash
pnpm add -D @fluojs/studio
```

If Studio is missing, CI and other non-interactive runs fail fast with install guidance instead of prompting or running a package manager. Interactive runs may ask whether you want to install Studio, but `fluo inspect` does not run installs unless an explicit install flow is implemented and approved.

## Public API

The package can be used programmatically to trigger CLI actions from within other tools.

| Export | Description |
|---|---|
| `runCli(argv?, options?)` | Main entry point to execute any CLI command. |
| `runNewCommand(argv, options?)` | Programmatic access to the project scaffolding logic. |
| `GeneratorKind` | Union type of all supported generator types (e.g., `'controller'`, `'service'`). |

Programmatic entry points preserve caller process ownership. `runCli(...)` and `runNewCommand(...)` return numeric exit codes instead of calling `process.exit(...)`; prompt cancellation resolves as exit code `0` through the command runner, and setup actions such as dependency installation or git initialization only run when the resolved `fluo new` options request them.

## Related Packages

- **[@fluojs/runtime](../runtime/README.md)**: The underlying engine that produces inspection snapshots during bootstrap-safe runtime inspection.
- **[@fluojs/studio](../studio/README.md)**: The web-based UI for viewing `inspect --json` exports and the canonical renderer used by `inspect --mermaid`.
- **[@fluojs/testing](../testing/README.md)**: Used by generated test templates for integration and E2E testing.
- **[Canonical Runtime Package Matrix](../../docs/reference/package-surface.md)**: The source of truth for official runtime/package combinations.

## Example Sources

- [cli.ts](./src/cli.ts) - Command dispatcher and argument parsing.
- [commands/new.ts](./src/commands/new.ts) - Project scaffolding implementation.
- [generators/](./src/generators/) - Template-based file generation logic.
- [transforms/](./src/transforms/) - Code transformation implementations.
