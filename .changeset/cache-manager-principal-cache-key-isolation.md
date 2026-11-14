---
"@fluojs/cache-manager": patch
---

Default HTTP cache keys now encode the request path and principal resolver scope so principal-scoped entries remain separate from other requests. In built-in `route` and `route+query` keys, `%` becomes `%25` and `|` becomes `%7C` in these components; literal eviction keys targeting such paths or scopes must use the encoded form. Query components retain their existing URI encoding, and paths and scopes containing neither character keep their existing keys. Custom `httpKeyStrategy` functions and explicit `@CacheKey` values are unchanged.
