---
"@fluojs/platform-nextjs": minor
---

Add optional `include` and `exclude` Turbopack path conditions to
`withFluoNextBackend`, plus `preserveModulePaths` to retain original TypeScript
module paths instead of renaming loader output to JavaScript paths. These
independent opt-ins prevent unrelated client SSR stores from being transformed
and avoid the reproduced Next 16.3 SSR import identity failure. Existing helper
defaults and user rule order remain unchanged.
