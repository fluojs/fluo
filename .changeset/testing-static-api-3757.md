---
"@fluojs/testing": patch
"@fluojs/cli": patch
---

Unify testing construction behind `Test.createApp(...)` and
`Test.createTestingModule(...)`. The former `createTestApp(...)` and
`createTestingModule(...)` free-function exports, their `@fluojs/testing/app`
subpath, and free portability/conformance harness factories are removed.

Provider overrides now require `overrideProvider(token).useValue(value)`,
`.useClass(Type)`, `.useFactory(factory, inject?)`, or `.useExisting(otherToken)`.
The two-argument `overrideProvider` overloads are removed. `useValue` preserves
literal identity, including class constructors and provider-shaped objects; it
does not instantiate, invoke, or unwrap them.

Migration: replace free factory imports with `Test`, then call
`Test.createApp(...)` or `Test.createTestingModule(...)`. Replace each
`createXHarness(options)` call with `XHarness.create(options)`. Regenerate CLI
test files or make the same replacements in existing generated tests. Replace
`overrideProvider(token, value)` with `overrideProvider(token).useValue(value)`;
select the corresponding explicit strategy when construction, factory invocation,
or aliasing is intended.
