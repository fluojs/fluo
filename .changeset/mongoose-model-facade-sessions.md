---
'@fluojs/mongoose': patch
---

Fix Mongoose transaction shutdown ordering and model facade ownership so shutdown is checked before ambient manual transaction reuse, automatic model session injection stays scoped to `MongooseConnection.model(...)`, and raw Mongoose connection objects are not mutated.
