# @fluojs/studio

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

File-first shared platform snapshot viewer and canonical graph rendering provider for fluo runtime exports.

## Table of Contents

- [Installation](#installation)
- [Release Policy](#release-policy)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add @fluojs/studio
```

The published package serves two caller-facing entrypoints:

- `@fluojs/studio` / `@fluojs/studio/contracts` for the canonical snapshot parsing, filtering, and Mermaid graph rendering helpers.
- `@fluojs/studio/viewer` for the packaged browser viewer HTML entry file.

## Release Policy

- `@fluojs/studio` is part of the intended public publish surface for fluo.
- The npm install contract for Studio is `pnpm add @fluojs/studio`; local repo development still uses `pnpm --dir packages/studio dev`.
- Studio's public package surface in this release is the file-first viewer and its documented snapshot-consumption, filtering, and graph rendering contracts. Internal workspace wiring is not a supported install path.

## When to Use

- **Visualization**: To explore your application's module graph and dependency chains.
- **Diagnostics**: To identify and fix platform-level configuration issues using guided hints.
- **Performance**: To analyze bootstrap timing and identify initialization bottlenecks.
- **Documentation**: To generate Mermaid diagrams of your application architecture.

## Quick Start

Studio consumes JSON exports from the fluo CLI. Runtime produces snapshots, the CLI exports or delegates inspection data, and Studio owns the public helpers that parse, filter, view, and render those snapshots for viewer and automation callers. Supported inspect artifacts include raw snapshots, standalone timing diagnostics, snapshot-plus-timing envelopes, and report artifacts produced by `fluo inspect --report`.

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

For automation, call `renderMermaid(snapshot)` from `@fluojs/studio` or `@fluojs/studio/contracts`. The helper is the supported snapshot-to-Mermaid contract: runtime packages remain snapshot producers, and Studio handles internal dependency edges plus external dependency nodes when rendering the graph.

## Public API

Studio is primarily a web application, but the published package also exposes the documented snapshot-consumption helpers used by tooling and automation. Treat `@fluojs/studio` as the canonical owner of snapshot parsing, filtering, and Mermaid graph rendering semantics.

| Contract | Description |
|---|---|
| `PlatformShellSnapshot` | The core data structure representing the application state. |
| `PlatformDiagnosticIssue` | Schema for reporting and fixing platform errors. |
| `parseStudioPayload(rawJson)` | Validates CLI/exported JSON into the Studio snapshot/timing envelope. |
| `StudioReportArtifact` | Preserved `fluo inspect --report` artifact with summary, snapshot, and timing data for CI/support automation. |
| `applyFilters(snapshot, filter)` | Applies readiness/severity/query filters without mutating the source snapshot. |
| `renderMermaid(snapshot)` | Produces Mermaid graph text from the loaded platform graph, including internal component dependency edges and external dependency nodes. |

### Published package entrypoints

- `@fluojs/studio`: root helper barrel for snapshot parsing/filtering/rendering automation.
- `@fluojs/studio/contracts`: explicit helper subpath for tooling that wants the contract helpers directly.
- `@fluojs/studio/viewer`: packaged `dist/index.html` entrypoint for the browser viewer bundle.

## Related Packages

- **[@fluojs/cli](../cli/README.md)**: Provides the `inspect` command to generate Studio-compatible exports.
- **[@fluojs/runtime](../runtime/README.md)**: The engine that generates the diagnostic and snapshot data.

## Example Sources

- [main.ts](./src/main.ts) - Application entry point.
- [contracts.ts](./src/contracts.ts) - Type definitions for snapshot consumption.
