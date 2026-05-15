---
"@fluojs/testing": patch
"@fluojs/platform-deno": patch
---

Stabilize HTTP adapter portability tests by binding ephemeral ports directly, make the Deno adapter report actual `port: 0` listen targets before startup completes, document local Vitest peer installation, and publish the `@fluojs/testing/vitest/tooling` subpath with import regression coverage.
