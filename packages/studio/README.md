# @konekti/studio

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

File-first shared platform snapshot viewer for Konekti runtime exports.

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
pnpm add @konekti/studio
```

## When to Use

- **Visualization**: To explore your application's module graph and dependency chains.
- **Diagnostics**: To identify and fix platform-level configuration issues using guided hints.
- **Performance**: To analyze bootstrap timing and identify initialization bottlenecks.
- **Documentation**: To generate Mermaid diagrams of your application architecture.

## Quick Start

Studio consumes JSON exports from the Konekti CLI.

1. **Export a snapshot**:
   ```bash
   fluo inspect ./src/app.module.ts --json > snapshot.json
   ```

2. **Open Studio**:
   ```bash
   pnpm --dir packages/studio dev
   ```

3. **Load the file**: Drag and drop `snapshot.json` into the Studio web interface.

## Common Patterns

### Troubleshooting Initialization
Use the **Diagnostics** tab to see issues collected during the runtime bootstrap process.
- Filter by severity (Error, Warning).
- Use `fixHint` to get actionable advice on how to resolve the issue.
- View `dependsOn` to see which components are blocking the failing one.

### Exporting Architecture Diagrams
1. Navigate to the **Graph** view.
2. Select the modules or components you want to visualize.
3. Use the **Export to Mermaid** button to get a text-based diagram for your documentation.

## Public API Overview

Studio is primarily a web application, but it defines contracts for consuming platform snapshots.

| Contract | Description |
|---|---|
| `PlatformShellSnapshot` | The core data structure representing the application state. |
| `PlatformDiagnosticIssue` | Schema for reporting and fixing platform errors. |

## Related Packages

- **[@fluojs/cli](../cli/README.md)**: Provides the `inspect` command to generate Studio-compatible exports.
- **[@fluojs/runtime](../runtime/README.md)**: The engine that generates the diagnostic and snapshot data.

## Example Sources

- [main.ts](./src/main.ts) - Application entry point.
- [contracts.ts](./src/contracts.ts) - Type definitions for snapshot consumption.
