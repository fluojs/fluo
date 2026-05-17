---
'@fluojs/cli': patch
---

Harden the development restart runner so child process spawn failures clean up watchers and resolve with a failure exit code.
