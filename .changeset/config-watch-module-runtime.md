---
"@fluojs/config": patch
---

Implement `ConfigModule.forRoot({ watch: true })` watcher activation so documented watch reloads update the injected `ConfigService` instance during application runtime.
