---
"@fluojs/http": patch
---

Preserve canonical HTTP error statuses for exact GET v2 React navigation requests
when an HTML error provider is configured. Authentication and not-found errors
no longer become 406 responses; unsupported media, versions and methods retain
ordinary error negotiation.
