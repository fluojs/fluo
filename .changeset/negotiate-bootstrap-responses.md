---
'@fluojs/http': minor
'@fluojs/runtime': minor
---

Expose successful-response content negotiation through runtime bootstrap, honor deterministic exact,
structured-suffix, wildcard, quality, and `q=0` precedence through `@Produces(...)`, and add a
deduplicated `Vary: Accept` field on negotiated successes and framework-committed negotiation-generated
`406` errors across native fast-route and fallback dispatch. Keep formatter failures free of uncommitted
success metadata, and keep successful-response negotiation `406` errors canonical JSON when optional HTML
error representation is enabled.
