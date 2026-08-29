---
"@fluojs/http": minor
"@fluojs/react": patch
"@fluojs/runtime": minor
---

Add typed internal HTTP response writer and result-finalizer integration seams, plus a portable HTTP authoring entrypoint that avoids Node async-context bootstrap.

Keep the `@fluojs/react` root free of eager Node built-ins by consuming the portable HTTP and runtime-internal authoring seams while preserving stable SSR, direct page finalization, and experimental Flight response behavior.
