---
'@fluojs/event-bus': patch
---

Keep non-blocking local handler and transport publish work in the bounded shutdown drain before closing the configured transport.
