---
"@fluojs/config": patch
---

Defer Node-only env-file loading dependencies so importing the root config package, or using explicit in-memory `loadConfig(...)` inputs, does not eagerly resolve Node filesystem, path, crypto, cwd, dotenv, or dotenv-expand dependencies. Env-file loading keeps the documented dotenv-compatible parser and variable expansion behavior through package-local synchronous coverage, including dotenv-expand-compatible `${VAR:-fallback}` and `${VAR-fallback}` default interpolation, and empty `loadConfig({})` / `ConfigModule.forRoot()` calls continue loading the default `<cwd>/.env` file.

Patch note: correct the published package engine/support contract to Node.js 20.16.0 or newer because env-file/default `.env`/watch execution paths require `process.getBuiltinModule(...)`; direct filesystem/path/crypto lookup failures still fall back through `node:module` when that host boundary is available. Root package imports and explicit in-memory `loadConfig(...)` inputs remain lazy and safe because they do not eagerly resolve Node filesystem, path, crypto, cwd, dotenv, or dotenv-expand dependencies.
