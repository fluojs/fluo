---
'@fluojs/passport': patch
---

Reject invalid Passport.js action timeout configuration instead of leaving strategy settlement unbounded, preserve zero as a next-turn timeout, and correct cookie-auth JWT verifier wiring guidance.
