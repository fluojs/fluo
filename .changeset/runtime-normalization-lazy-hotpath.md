---
"@fluojs/runtime": patch
---

Reduce request/response normalization overhead for common adapter hot paths by skipping empty-body materialization and deferring stream/compression helper setup until requests actually use them.
