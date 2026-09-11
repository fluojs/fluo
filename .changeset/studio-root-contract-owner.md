---
"@fluojs/studio": patch
---

Move Studio parsing, filtering, Mermaid, and live-contract imports to the canonical `@fluojs/studio` root export. The `@fluojs/studio/contracts` subpath is removed: replace existing imports with `@fluojs/studio`. New persisted inspect artifacts should use `fluo inspect <module-path> --report --output <path>`; raw snapshots and timing artifact readers remain supported for compatibility.
