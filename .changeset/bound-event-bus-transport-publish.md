---
"@fluojs/event-bus": patch
---

Bound awaited transport publishes with the same timeout and abort controls as local handlers, drain in-flight awaited publish work during shutdown, and ignore new publishes once shutdown has started.
