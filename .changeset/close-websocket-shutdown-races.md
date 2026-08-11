---
'@fluojs/websockets': patch
---

Close the Node upgrade admission race at shutdown and keep queued disconnect cleanup inside the bounded drain across supported runtimes.
