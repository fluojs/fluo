---
"@fluojs/di": patch
---

Fix DI override cache invalidation for already-materialized request-scope children and make batched provider registration/override validation atomic so invalid later providers cannot leave partial graph mutations.
