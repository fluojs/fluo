---
"@fluojs/drizzle": patch
---

Propagate a nested Drizzle `requestTransaction(...)` call's additional `AbortSignal` into the nested callback's ambient transaction context so descendant `requestTransaction(...)` calls observe the same composed cancellation signal. Cancelling only the nested signal now rejects that nested call and its descendants with the nested cancellation reason without cancelling the outer request signal, independent sibling request work, or the reused active transaction handle, on both the native driver and fail-open paths. Package-root README updates document the propagation, which still does not add rollback atomicity to fail-open boundaries or interrupt user work that is already running.
