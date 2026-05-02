---
"@fluojs/graphql": patch
---

Restore GraphQL's patched instance helper on shutdown and cancel streaming GraphQL response bodies when downstream streams close or error, preventing long-lived subscription resources from leaking.
