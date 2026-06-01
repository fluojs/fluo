---
"@fluojs/config": patch
---

Defer Node-only env-file loading dependencies so importing the root config package, or using explicit in-memory `loadConfig(...)` inputs, does not eagerly resolve Node filesystem, path, crypto, cwd, dotenv, or dotenv-expand dependencies. Env-file loading keeps the documented dotenv-compatible parser and variable expansion behavior through package-local synchronous coverage, and empty `loadConfig({})` / `ConfigModule.forRoot()` calls continue loading the default `<cwd>/.env` file. The published package engine range remains Node.js 20.0.0 or newer; env-file loading/watch execution paths require `process.getBuiltinModule(...)` and fall back through `node:module` when direct filesystem/path/crypto lookup is unavailable.
