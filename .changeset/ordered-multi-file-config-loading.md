---
"@fluojs/config": minor
---

Add an explicit ordered multi-file env loading option to `ConfigModuleOptions` and `ConfigLoadOptions`.

`envFilePaths` accepts one ordered list of env files merged from lowest to highest precedence into the existing env-file tier, so it stays above `defaults` and below `processEnv` and `runtimeOverrides`. Relative entries resolve against `cwd`, missing files are skipped instead of failing the load, and an empty list explicitly opts out of env-file loading including the default `<cwd>/.env` fallback. Combining `envFilePaths` with `envFile` or `envFilePath`, repeating a resolved path, or passing a blank entry fails with `INVALID_CONFIG`.

In watch mode every distinct parent directory is watched once, any listed-file change recomputes the full list, deleting a higher-precedence file falls back to the remaining files, and validation failures keep the last valid snapshot. Automatic profile discovery stays outside the package, and existing single-file `envFile` / `envFilePath` behavior is unchanged.
