---
"@fluojs/cli": patch
---

Correct the existing Node HTTP and mixed starter bootstrap recipes to use
`FluoFactory.create` with an explicit Node console logger and shutdown
registration. Starter shapes, platform selections, commands, and transport
semantics remain unchanged.

Generated Fastify and Express applications now declare `@fluojs/platform-nodejs`
directly for their logger and signal imports. Existing project files are not
rewritten automatically.

The React SSR starter uses a same-origin SVG favicon under `/assets/`, with
`image/svg+xml` responses, so the Factory's default content security policy
does not block the placeholder icon. Browser hydration diagnostics remain strict.

Migration: move existing generated bootstraps to `FluoFactory.create(AppModule,
{ adapter, logger, shutdownRegistration })`, then call `app.listen()`. Keep the
Node host dependency in the application manifest when importing its logger or
signal registration. See `docs/getting-started/migrate-http-factory.md` and its
Korean companion for the complete recipe and lifecycle changes.
