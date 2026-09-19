---
"@fluojs/microservices": major
"@fluojs/cli": patch
---

Consolidate microservice registration on `MicroservicesModule.forRoot(...)`, move transport imports to their dedicated subpaths, and use transport class `create(...)` factories in generated starters. Migrate `module.global` to top-level `global` and replace root transport imports and `createMicroservicesProviders(...)` with the documented module and subpath APIs.
