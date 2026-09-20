---
"@fluojs/http": patch
"@fluojs/platform-fastify": patch
---

Preserve default security headers while allowing otherwise eligible routes to use
the lightweight dispatch path without allocating a scope solely for those headers.
Keep controller instance overrides and thrown values intact on the newly eligible path.

Avoid speculative Fastify native request/response construction for known-full
routes, and keep absent request-ID headers and unused cancellation signals lazy
on native fast requests. General middleware, cancellation, request scopes and
response semantics remain unchanged.
