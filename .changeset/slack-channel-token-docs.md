---
'@fluojs/slack': patch
---

Correct the English and Korean README explanations of the shared `SLACK_CHANNEL` DI key across compatible package copies using the same symbol registry. Clarify that key identity does not share channel instances across application containers, that `global: false` controls module visibility, and that multiple clients use app-owned modules/providers around distinct transports. Runtime behavior is unchanged; no migration is required.
