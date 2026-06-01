---
"@fluojs/config": patch
---

Defer Node-only env-file loading dependencies so importing the root config package, or using in-memory `loadConfig(...)` inputs, does not eagerly resolve Node filesystem, path, crypto, cwd, dotenv, or dotenv-expand dependencies. Env-file loading keeps the documented dotenv-compatible parser and variable expansion behavior through package-local synchronous coverage. The published package engine range remains Node.js 20.0.0 or newer, and env-file loading/watch execution paths fall back to a Node 20.0-compatible module loader when `process.getBuiltinModule(...)` is unavailable.
