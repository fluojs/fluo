---
"@fluojs/platform-fastify": patch
"@fluojs/http": patch
---

Reduce Fastify native route overhead by avoiding unnecessary host header materialization on simple native request paths while preserving adapter-snapshotted request id behavior.
