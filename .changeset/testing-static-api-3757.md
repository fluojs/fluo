---
"@fluojs/testing": patch
"@fluojs/cli": patch
---

Unify testing construction behind `Test.createApp(...)` and
`Test.createTestingModule(...)`. The former `createTestApp(...)` and
`createTestingModule(...)` free-function exports, their `@fluojs/testing/app`
subpath, and free portability/conformance harness factories are removed.

Provider overrides now preserve direct and fluent `useValue(...)` inputs as
literal values, even when those values have provider-shaped fields. Use
`.useClass(...)`, `.useFactory(...)`, or `.useExisting(...)` to select an
explicit provider strategy.

Migration: replace free factory imports with `Test`, then call
`Test.createApp(...)` or `Test.createTestingModule(...)`. Replace each
`createXHarness(options)` call with `XHarness.create(options)`. Regenerate CLI
test files or make the same replacements in existing generated tests.
