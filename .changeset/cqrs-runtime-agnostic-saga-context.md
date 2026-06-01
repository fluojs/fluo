---
"@fluojs/cqrs": patch
---

Remove the Node.js `node:async_hooks` root import from saga dispatch by threading an explicit runtime-agnostic CQRS dispatch context through nested command, query, event, and saga calls.
