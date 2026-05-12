---
"@fluojs/event-bus": patch
---

Preserve inherited event transport fan-out without depending on local publisher handlers, and guard inbound transport callbacks with shutdown drain semantics.
