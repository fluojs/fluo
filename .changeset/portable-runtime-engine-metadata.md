---
"@fluojs/auth": patch
"@fluojs/cache-manager": patch
"@fluojs/core": patch
"@fluojs/cqrs": patch
"@fluojs/cron": patch
"@fluojs/di": patch
"@fluojs/discord": patch
"@fluojs/drizzle": patch
"@fluojs/event-bus": patch
"@fluojs/http": patch
"@fluojs/notifications": patch
"@fluojs/openapi": patch
"@fluojs/serialization": patch
"@fluojs/slack": patch
"@fluojs/socket.io": patch
"@fluojs/terminus": patch
"@fluojs/throttler": patch
"@fluojs/validation": patch
"@fluojs/websockets": patch
---

Remove package-wide Node engine installation gates from shared runtime packages
and existing Bun/Workers integration paths. This also removes transitive
first-party Node engine gates from native adapters.

Supported Node versions remain `>=24.0.0 <27`; Node-specific subpaths, crypto,
drivers, optional peers and native runtime limitations retain their documented
contracts. Omitting `engines.node` does not add support for unverified runtimes
or make every exported feature portable.
