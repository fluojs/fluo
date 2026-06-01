---
"@fluojs/microservices": patch
---

Defer TCP `node:net` loading until listen or outbound socket construction paths and preserve transport cleanup when closing after failed in-flight listen attempts.
