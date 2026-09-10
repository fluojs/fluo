---
"@fluojs/cli": patch
---

Migrate the existing raw Node HTTP starter bootstrap from
`runNodejsApplication` to `FluoFactory.create(AppModule, { adapter })`, using
`NodeHttpApplicationAdapter.create({ port })`, followed by `app.listen()`.
Existing project files are not rewritten automatically.

The generated direct Factory recipe does not install run-helper defaults
implicitly. On migration, retain middleware, logger, and process-signal
registration and cleanup explicitly when required. The existing helper
implementation is unchanged.

Migration details are in `docs/getting-started/migrate-node-adapter-create.md`
and its Korean companion.
