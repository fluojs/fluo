---
"@fluojs/jwt": patch
---

Reject non-finite JWT NumericDate claims and invalid `clockSkewSeconds` values during verification so malformed time policy fails closed.
