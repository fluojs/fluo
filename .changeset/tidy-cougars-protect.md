---
"@fluojs/config": patch
---

Defer Node-only env-file loading dependencies so importing the root config package, or using in-memory `loadConfig(...)` inputs, does not eagerly resolve Node filesystem, path, crypto, cwd, dotenv, or dotenv-expand dependencies. Env-file loading and watch mode now require Node.js 20.16.0 or newer for lazy builtin resolution through `process.getBuiltinModule(...)`.
