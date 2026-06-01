---
"@fluojs/config": patch
---

Defer Node-only env-file loading dependencies so importing the root config package, or using in-memory `loadConfig(...)` inputs, does not eagerly resolve Node filesystem, path, crypto, cwd, dotenv, or dotenv-expand dependencies. Env-file loading keeps the documented dotenv-compatible parser and variable expansion behavior through package-local synchronous coverage, and watch mode now requires Node.js 20.16.0 or newer for lazy builtin resolution through `process.getBuiltinModule(...)`.
