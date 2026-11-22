---
'@fluojs/mongoose': patch
---

Restore registration typing for concrete Mongoose connections whose only surface is `model(...)`. Such connections now satisfy `MongooseConnectionLike` directly, so `MongooseModule.forRoot(...)`, `MongooseModule.forRootAsync(...)`, and direct `MongooseConnection` construction accept them without empty-object fixtures or double type assertions while `current()` and `dispose(connection)` keep the concrete type. Runtime fail-open behavior, strict transaction rejection, and existing session-capable consumers are unchanged.
