---
"@fluojs/persistence": patch
---

Call application-provided `shouldRollback` predicates without a receiver in both root and nested transactions, passing the original callback result to each predicate.
