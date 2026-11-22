---
"@fluojs/mongoose": patch
---

Preserve the input document's identity when `MongooseConnection.saveDocument()` succeeds, even if the native `save()` resolves to a different document. The helper waits for the native save to settle and continues to forward the ambient session, caller options, and original save errors.
