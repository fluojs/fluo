---
"@fluojs/openapi": patch
"@fluojs/graphql": patch
"@fluojs/cache-manager": patch
---

Harden OpenAPI descriptor and document snapshots so caller-owned descriptor mutations and served-document mutations cannot alter generated module state.
Document and test the adjacent GraphQL websocket shutdown and cache Redis namespace contracts covered by the request-pipeline audit.
