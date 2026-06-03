---
'@fluojs/mongoose': minor
---

Add a Mongoose service `Transaction` decorator and conservative model auto-session facade.

Remove the previously exported `MongooseTransactionInterceptor`; use `@Transaction()` or explicit `requestTransaction()` boundaries instead.
