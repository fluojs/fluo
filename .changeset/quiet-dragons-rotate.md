---
"@fluojs/jwt": minor
---

Add a durable refresh-token rotation store hook so replacement refresh tokens can be persisted atomically with consuming the previous token, and tighten JWT edge-case coverage for JWKS lookup, principal scope normalization, and typed failure codes.
