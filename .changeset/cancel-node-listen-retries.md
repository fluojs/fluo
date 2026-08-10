---
'@fluojs/runtime': patch
---

Cancel pending raw Node `EADDRINUSE` listen retries during adapter shutdown so a closed listener cannot bind again after close completes.
