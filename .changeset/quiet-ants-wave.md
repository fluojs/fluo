---
"@fluojs/config": patch
---

Consolidate config reload registration into `ConfigModule`: inject `CONFIG_RELOADER` from the same `ConfigModule.forRoot(...)` call instead of `ConfigReloadModule`. `envFile` and `envFilePath` are removed; migrate each single path to `envFilePaths: ['<path>']`. In file-capable loads, omitting `envFilePaths` selects `<cwd>/.env`; explicit in-memory sources suppress that default, while `envFilePaths: []` disables env-file loading.
