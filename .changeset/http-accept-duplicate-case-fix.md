---
"@fluojs/http": patch
---

Preserve `Accept` negotiation when duplicate-case HTTP headers include blank earlier entries so successful formatter selection and HTML error representations honor the first non-empty value.
