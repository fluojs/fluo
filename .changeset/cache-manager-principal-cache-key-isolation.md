---
"@fluojs/cache-manager": patch
---

Default HTTP cache keys now encode the request path and principal resolver scope so entries remain separate across request targets and principal scopes. In built-in `route` and `route+query` keys, `%` becomes `%25` and `|` becomes `%7C` in these components; the path also encodes `?` as `%3F`. Query components retain their existing URI encoding.

Without a custom principal resolver, authenticated principals with an omitted issuer now use the suffix `|principal:<URI-encoded subject>` instead of `|principal:unknown:<URI-encoded subject>`. Explicit issuer values, including `unknown` and the empty string, retain the suffix `|principal:<URI-encoded issuer>:<URI-encoded subject>`.

Literal eviction keys for changed paths, scopes, or issuer-less principals must use the new format. Other keys retain their existing form when the path contains none of `%`, `|`, and `?` and the resolver scope contains neither `%` nor `|`. Custom `httpKeyStrategy` functions and explicit `@CacheKey` values are unchanged.
