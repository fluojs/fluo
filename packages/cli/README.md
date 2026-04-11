# @fluojs/cli

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

The canonical CLI for fluo — bootstrap new applications, generate components, and migrate from legacy frameworks.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API Overview](#public-api-overview)
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

## When to Use

- **Bootstrapping**: When starting a new project with a standard, verifiable structure.
- **Generation**: To create modules, controllers, services, and repositories with consistent naming and automatic wiring.
- **Migration**: When moving an existing NestJS application to fluo's standard decorator model.
- **Inspection**: To visualize the runtime dependency graph and diagnose platform-level issues.

## Quick Start

### 1. Create a new project
Scaffold a complete starter application in seconds.

```bash
fluo new my-app
cd my-app
pnpm dev
```

The default starter remains the Node.js + Fastify HTTP application baseline. `fluo new` now also ships first-class Express and raw Node.js HTTP application starters on the same Node-oriented install/build story:

```bash
fluo new my-app --shape application --transport http --runtime node --platform fastify
fluo new my-express-app --shape application --transport http --runtime node --platform express
fluo new my-node-app --shape application --transport http --runtime node --platform nodejs
```

`fluo new` also exposes a first-class microservice starter path. The runnable starter currently emits the TCP transport while the CLI validates the documented microservice transport families separately from package-manager choice:

```bash
fluo new my-microservice --shape microservice --transport tcp --runtime node --platform none
```

The v2 matrix also includes a mixed single-package starter: one Fastify HTTP app with an attached TCP microservice in the same generated project.

```bash
fluo new my-mixed-app --shape mixed --transport tcp --runtime node --platform fastify
```

When `fluo new` runs in an interactive TTY, the v2 wizard now layers on top of the same flags/config model instead of replacing it. The wizard asks for the project name, shape-first branch (`application` -> runtime + HTTP platform, `microservice` -> transport), the maintained tooling preset, package-manager choice, whether to install dependencies immediately, and whether to initialize a git repository. Non-interactive flags and programmatic `runNewCommand(...)` calls still stay first-class paths with the same resolved defaults.

For a docs-level table that separates the shipped Fastify/Express/raw Node.js starters from the broader Bun/Deno/Cloudflare adapter ecosystem, see the [fluo new support matrix](../../docs/reference/fluo-new-support-matrix.md).

### 2. Generate a feature
Add a new resource with a controller and service, automatically wired into the module.

```bash
fluo generate module users
fluo generate controller users
fluo generate service users
```

## Common Patterns

### NestJS to fluo Migration
Run safe, first-phase codemods to align your codebase with TC39 standard decorators.

```bash
# Preview changes (dry-run)
fluo migrate ./src

# Apply transformations
fluo migrate ./src --apply
```

**Key Transformations:**
- Rewrites imports from `@nestjs/common` to `@fluojs/core` or `@fluojs/http`.
- Removes `@Injectable()` and maps scopes to `@Scope()`.
- Updates `tsconfig.json` to disable `experimentalDecorators` and rewrites `baseUrl`-backed path aliases to TS6-safe `paths` entries.

### Runtime Inspection
Visualize your application structure and troubleshoot initialization issues.

```bash
# Export dependency graph as Mermaid
fluo inspect ./src/app.module.ts --mermaid

# Export snapshot for @fluojs/studio
fluo inspect ./src/app.module.ts --json > snapshot.json
```

## Public API Overview

The package can be used programmatically to trigger CLI actions from within other tools.

| Export | Description |
|---|---|
| `runCli(argv?, options?)` | Main entry point to execute any CLI command. |
| `runNewCommand(argv, options?)` | Programmatic access to the project scaffolding logic. |
| `GeneratorKind` | Union type of all supported generator types (e.g., `'controller'`, `'service'`). |

## Related Packages

- **[@fluojs/runtime](../runtime/README.md)**: The underlying engine used for inspection and bootstrap.
- **[@fluojs/studio](../studio/README.md)**: The web-based UI for visualizing `inspect --json` exports.
- **[@fluojs/testing](../testing/README.md)**: Used by generated test templates for integration and E2E testing.
- **[Canonical Runtime Package Matrix](../../docs/reference/package-surface.md)**: The source of truth for official runtime/package combinations.

## Example Sources

- [cli.ts](./src/cli.ts) - Command dispatcher and argument parsing.
- [commands/new.ts](./src/commands/new.ts) - Project scaffolding implementation.
- [generators/](./src/generators/) - Template-based file generation logic.
- [transforms/](./src/transforms/) - Migration codemod implementations.
