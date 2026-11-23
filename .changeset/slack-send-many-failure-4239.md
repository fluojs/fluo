---
"@fluojs/slack": patch
---

Correct sendMany failure classification for unsuccessful transport receipts, caller cancellation during the final delivery, and validation or lifecycle errors with continueOnError enabled. Preserve standalone send receipt behavior and sequential batch ordering.
