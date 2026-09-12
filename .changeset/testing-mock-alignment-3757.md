---
"@fluojs/testing": patch
---

Name mock factories after their actual behavior and make their static methods the only creation path. Replace `createMock(partial, options)` with `ShallowMock.create(partial, options)` and `createDeepMock(Type)` with `PrototypeMock.create(Type)` from `@fluojs/testing/mock`. Replace `DeepMocked<T>` and `MockedMethods<T>` with `ShallowMocked<T>`; no legacy aliases remain.

Shallow mocks retain supplied values and lazily create top-level Vitest spies; they do not recursively mock nested objects or return values. Prototype mocks do not construct instances or mock instance fields/accessors. They include inherited and symbol-keyed methods, correctly preserve method shadowing, and mock explicit prototype methods named `toString`. Manual fakes and Vitest mock configuration remain supported.
