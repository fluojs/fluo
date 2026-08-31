---
"@fluojs/runtime": major
---

Preserve the documented application lifecycle state transitions and terminal operation gate, reject provider and child microservice operations once shutdown starts, and resume incomplete adapter or lifecycle-hook stages without repeating completed runtime phases.

Migration: Application and application-context close delegate container teardown to `Container.dispose()`, so runtime consumers inherit the `@fluojs/di` 3.x retryable failed-hook contract. In 2.x, a failed container-managed `onDestroy()` hook was attempted once. After upgrading, a later explicit application or context `close()` retries only the hooks that failed, while hooks that completed successfully remain exactly-once. Consumers must make failing cleanup hooks safe to attempt again. Node 20.19.2 and earlier support is removed. Node 21 support is removed. Node 22.0.0 through 22.1.x support is removed. Node 27 and later support is removed. Upgrade to Node >=20.19.3 <21 || >=22.2.0 <27.
