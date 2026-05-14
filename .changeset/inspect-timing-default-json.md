---
"@fluojs/cli": patch
---

Preserve default JSON snapshot output when `fluo inspect --timing` is used without an explicit output mode, emitting the same `{ snapshot, timing }` envelope as `--json --timing`.
