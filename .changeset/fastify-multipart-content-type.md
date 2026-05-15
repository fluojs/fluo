---
"@fluojs/platform-fastify": patch
---

Treat multipart content-type media values case-insensitively before raw-body capture so Fastify skips rawBody for mixed-case `Multipart/Form-Data` requests.
