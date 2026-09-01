---
'@fluojs/runtime': minor
'@fluojs/platform-express': minor
'@fluojs/platform-fastify': minor
---

Add portable `parseMultipartStream(...)` multipart consumption with typed field/file parts, bounded streaming limits, cancellation propagation, eager single-consumer protection, deterministic source cleanup, and Node.js/Express/Fastify/Web application opt-in through `multipart.strategy: 'stream'`. Buffered `parseMultipart(...)` keeps its legacy field/header acceptance defaults unless those limits are explicitly configured, so existing buffered consumers need no migration. Stream consumers must consume or return their route-owned iterator so active request resources are released.
