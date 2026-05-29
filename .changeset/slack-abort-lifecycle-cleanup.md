---
"@fluojs/slack": patch
---

Preserve Slack abort, shutdown, and webhook retry contracts by checking already-aborted empty batches, making owned transport shutdown idempotent, and avoiding transient retry response body reads before retry decisions.
