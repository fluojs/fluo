---
"@fluojs/notifications": patch
---

Preserve requested lifecycle publication rejection reasons, including undefined from Promise.reject(), when notification delivery or queue handoff also fails. Keep dispatch errors first, publication failures in order, and successful delivery results unchanged.
