---
"@fluojs/email": patch
"@fluojs/slack": patch
---

Block email and Slack sends once shutdown begins so factory-owned notification transports are not reused or recreated during teardown.
