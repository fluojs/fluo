---
"@fluojs/config": patch
---

Defer Node-only env-file loading dependencies so importing the root config package does not eagerly resolve Node filesystem, path, or crypto builtins.
