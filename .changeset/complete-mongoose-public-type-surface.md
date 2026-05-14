---
"@fluojs/mongoose": patch
---

Export the documented async module options and platform status snapshot input types, and clarify that `createMongooseProviders(...)` is reserved for manual composition compatibility while `MongooseModule.forRoot(...)` / `forRootAsync(...)` remain the primary registration APIs.
