---
"@fluojs/http": minor
---

Add portable `getRequestHeader(request, name)` and `appendVaryHeader(response, ...fields)` helpers to
`@fluojs/http`, then route DTO header binding, request-id extraction, version header reads, CORS,
and negotiated error responses through the shared contract.
