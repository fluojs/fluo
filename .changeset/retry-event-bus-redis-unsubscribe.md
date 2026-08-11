---
'@fluojs/event-bus': patch
---

Retain Redis channel ownership after an unsubscribe failure so a later Event Bus close retries cleanup while keeping caller-owned clients open.
