---
"@fluojs/vite": patch
"@fluojs/platform-nextjs": patch
"@fluojs/cli": patch
---

Use the TypeScript preset's `allowDeclareFields` option only with Babel 7, preserving declaration-only fields while letting built-in decorator transforms and newly generated configs compile with Babel 8.
