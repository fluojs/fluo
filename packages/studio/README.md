# @konekti/studio

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

File-first shared platform snapshot viewer for Konekti runtime exports.

## See also

- `../cli/README.md`
- `../../docs/concepts/platform-consistency-design.md`
- `../../docs/concepts/observability.md`
- `../../docs/getting-started/first-feature-path.md`

## What it does

- Loads JSON files exported by `konekti inspect --json`
- Consumes the shared runtime `PlatformShellSnapshot` + `PlatformDiagnosticIssue` schema directly
- Renders platform component dependency chains and Mermaid output from snapshot data
- Shows component readiness/health/ownership/details with dependency links
- Displays diagnostics issues with `fixHint` and `dependsOn` as first-class fields
- Supports search + component readiness filter + diagnostics severity filter
- Displays bootstrap timing when timing payload is present
- Provides copy/download helpers for loaded JSON and Mermaid output

## Inspect -> Studio workflow

`@konekti/studio` does not crawl a running app directly. The canonical path is file-first:

1. Export a runtime snapshot from the app you want to inspect.
2. Open Studio locally.
3. Load the exported JSON snapshot (and optional timing JSON) into the viewer.

Example:

```bash
konekti inspect ./src/app.module.mjs --json > ./tmp/platform-snapshot.json
konekti inspect ./src/app.module.mjs --timing > ./tmp/platform-timing.json
pnpm --dir packages/studio dev
```

In Studio, load the JSON exported by `--json`. If you also exported `--timing`, load that file as the optional timing payload.

## What to inspect first

When you open a snapshot, start with these checks:

- overall readiness and health
- component dependency chains
- diagnostics with `fixHint` and `dependsOn`
- ownership details for external resources
- Mermaid output when you need a copyable dependency graph

## Run

```bash
pnpm --dir packages/studio dev
```

Build:

```bash
pnpm --dir packages/studio build
```
