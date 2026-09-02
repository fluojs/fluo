---
'@fluojs/queue': patch
---

Use the marker-aware registration context to detect duplicate scopes during bootstrap.

`QueueLifecycleService` previously counted duplicate queue scopes using a structural check (`moduleType` function + `scope` string) that matched any `useValue` provider with those two fields. An unrelated application provider that happened to have the same shape and the same scope string as a real queue registration could trigger a false "duplicate scope" bootstrap failure.

The marker-backed scope scan in `worker-ownership.ts` (`collectQueueModuleContexts` + `assertUniqueQueueScopes`) already runs in the same module factory before the service is constructed, so the service-level redundant scan has been removed. Queue registrations without the `QUEUE_MODULE_CONTEXT_MARKER` symbol are no longer counted.
