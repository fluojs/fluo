---
"@fluojs/runtime": major
---

Preserve the documented application lifecycle state transitions and terminal operation gate, reject provider and child microservice operations once shutdown starts, and resume incomplete adapter or lifecycle-hook stages without repeating completed runtime phases.

Application and application-context close delegate container teardown to `Container.dispose()`, so runtime consumers inherit the `@fluojs/di` 3.x retryable failed-hook contract. In 2.x, a failed container-managed `onDestroy()` hook was attempted once. After upgrading, a later explicit application or context `close()` retries only the hooks that failed, while hooks that completed successfully remain exactly-once. Consumers must make failing cleanup hooks safe to attempt again.

Migration: Before upgrading from 2.x, make each container-managed `onDestroy()` hook idempotent or otherwise safe to retry. If a hook can fail after partially releasing resources, preserve enough state for a later `close()` call to resume the remaining cleanup without repeating completed side effects. Do not rely on a failed hook being skipped after its first attempt.
