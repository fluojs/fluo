---
"@fluojs/platform-nextjs": major
---

Consolidate Next adapter creation into root `NextHttpApplicationAdapter.create(options)`
and give each public capability one import owner. Remove `createNextAdapter`
from source and all package entry points, root App/Pages handler re-exports,
router-subpath adapter re-exports, and adapter `GET`, `POST`, `PUT`, `PATCH`,
`DELETE`, `HEAD`, and `OPTIONS` aliases.

Migration: import `NextHttpApplicationAdapter`, `NextAdapterOptions`,
`NextAdapterLoader`, and `InvalidNextAdapterOptionError` from
`@fluojs/platform-nextjs`. Replace `createNextAdapter(options)` with
`NextHttpApplicationAdapter.create(options)`, pass the adapter to
`FluoFactory.create(AppModule, { adapter })`, and call `app.listen()`.
Import `createNextAppRouterHandler`, `NextAppRouteHandler`, and
`NextAppRouterMethodHandlers` only from `/app-router`; import
`createNextPagesRouterHandler` and `NextPagesRouterConfig` only from `/pages-router`.
Replace direct adapter method exports with destructured lazy App facade exports.
Keep Next's required route methods, including `GET`, `POST`, and `HEAD`.

The public constructor, class identity, inheritance, and instance
`fetch`/`listen`/`close` operations remain supported. Pages still owns the Node
stream bridge with `bodyParser: false`, backpressure, abort, and post-response
upload draining; it is not an App Web Request callback. Root
`defineNextApplication` retains process-local keyed identity and sticky failures,
distinct from each router facade's closure cache. Compiler configuration remains
on `/next-config`. There are no permanent compatibility aliases.

See the English and Korean `packages/platform-nextjs/README*.md#api-migration`
guides for the full removed-surface table and canonical recipes.
