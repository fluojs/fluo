---
"@fluojs/socket.io": patch
---

Limit failed Bun initialization rollback to resources acquired by that attempt, preserving existing host bindings when validation fails. Observe asynchronous Socket.IO close failures alongside the original initialization error and allow initialization to retry after partial binding cleanup.
