import { ensureMetadataSymbol } from '@fluojs/core';

// Application-entrypoint pattern documented in the Serialization package guide.
// The repository's vitest workspace installs Symbol.metadata through
// symbol-metadata.setup.ts, so this call is a no-op under vitest — but on Node 24
// applications it must run before any class decorated with @Expose()/@Exclude()/
// @Transform() is evaluated. Keeping it here makes this fixture file a faithful
// compile-checked copy of the documented application pattern.
ensureMetadataSymbol();
