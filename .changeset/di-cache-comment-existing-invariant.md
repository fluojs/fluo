---
"@fluojs/di": patch
---

Correct the internal `cacheFor()` documentation shipped in `dist/container.d.ts`: `register()` rejects singleton-scope providers on request-scope containers with `ScopeMismatchError`, so a request-local singleton cache entry is reachable only through `container.override()` of an already-visible token. The unreachable alias branch in provider instantiation now throws `InvariantError` instead of starting a fresh resolution that would drop cycle-detection state. Alias resolution behavior is unchanged.
