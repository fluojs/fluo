# @konekti/cli

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

The canonical CLI for Konekti — bootstrap new applications, generate components, and migrate from legacy frameworks.

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
pnpm add -g @konekti/cli
```

Or run directly without installation:

```bash
pnpm dlx @konekti/cli new my-app
```

## When to Use

- **Bootstrapping**: When starting a new project with a standard, verifiable structure.
- **Generation**: To create modules, controllers, services, and repositories with consistent naming and automatic wiring.
- **Migration**: When moving an existing NestJS application to Konekti's standard decorator model.
- **Inspection**: To visualize the runtime dependency graph and diagnose platform-level issues.

## Quick Start

### 1. Create a new project
Scaffold a complete starter application in seconds.

```bash
konekti new my-app
cd my-app
pnpm dev
```

### 2. Generate a feature
Add a new resource with a controller and service, automatically wired into the module.

```bash
konekti generate module users
konekti generate controller users
konekti generate service users
```

## Common Patterns

### NestJS to Konekti Migration
Run safe, first-phase codemods to align your codebase with TC39 standard decorators.

```bash
# Preview changes (dry-run)
konekti migrate ./src

# Apply transformations
konekti migrate ./src --apply
```

**Key Transformations:**
- Rewrites imports from `@nestjs/common` to `@konekti/core` or `@konekti/http`.
- Removes `@Injectable()` and maps scopes to `@Scope()`.
- Updates `tsconfig.json` to disable `experimentalDecorators`.

### Runtime Inspection
Visualize your application structure and troubleshoot initialization issues.

```bash
# Export dependency graph as Mermaid
konekti inspect ./src/app.module.ts --mermaid

# Export snapshot for @konekti/studio
konekti inspect ./src/app.module.ts --json > snapshot.json
```

## Public API Overview

The package can be used programmatically to trigger CLI actions from within other tools.

| Export | Description |
|---|---|
| `runCli(argv?, options?)` | Main entry point to execute any CLI command. |
| `runNewCommand(argv, options?)` | Programmatic access to the project scaffolding logic. |
| `GeneratorKind` | Union type of all supported generator types (e.g., `'controller'`, `'service'`). |

## Related Packages

- **[@konekti/runtime](../runtime/README.md)**: The underlying engine used for inspection and bootstrap.
- **[@konekti/studio](../studio/README.md)**: The web-based UI for visualizing `inspect --json` exports.
- **[@konekti/testing](../testing/README.md)**: Used by generated test templates for integration and E2E testing.

## Example Sources

- [cli.ts](./src/cli.ts) - Command dispatcher and argument parsing.
- [commands/new.ts](./src/commands/new.ts) - Project scaffolding implementation.
- [generators/](./src/generators/) - Template-based file generation logic.
- [transforms/](./src/transforms/) - Migration codemod implementations.
