---
"@fluojs/config": patch
---

Consolidate config reload registration into `ConfigModule`: inject `CONFIG_RELOADER` from the same `ConfigModule.forRoot(...)` call instead of `ConfigReloadModule`. `envFile` and `envFilePath` are removed; migrate each single path to `envFilePaths: ['<path>']`. Omitting `envFilePaths` still loads `<cwd>/.env`, while `envFilePaths: []` disables env-file loading.
