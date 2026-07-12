---
'@fluojs/platform-bun': patch
---

Keep accepted Bun requests in the shutdown drain while asynchronous realtime bindings resolve, including requests that subsequently fall back to HTTP dispatch.
