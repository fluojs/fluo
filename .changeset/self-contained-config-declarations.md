---
"@fluojs/config": patch
---

Make the published `@fluojs/config` declarations self-contained for consumers without Node ambient types.

`ConfigModuleOptions.processEnv` is now typed as the package-owned `ConfigProcessEnv` (`Record<string, string | undefined>`) instead of the ambient `NodeJS.ProcessEnv` namespace, which the package never declared through `@types/node`. Strict TypeScript consumers compiling without Node types no longer fail to resolve the package root declaration. Accepted values and runtime behavior are unchanged, and `process.env` stays assignable because the structural type matches.
