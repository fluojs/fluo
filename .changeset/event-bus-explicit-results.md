---
"@fluojs/event-bus": minor
---

Add opt-in `publishWithResult()` to observe local handler and outbound transport-channel outcomes, distinguish lifecycle refusal and missing recipients, and retain a completion receipt for background publication. Existing best-effort `publish()`, payload isolation, handler discovery, and bounded shutdown drain remain unchanged. Result-aware publication omits payloads, handler return values, and raw handler/transport errors from its outcomes and logs; timeout and cancellation do not forcibly stop work or acknowledge remote delivery.
