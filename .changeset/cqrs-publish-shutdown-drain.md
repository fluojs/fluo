---
"@fluojs/cqrs": patch
---

Drain active CQRS event publish and publishAll pipelines during application shutdown, and clarify that duplicate event handlers fan out instead of throwing duplicate-handler errors.
