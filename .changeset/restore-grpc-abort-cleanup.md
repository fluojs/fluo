---
"@fluojs/microservices": patch
---

Restore gRPC `AbortSignal` listener cleanup when server and bidirectional streams end or error before reader iteration, and keep client, server, and bidirectional cleanup one-shot across terminal and early-return races.

Migration: no API or configuration changes are required. Existing consumers can keep their current stream usage and rely on abort listeners being detached on every terminal or reader-return path.
