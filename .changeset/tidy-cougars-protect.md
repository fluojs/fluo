---
"@fluojs/config": patch
---

Defer Node-only env-file loading dependencies so importing the root config package, or using in-memory `loadConfig(...)` inputs, does not eagerly resolve Node filesystem, path, crypto, cwd, dotenv, or dotenv-expand dependencies. Env-file loading keeps the documented dotenv-compatible parser and variable expansion behavior through package-local synchronous coverage. The published package engine range remains Node.js 20.0.0 or newer; only env-file loading and watch execution paths report a runtime guard when the host cannot provide Node.js 20.16.0+ lazy builtin resolution through `process.getBuiltinModule(...)`.
