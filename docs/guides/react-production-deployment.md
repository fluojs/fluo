# React production deployment

<p><strong><kbd>English</kbd></strong> <a href="./react-production-deployment.ko.md"><kbd>한국어</kbd></a></p>

## Build and publish

Build the official React starter with `pnpm build`, then start the built server with
`pnpm start`. The selected Vite client manifest supplies the complete output graph and
`/assets/` base to `createReactViteAssetManifest(...)`. Pass its `buildId` to
`ReactModule.forRoot({ navigationBuildId })` and the document's
`ReactClientRouterProvider.navigationBuildId`; never supply a hand-written release label.
The server serves the manifest-selected hashed bootstrap, lazy JS, CSS, and favicon at
the same origin under `/assets/`. The manifest is read at startup, not borrowed from a
different build. A direct GET must still return its HTTP-owned HTML and status without JS.
The production bootstrap needs no Vite dev client, preamble, or WebSocket. Arbitrary
CDN hosts and cross-origin asset bases are not supported by this recipe.

Publish B's complete hashed output **before** switching requests to its server and
manifest. Retain A's hashed assets for at least the longest advertised old-tab support
window (choose and monitor a concrete window for the application; for example 24 hours),
then retire A only when that window has elapsed. Serve content-addressed assets with
`Cache-Control: public, max-age=31536000, immutable`; an unversioned favicon instead
uses a short cache lifetime. HTML and credentialed
navigation results use `private, no-store`; do not cache a private navigation response
across users. An absent asset returns HTTP 404 with `X-Fluo-Asset-Status: missing` so
the host can alert on the missing path and build. A CDN or storage service must implement
this ordering and retention itself; Fluo does not provision it or guarantee zero downtime.

## Old tabs and recovery

An A tab compares every B navigation's validated v2 `buildId` with its A document
identity before importing a mapped module. A mismatch leaves the approved URL, page,
history and shell resource in place; the official shell shows a sanitized
`incompatible-build` diagnostic and an explicit update/document control. A mapped
chunk that fails to import reports `import-failure`; an unknown module key reports
`unsupported-module`. Missing A assets while old tabs are retained are an application
deployment incident, not permission to accept B's payload. Updating explicitly loads
an ordinary B document and may reset its resources; no automatic reload loop or
uninterrupted playback is promised. See [the navigation contract](../contracts/react-navigation-payload.md)
and [the v1 migration](../getting-started/migrate-react-production-assets.md).
