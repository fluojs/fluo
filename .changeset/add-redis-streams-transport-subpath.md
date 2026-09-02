---
"@fluojs/microservices": major
---

Add the `@fluojs/microservices/redis-streams` transport subpath.

Migration: Node.js 21 support is removed; upgrade to Node.js >=22.2.0 <27 (or use Node.js >=20.19.3 <21) before installing this release. To isolate Redis Streams transport code, replace root-barrel imports with `import { RedisStreamsMicroserviceTransport } from '@fluojs/microservices/redis-streams'`; `RedisStreamsMicroserviceTransportOptions` and `RedisStreamClientLike` are exported from the same subpath.
