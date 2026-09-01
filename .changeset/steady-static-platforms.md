---
'@fluojs/platform-express': patch
'@fluojs/platform-fastify': patch
---

Preserve the public static-response compression boundary: Express and Fastify leave the `@fluojs/http`-selected representation bytes intact instead of adapter-specific re-encoding when compression is enabled.
