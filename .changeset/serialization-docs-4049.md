---
"@fluojs/serialization": patch
---

Document SerializerInterceptor class-token provider registration in the controller module. Clarify that final JSON encoding throws for unnormalized bigint values but silently omits function and symbol object properties and replaces their array entries with null; normalize these values before writing.
