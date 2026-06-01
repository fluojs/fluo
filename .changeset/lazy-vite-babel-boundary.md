---
"@fluojs/vite": patch
---

Lazy-load Babel from the Vite transform hook so importing `@fluojs/vite` no longer fails before Vite reaches a transform, and report missing Babel peers as transform-time diagnostics.
