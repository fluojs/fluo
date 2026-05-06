---
"@fluojs/terminus": patch
---

Reject blank health indicator result keys as down diagnostics and lazy-load Node filesystem access so root Terminus imports stay runtime-safe. Node-specific memory/disk indicators are also available from the `@fluojs/terminus/node` subpath.
