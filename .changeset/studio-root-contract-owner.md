---
"@fluojs/studio": patch
"@fluojs/cli": patch
"@fluojs/core": patch
"@fluojs/runtime": patch
---

Canonical Studio parsing, filtering, Mermaid, and live-contract imports now use the `@fluojs/studio` root export. The `@fluojs/studio/contracts` subpath is removed; migrate its imports to `@fluojs/studio`, where the former contracts-only platform and timing types are available. Persisted inspect artifacts use `fluo inspect <module-path> --report --output <path>`; raw snapshots and timing artifact readers retain compatibility, while explicitly present malformed timing is rejected. Runtime live declarations reference the runtime-neutral `@fluojs/core/internal` seam rather than Studio. Mermaid output keeps stdout graph-only and sends bootstrap diagnostics to stderr.
