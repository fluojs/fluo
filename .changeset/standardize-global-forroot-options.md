---
"@fluojs/cache-manager": minor
"@fluojs/config": minor
"@fluojs/cqrs": minor
"@fluojs/cron": minor
"@fluojs/discord": minor
"@fluojs/drizzle": minor
"@fluojs/email": minor
"@fluojs/event-bus": minor
"@fluojs/jwt": minor
"@fluojs/microservices": minor
"@fluojs/mongoose": minor
"@fluojs/notifications": minor
"@fluojs/passport": minor
"@fluojs/prisma": minor
"@fluojs/queue": minor
"@fluojs/redis": minor
"@fluojs/slack": minor
"@fluojs/socket.io": minor
"@fluojs/throttler": minor
---

Standardize runtime module visibility options on `global?: boolean` across `forRoot` APIs, remove the legacy `isGlobal` spelling from config/cache-manager, and replace Redis named registration with `RedisModule.forRoot({ name, ... })`.
