---
'@fluojs/notifications': patch
---

Reject non-finite, fractional, zero, and negative notification bulk queue thresholds during module option resolution instead of silently disabling threshold-driven queue delivery.
