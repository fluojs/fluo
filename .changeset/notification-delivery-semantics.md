---
"@fluojs/email": patch
"@fluojs/slack": patch
"@fluojs/discord": patch
"@fluojs/notifications": patch
---

Align notification provider delivery semantics by closing owned email transports when bootstrap verification fails, documenting Slack abort/retry handling and Discord direct batch fan-out boundaries, and strengthening notification dependency diagnostics coverage.
