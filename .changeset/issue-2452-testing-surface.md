---
"@fluojs/testing": major
---

Narrow the root `@fluojs/testing` type surface to documented app/module testing contracts while keeping mock compatibility helpers available from `@fluojs/testing/types` and `@fluojs/testing/mock`.

Migration: import low-level mock compatibility helper types such as `TestingMockFunction`, `TestingMockContext`, `TestingMockResult`, and `TestingMockSettledResult` from `@fluojs/testing/types` instead of the root package.
