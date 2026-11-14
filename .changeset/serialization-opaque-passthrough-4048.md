---
"@fluojs/serialization": major
---

Preserve opaque and self-serializing values in `serialize()`: built-ins created in another realm (such as through `node:vm`), `ReadableStream` and `Blob` values, and undecorated class instances with a callable `toJSON()` now pass through unchanged instead of being flattened to `{}`. Classes with serialization metadata (including an explicit `@Expose({ excludeExtraneous: false })`) keep metadata-driven shaping even when they define `toJSON()`, and DTOs that only spoof a built-in `Symbol.toStringTag` are still walked as records.

Breaking: undecorated class instances that define a callable `toJSON()` are no longer walked field by field. `serialize()` returns the instance itself, so the final JSON output is its `toJSON()` representation instead of a record of its own enumerable fields, and `@Exclude()`/`@Expose()`/`@Transform()` rules on decorated descendants reachable only through that instance's fields are no longer applied. For example, `serialize({ price: new Money(1234) })` now writes `{"price":"12.34"}` where it previously wrote `{"price":{"cents":1234}}`.

Migration: if a response relied on the previous field-by-field output (or on decorated nested DTOs being shaped) for an undecorated class that defines `toJSON()`, either add serialization metadata to that class, for example `@Expose({ excludeExtraneous: false })`, to restore field-by-field shaping, or make its `toJSON()` return the exact payload you want to send, applying any field filtering inside `toJSON()` itself.
