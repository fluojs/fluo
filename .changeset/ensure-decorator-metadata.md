---
"@fluojs/cqrs": patch
"@fluojs/cron": patch
"@fluojs/cache-manager": patch
"@fluojs/event-bus": patch
"@fluojs/graphql": patch
"@fluojs/http": patch
"@fluojs/microservices": patch
"@fluojs/openapi": patch
"@fluojs/passport": patch
"@fluojs/queue": patch
"@fluojs/serialization": patch
"@fluojs/throttler": patch
"@fluojs/validation": patch
"@fluojs/websockets": patch
---

Ensure first-party standard decorator modules install `Symbol.metadata` before decorated classes evaluate, preventing missing metadata bags in runtimes such as Bun.
