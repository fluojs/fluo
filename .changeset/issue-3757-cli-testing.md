---
'@fluojs/cli': patch
---

Align existing generated tests and Nest testing migrations to use
`Test.createApp` and `Test.createTestingModule` from `@fluojs/testing`.
Generated fixtures dispose their module containers and close test apps in
`finally`; existing projects must replace the removed free-function imports
explicitly.
