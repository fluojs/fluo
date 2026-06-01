---
"@fluojs/jwt": patch
---

Load Node.js crypto primitives lazily so the root `@fluojs/jwt` import surface no longer pulls `node:crypto` before callers execute signing, verification, JWKS key parsing, or refresh-token generation.
