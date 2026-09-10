---
"@fluojs/platform-nodejs": patch
"@fluojs/http": patch
"@fluojs/runtime": patch
---

Consolidate raw Node adapter creation in `NodeHttpApplicationAdapter.create(options)`, including compression and multipart settings. Remove `createNodejsAdapter`, `createNodeHttpAdapter`, `NodejsAdapterOptions`, and `NodejsHttpApplicationAdapter` from public exports and implementations. Preserve the existing adapter class, public positional constructor, DI identity, and instance lifecycle.

Migration: Import `NodeHttpApplicationAdapter` and `NodeHttpAdapterOptions` from `@fluojs/platform-nodejs`. Replace `createNodejsAdapter(options)` with `NodeHttpApplicationAdapter.create(options)` and `createNodeHttpAdapter(options, compression, multipart)` with `NodeHttpApplicationAdapter.create({ ...options, compression, multipart })`. Replace the Nodejs instance type alias with the concrete class. First-party `/internal` consumers use the same class and options type.

The raw Node CLI starter now uses `FluoFactory.create(AppModule, { adapter })` followed by `app.listen()`. Existing applications are not rewritten. When migrating from a run helper, explicitly retain required middleware, logging, and process-signal registration/cleanup; direct adapter-first startup does not install those run-helper defaults. Existing bootstrap/run helper behavior remains supported.

Align shipped HTTP/runtime README recipes without changing their runtime behavior. Full EN/KO migration guidance: `docs/getting-started/migrate-node-adapter-create.md` and `docs/getting-started/migrate-node-adapter-create.ko.md`.
