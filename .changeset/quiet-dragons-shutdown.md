---
"@fluojs/runtime": patch
"@fluojs/platform-nodejs": patch
---

Keep root runtime bootstrap defaults transport-neutral while preserving Node-specific logger behavior on `@fluojs/runtime/node`, and add regression coverage for documented Node shutdown and lifecycle failure contracts.
