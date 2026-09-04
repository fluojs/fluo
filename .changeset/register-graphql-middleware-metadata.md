---
"@fluojs/graphql": patch
---

Fix GraphQL endpoint middleware registration through module metadata so `GraphqlModule.forRoot()` consistently dispatches requests through the application pipeline.
