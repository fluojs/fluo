---
'@fluojs/runtime': minor
'@fluojs/platform-express': minor
'@fluojs/platform-fastify': minor
---

Add portable `parseMultipartStream(...)` multipart consumption with typed field/file parts, bounded streaming limits, cancellation propagation, eager single-consumer protection, deterministic source cleanup, and Node.js/Express/Fastify/Web application opt-in through `multipart.strategy: 'stream'`. Buffered `parseMultipart(...)` restores valid token-form `Content-Disposition` name and filename parameters and correctly handles escaped quoted parameters while retaining its existing defaults unless limits are explicitly configured, so existing buffered consumers need no migration. Runtime route dispatch automatically returns route-owned iterators after handler completion to release active request resources; standalone `parseMultipartStream(...)` consumers must consume to completion or call `return()` themselves.
