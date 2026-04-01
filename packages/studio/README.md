# @konekti/studio

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

File-first diagnostics viewer for Konekti runtime exports.

## What it does

- Loads JSON files exported by `konekti inspect --json`
- Validates diagnostics schema version compatibility (`version: 1`)
- Renders module nodes/import edges and highlights the root module
- Shows module details (imports/exports/controllers/providers)
- Supports search + provider scope/type filters + global-module filter
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
