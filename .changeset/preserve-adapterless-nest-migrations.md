---
"@fluojs/cli": major
---

`fluo migrate` now preserves Nest bootstrap by default. If you relied on the former automatic Express bootstrap transform, rerun with `--platform express`. That automatic path supports only one numeric-literal single-argument `listen(port)`; host, callback, string, environment-derived, and multiple-listen shapes remain preserved for manual migration.
