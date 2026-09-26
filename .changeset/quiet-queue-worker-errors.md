---
'@fluojs/queue': patch
---

Wait for BullMQ queue and worker connections to finish initializing before completing bootstrap, preventing unhandled Redis rejections when idle workers shut down immediately.
