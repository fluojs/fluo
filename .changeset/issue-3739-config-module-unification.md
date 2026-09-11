---
'@fluojs/config': patch
---

Unify configuration registration, loading, and reload ownership under `ConfigModule`.

Migration: replace `loadConfig(options)` with `ConfigModule.load(options)`, replace
`createConfigReloader(options)` with `ConfigReloadManager.create(options)`, and inject
`CONFIG_RELOADER` from the one `ConfigModule.forRoot(...)` registration instead of
registering `ConfigReloadModule`. Replace `envFile` or `envFilePath` with an ordered
`envFilePaths` list; use `[]` to explicitly disable env-file loading.
