# Migrate React navigation v1 to production build identity

<p><strong><kbd>English</kbd></strong> <a href="./migrate-react-production-assets.ko.md"><kbd>한국어</kbd></a></p>

The opt-in `application/vnd.fluo.react-navigation+json;v=1` payload is replaced
by v2 with a required `buildId`. A v1 tab must not accept a v2 result as a soft
destination; it falls back to an ordinary document GET. A v2 tab rejects a v1
response as an invalid representation and follows its application document
fallback policy. Direct HTML does not require an Accept header.

1. Build the complete client output with base `/assets/` and retain its Vite
   manifest. Use `createReactViteAssetManifest({ manifest, base: '/assets/', entries })`
   and take `result.manifest.buildId`, including all lazy entries, rather than
   inventing a version string.
2. Supply the same identity to `ReactModule.forRoot({ navigationBuildId: buildId,
   controllers, renderPage })` and to the document/provider
   `<ReactClientRouterProvider navigationBuildId={buildId} navigationModules={modules} ...>`.
   Make the built document transfer `version: 2` with this `buildId` and
   require it before hydration; do not silently accept a missing identity.
3. Send exactly `Accept: application/vnd.fluo.react-navigation+json;v=2` for
   navigation and anonymous public prefetch. Treat `incompatible-build` as an
   explicit update choice; retain mapped `import-failure` separately from
   `unsupported-module`, and preserve existing HTTP error/redirect policy.
4. Publish B assets before B server/manifest and retain A assets for your
   specified old-tab window. Follow the
   [deployment recipe](../guides/react-production-deployment.md).

`@fluojs/react` is currently 0.2.2: this protocol/configuration change is a
breaking 0.x minor Changeset, not authorization to choose a published version
or release 1.0. The generated CLI starter supplies the identity automatically;
hand-built applications must keep manifest, document and client importers
from one build.
