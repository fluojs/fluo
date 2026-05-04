---
"@fluojs/cli": patch
---

Update generated `fluo new` starters to import `HealthModule` directly from `@fluojs/runtime`, call `HealthModule.forRoot()`, and omit explicit metadata symbol setup from the greeting controller scaffold.
