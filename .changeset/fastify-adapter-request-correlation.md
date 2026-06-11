---
"@fluojs/platform-fastify": patch
---

Harden Fastify request correlation and raw-body capture by honoring `x-correlation-id` as the request id fallback on native and wildcard paths, preserving raw-body byte chunks without UTF-8 re-encoding, and documenting direct multipart option configuration.
