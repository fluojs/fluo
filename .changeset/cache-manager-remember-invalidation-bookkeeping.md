---
"@fluojs/cache-manager": patch
---

Preserve values written after reset when an older remember write finishes. Reclaim invalidation bookkeeping after overlapping cache hits or read failures, while keeping pending loads invalidated until their load cycle settles.
