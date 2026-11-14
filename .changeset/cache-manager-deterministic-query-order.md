---
"@fluojs/cache-manager": patch
---

Make built-in `route+query` HTTP cache keys independent of process locale by sorting decoded parameter names and repeated string values in deterministic UTF-16 code-unit order before URI encoding. Reordered queries now share a key even when distinct Unicode strings compare equally under locale collation, while case, Unicode normalization forms, and repeated-value multiplicity remain distinct.

Existing mixed-case or non-ASCII query cache keys can change and cause cache misses after deployment. No legacy-key lookup or cache migration is performed.
