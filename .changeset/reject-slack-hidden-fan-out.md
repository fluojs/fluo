---
"@fluojs/slack": patch
---

Reject Slack notification dispatches that include multiple non-empty recipients even when the payload also supplies a channel, preserving the documented one-destination boundary.
