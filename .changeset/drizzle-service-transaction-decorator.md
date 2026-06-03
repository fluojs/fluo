---
"@fluojs/drizzle": minor
---

Add the Drizzle service `Transaction` decorator and current-less database facade.

Remove the previously exported `DrizzleTransactionInterceptor`; use `@Transaction()` or explicit `requestTransaction()` boundaries instead.
