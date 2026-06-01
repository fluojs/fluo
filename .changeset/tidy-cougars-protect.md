---
"@fluojs/config": major
---

Defer Node-only env-file loading dependencies so importing the root config package, or using explicit in-memory `loadConfig(...)` inputs, does not eagerly resolve Node filesystem, path, crypto, cwd, dotenv, or dotenv-expand dependencies. Env-file loading keeps the documented dotenv-compatible parser and variable expansion behavior through package-local synchronous coverage, including dotenv-expand-compatible `${VAR:-fallback}` and `${VAR-fallback}` default interpolation, and empty `loadConfig({})` / `ConfigModule.forRoot()` calls continue loading the default `<cwd>/.env` file.

Migration note: the published package engine range is now Node.js 20.16.0 or newer because env-file/default `.env`/watch execution paths require `process.getBuiltinModule(...)`; direct filesystem/path/crypto lookup failures still fall back through `node:module` when that host boundary is available. Consumers on Node.js 20.0.0 through 20.15.x must upgrade Node before installing this release, or remain on the previous `@fluojs/config` major line.
