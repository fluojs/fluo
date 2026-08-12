---
'@fluojs/slack': patch
---

Keep factory-owned Slack transports open until bootstrap verification settles before shutdown cleanup closes them.
