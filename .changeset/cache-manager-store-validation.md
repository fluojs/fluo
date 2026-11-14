---
"@fluojs/cache-manager": patch
---

Validate cache store configuration during option normalization. Unsupported store names now fail instead of silently selecting memory, and custom stores must expose callable get, set, del, and reset methods. Validation runs synchronously in forRoot and when the factory result resolves in forRootAsync, without invoking store operations or requiring optional capabilities.
