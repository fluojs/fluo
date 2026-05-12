---
"@fluojs/email": minor
"@fluojs/slack": minor
---

Add lifecycle-gated email and Slack delivery failures once shutdown begins so factory-owned notification transports are not reused or recreated during teardown, and expose lifecycle error classes for callers that handle send/shutdown races.
