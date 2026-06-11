---
"@fluojs/http": patch
---

Preserve adapter `isAborted()` probes on dispatch request clones and keep lazy Node request context resolution isolated for overlapping promise-returning callbacks.
