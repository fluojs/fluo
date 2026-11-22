---
"@fluojs/persistence": patch
---

Snapshot the input array and settlement records in AfterCommitError so results and errors retain their creation-time FIFO outcomes when callers mutate the original input. Preserve rejection reason identity without cloning or freezing reason objects.
