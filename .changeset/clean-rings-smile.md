---
"@fluojs/core": patch
---

Avoid installing the global `Symbol.metadata` polyfill as an import side effect; applications and tests should call `ensureMetadataSymbol()` at explicit bootstrap boundaries when they need the polyfill.
