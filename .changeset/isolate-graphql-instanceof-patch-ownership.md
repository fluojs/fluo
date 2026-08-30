---
'@fluojs/graphql': patch
---

Isolate cross-realm GraphQL `instanceOf` patch ownership by module object so lifecycle cleanup preserves other GraphQL module instances and external integrations.
