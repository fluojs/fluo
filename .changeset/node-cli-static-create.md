---
"@fluojs/cli": patch
---

Migrate the existing raw Node HTTP starter bootstrap from
`runNodejsApplication` to `FluoFactory.create(AppModule, { adapter })`, using
`NodeHttpApplicationAdapter.create({ port })`, followed by `app.listen()`.
Existing project files are not rewritten automatically.

The integrated Factory applies default security headers. The starter explicitly
supplies the Node console logger and shutdown registration callback. On migration,
retain required middleware and logging, and opt into Node signals through that
callback. Starter shapes, platform choices, and commands are unchanged.

Migration details are in `docs/getting-started/migrate-node-adapter-create.md`
and its Korean companion.
