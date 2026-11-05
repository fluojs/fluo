---
"@fluojs/core": minor
"@fluojs/runtime": patch
"@fluojs/cqrs": patch
"@fluojs/cron": patch
"@fluojs/discord": patch
"@fluojs/drizzle": patch
"@fluojs/email": patch
"@fluojs/event-bus": patch
"@fluojs/graphql": patch
"@fluojs/metrics": patch
"@fluojs/microservices": patch
"@fluojs/mongoose": patch
"@fluojs/passport": patch
"@fluojs/queue": patch
"@fluojs/redis": patch
"@fluojs/slack": patch
"@fluojs/socket.io": patch
"@fluojs/websockets": patch
---

Move the shared provider lifecycle hook contracts to `@fluojs/core`. New code should import the five hook types from core; existing `@fluojs/runtime` type imports remain compatible through direct re-exports.

The sixteen consumer packages listed above now reference core-owned lifecycle types in their shipped declarations. Hook signatures, execution order, signal delivery, failure cleanup, and resource ownership remain unchanged. Runtime continues to execute the hooks.

The JWT change only updates a test import and does not require a release. NestJS `beforeApplicationShutdown` remains unsupported.
