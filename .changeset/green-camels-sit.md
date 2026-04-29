---
'@fluojs/platform-express': patch
---

Fix Express response stream backpressure waits so `waitForDrain()` settles when the connection drains, closes, or errors instead of hanging on disconnected clients.
