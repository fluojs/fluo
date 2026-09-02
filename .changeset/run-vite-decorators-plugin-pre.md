---
"@fluojs/vite": patch
---

Fix silently dropped field decorators on Vite 7+. `fluoDecoratorsPlugin()` ran in Vite's normal plugin stage, so Vite's own transpiler (oxc on Vite 7+) stripped field decorators such as `@FromBody`, `@FromQuery`, `@FromPath`, `@FromHeader`, `@FromCookie`, `@Optional`, and `@Convert` before Babel received the file. The plugin now sets `enforce: 'pre'` so Babel transforms the original TypeScript source and standard decorators keep their runtime behavior.
