---
'@fluojs/http': minor
'@fluojs/runtime': minor
---

Expose successful-response content negotiation through runtime bootstrap, honor deterministic exact,
structured-suffix, wildcard, quality, and `q=0` precedence through `@Produces(...)`, and add a
deduplicated `Vary: Accept` field on negotiated successes across native fast-route and fallback
dispatch.
