---
"@fluojs/cli": patch
---

Preserve the CLI root entrypoint lazy-loading boundary and avoid loading the optional Studio sidecar unless `fluo dev --studio` actually starts it.
