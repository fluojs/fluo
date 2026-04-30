---
'@fluojs/runtime': patch
---

Optimize Web runtime request materialization so fetch-style adapters avoid extra request cloning and eager query/header snapshots while preserving rawBody, multipart, and portability semantics.
