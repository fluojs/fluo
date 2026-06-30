---
"@fluojs/platform-fastify": patch
"@fluojs/http": patch
---

Harden the Fastify adapter lifecycle so shutdown cancels retrying startup before later binds can occur, refresh native route descriptor handoffs across adapter reuse, let explicit OPTIONS routes run instead of being mistaken for CORS preflight requests, and remove the adapter-local runtime-specific FrameworkRequest file type augmentation.
