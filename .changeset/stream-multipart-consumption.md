---
'@fluojs/runtime': minor
---

Add portable `parseMultipartStream(...)` multipart consumption with typed field/file parts, bounded streaming limits, cancellation propagation, eager single-consumer protection, deterministic source cleanup, and Node.js/Express/Fastify/Web application opt-in through `multipart.strategy: 'stream'`. Buffered `parseMultipart(...)` keeps its field/header acceptance defaults unless those limits are explicitly configured.
