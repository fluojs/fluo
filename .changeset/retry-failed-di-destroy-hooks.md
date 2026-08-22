---
'@fluojs/di': major
---

Change container-managed shutdown from one-shot failed cleanup to retryable failed-hook disposal. In 2.x, a failed `onDestroy()` hook was attempted once. After upgrading to 3.x, a later explicit `Container.dispose()` call or application/application-context `close()` retries only failed hooks, while hooks that completed successfully remain exactly-once. Consumers must make failing cleanup hooks safe to attempt again.

Direct child disposal now detaches the child from its parent after the attempt settles, including failed attempts. A caller that retains the child reference may retry its failed hooks. Parent- or root-started failures remain owned by the parent hierarchy until cleanup succeeds or a later direct child attempt settles.
