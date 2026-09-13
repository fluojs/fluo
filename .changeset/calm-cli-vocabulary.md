---
"@fluojs/cli": patch
---

Unify CLI preview, migration, generator-test, update-check, and lifecycle option vocabulary. Use `--dry-run` for scaffold previews, `--with-slice-test` for module and resource generators, canonical migration transform tokens, and `--no-update-check`; removed legacy `--print-plan`, `--with-test`, and `--no-update-notifier` inputs now fail explicitly. Programmatic `GenerateOptions.withTest` is removed; use `withSliceTest`.
