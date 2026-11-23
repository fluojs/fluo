---
'@fluojs/slack': patch
---

Treat injected Slack transports with a non-callable `create` field as app-owned instances in both sync and async module registration, preserving bootstrap, delivery, and shutdown ownership.
