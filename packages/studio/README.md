# @konekti/studio

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

File-first shared platform snapshot viewer for Konekti runtime exports.

## What it does

- Loads JSON files exported by `konekti inspect --json`
- Consumes the shared runtime `PlatformShellSnapshot` + `PlatformDiagnosticIssue` schema directly
- Renders platform component dependency chains and Mermaid output from snapshot data
- Shows component readiness/health/ownership/details with dependency links
- Displays diagnostics issues with `fixHint` and `dependsOn` as first-class fields
- Supports search + component readiness filter + diagnostics severity filter
- Displays bootstrap timing when timing payload is present
- Provides copy/download helpers for loaded JSON and Mermaid output

## Run

```bash
pnpm --dir packages/studio dev
```

Build:

```bash
pnpm --dir packages/studio build
```
