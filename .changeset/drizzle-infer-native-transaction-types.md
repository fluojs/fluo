---
"@fluojs/drizzle": patch
---

Infer the native transaction handle and options from the registered Drizzle database when those type arguments are omitted. This restores cast-free libSQL and PostgreSQL registration and wrapper/facade usage, including typed dependencies in `forRootAsync` factories. Explicit type arguments and transaction runtime behavior are unchanged.
