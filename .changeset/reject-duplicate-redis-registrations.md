---
'@fluojs/cache-manager': major
'@fluojs/cron': major
'@fluojs/email': major
'@fluojs/queue': major
'@fluojs/redis': major
'@fluojs/terminus': major
'@fluojs/throttler': major
---

Reject duplicate default and trimmed named `RedisModule.forRoot(...)` registration identities during bootstrap before a Redis client is created.

Migration: Register the unnamed default Redis client at most once, and give every additional Redis registration a distinct trimmed `name`. Consumers using `@fluojs/cache-manager`, `@fluojs/cron`, `@fluojs/email`, `@fluojs/queue`, `@fluojs/terminus`, or `@fluojs/throttler` with Redis must use the corresponding major release.
