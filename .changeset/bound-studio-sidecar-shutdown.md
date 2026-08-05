---
'@fluojs/cli': patch
---

Bound Studio sidecar teardown by closing active authenticated ingestion sockets and sharing repeated close calls across one deterministic shutdown operation.
