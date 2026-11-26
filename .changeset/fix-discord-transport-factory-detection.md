---
"@fluojs/discord": patch
---

Treat directly injected Discord transports with non-callable `create` fields as app-owned instances, restoring initialization, readiness diagnostics, and resource ownership for both synchronous and asynchronous module registration. Preserve callable factory precedence and ownership settings.
