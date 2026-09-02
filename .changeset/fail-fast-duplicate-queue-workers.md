---
"@fluojs/queue": major
---

Fail bootstrap when multiple singleton `@QueueWorker()` registrations own the same job class or effective `jobName`. Give each worker a unique job class and job name, or consolidate handlers behind one `handle(job)` method.
