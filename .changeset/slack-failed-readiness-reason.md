---
'@fluojs/slack': patch
---

Correct the failed readiness reason to `Slack transport failed.` so shutdown failures are no longer reported as initialization failures. Initialization failures also use this neutral reason; consumers that compare the previous `readiness.reason` string exactly must update their comparison. Lifecycle states, readiness and health classifications, and initialization/shutdown exceptions remain unchanged.
