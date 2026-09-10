---
"@fluojs/runtime": patch
"@fluojs/cron": patch
"@fluojs/platform-nodejs": patch
"@fluojs/testing": patch
"@fluojs/http": patch
"@fluojs/graphql": patch
"@fluojs/openapi": patch
"@fluojs/metrics": patch
"@fluojs/microservices": patch
"@fluojs/platform-bun": patch
"@fluojs/platform-cloudflare-workers": patch
"@fluojs/platform-deno": patch
"@fluojs/platform-express": patch
"@fluojs/platform-fastify": patch
"@fluojs/react": patch
---

Make `FluoFactory.create(AppModule, { adapter })` the sole HTTP application
creation implementation. Remove `fluoFactory` and `bootstrapApplication` from
every runtime public entrypoint and emitted JavaScript/declaration surface.
Factory accepts `logger` and owns common middleware composition, original-error
preserving startup cleanup, and optional host shutdown registration.

Migration: import `FluoFactory` instead of `fluoFactory`, replace
`bootstrapApplication({ rootModule, ...options })` with
`FluoFactory.create(rootModule, options)`, then call instance `app.listen()` and
`app.close()`. Security headers now default on for direct Factory and testing
applications; set `securityHeaders: false` to retain a header-free baseline.
Readiness/listen/post-listen setup failure enters terminal shutdown; create a
new application instead of retrying listen on the failed shell. A signal
unregistration failure is retained for concurrent and later closes without
skipping runtime teardown.

Upgrade `@fluojs/cron` together with `@fluojs/runtime`. Cron retains its mandatory
Runtime dependency, and these coordinated updates leave scheduling behavior unchanged.

Node CLI HTTP and mixed starters now emit Factory creation, the explicit Node
console logger, and Node shutdown registration. Add a direct
`@fluojs/platform-nodejs` dependency when importing its logger or signals from a
Fastify/Express application. Node signal registration rolls back partially
installed handlers and attempts every removal after an individual failure.
The additive optional `HttpApplicationAdapter.getListenTarget()` capability
supplies startup-log metadata without requiring a socket on Fetch hosts.

See `docs/getting-started/migrate-http-factory.md` and its Korean companion for
defaults, ownership, cleanup errors, PublicToken inference, and the distinction
between `app.dispatch()` admission and low-level container/dispatcher access.
DI class identities, public constructors, instance operations, context-only
creation, and microservice creation retain their separate contracts.

Existing platform bootstrap/run helpers and their host-specific consumers remain
supported through Factory until their platform migrations. Other listed package
patches only align README imports and recipes shipped in their tarballs; they
introduce no independent runtime behavior. Repository Docs, Book, examples, and
test-only consumer migrations have no separate package-release effect.
