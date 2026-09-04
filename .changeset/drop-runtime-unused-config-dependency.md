---
"@fluojs/runtime": patch
---

Drop the unused `@fluojs/config` production dependency from `@fluojs/runtime`. Runtime source never imported the config package: configuration still enters through explicit bootstrap options and injected providers, so no import path, public export, or documented runtime behavior changes.

Installing `@fluojs/runtime` no longer pulls `@fluojs/config` transitively. Applications that call `ConfigModule.forRoot(...)` or inject `ConfigService` must declare `@fluojs/config` as their own direct dependency; consumers that already list it explicitly are unaffected.
