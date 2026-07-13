# React RSC Graduation Policy

<p><strong><kbd>English</kbd></strong> <a href="./react-rsc-graduation.ko.md"><kbd>한국어</kbd></a></p>

**Status: Policy defined; graduation blocked.** `@fluojs/react/rsc` is not a published export. The
only RSC and Server Function entrypoint remains `@fluojs/react/experimental/rsc` until every gate in
this policy has maintainer-approved evidence.

## Decision

Graduation moves the canonical RSC implementation to the stable `@fluojs/react/rsc` subpath. It does
not add RSC to the runtime-neutral package root: there is **no stable root RSC export**. During the
approved deprecation window, `@fluojs/react/experimental/rsc` must re-export the stable subpath so
existing imports keep identical runtime and type behavior.

The stable subpath may be added only in an explicit graduation PR that links evidence for every
check below. Writing this policy does not satisfy those checks and does not approve package `1.0`.

The authoritative graduation decision lives in the repository-owned
`tooling/governance/react-rsc-graduation-approval.json` record. While graduation is blocked its
`approval` field is `null`. Approval requires `status: "approved"`, issue `2502`, a trusted maintainer
identity, and a nonzero 40-character evidence commit SHA. The status in both policy mirrors must
match that record. Policy prose and GitHub-looking URLs are context only and cannot establish
approval; the gate remains deterministic and performs no network lookup in CI.

Maintainer authority comes from the pre-existing default-owner rule in `.github/CODEOWNERS`; the
graduation change set cannot modify that authority metadata. The gate verifies the recorded commit
with local read-only Git object and ancestry checks: the object must exist and be an ancestor of HEAD.
Neither a login string nor a syntactically valid SHA can self-assert approval.

## Current Evidence Status

| Gate | Current evidence | Status |
| --- | --- | --- |
| React and renderer versions | The prototype accepts only `react@19.2.6`, matching React DOM, and an exact matching Flight renderer. No supported-version matrix or upgrade evidence exists. | blocked |
| Manifest contract | `createReactRscManifest(...)` snapshots one bundler-neutral client-reference and server-to-client module map, but schema evolution and renderer-adapter compatibility are not stable. | blocked |
| Server Function transport | Signed references, origin/CSRF checks, bounded JSON values, and ordinary HTTP dispatch are tested. Compatibility and migration guarantees remain experimental. | partial |
| Rendering and hydration | There is no built-in encoder/decoder, renderer/build plugin, RSC hydration contract, hydration mismatch recovery contract, or prerendering evidence. | blocked |
| Transfer-data safety | Trusted hydration assets are documented for stable SSR, but RSC safe transfer rules for private, auth, cookie-bearing, and no-store data are not complete. | blocked |
| Navigation integration | `@fluojs/react/client` remains full-document and cache-free. No RSC-aware behavior has been approved for #2506 navigation. | blocked |
| Dual-import compatibility | The stable subpath does not exist, so the required stable/experimental re-export tests cannot pass yet. | blocked |

## Graduation Checklist

### React and Renderer Stability

- Record the exact React, React DOM, and selected Flight renderer versions tested by CI. Canary-only
  or range-assumed compatibility is insufficient.
- Define how a React upgrade enters the support matrix, which combinations are rejected, and whether
  the stable root peer range differs from the narrower RSC compatibility matrix.
- Prove that importing the stable RSC entrypoint does not eagerly affect applications that use only
  root SSR, `@fluojs/react/vite`, or `@fluojs/react/client`.

### Manifest and Server Function Transport

- Version or otherwise make compatible the client-reference manifest, server-to-client module map,
  action reference, request marker, response envelope, diagnostic code, and error-code contracts.
- Test deterministic manifest snapshots, malformed and unknown references, async chunks, browser/server
  module separation, and at least one real application-owned renderer/build adapter integration.
- Keep Server Function calls on an explicit ordinary fluo HTTP `POST` route with guards, middleware,
  interceptors, request scopes, authorization, exact origin policy, bounded bodies/results, and
  application-owned secrets. Stable RSC must not create a second dispatcher.

### Rendering, Hydration, and Data Safety

- Document and test SSR, CSR, and future prerendering interaction without Angular `ServerRoute[]`,
  Next route segments, TanStack route trees, file routing, or a parallel URL matcher.
- Define the server HTML/first client render equality rule, hydration mismatch diagnostics and error
  recovery, pre-hydration interaction fallback, and browser-only effect boundary.
- Define escaped and bounded safe transfer rules. Auth state, cookies, `Set-Cookie`, private responses,
  and `Cache-Control: private` or `no-store` data must not enter reusable bootstrap or Flight caches.
- Prove browser/server bundle separation so server-only actions, secrets, and private modules cannot
  enter client output.

### Routing and Navigation Ownership

- Keep route ownership in `@fluojs/http`; `@Router(...)` and `@Path(...)` remain facades over its
  metadata, DTO binding, validation, guards, interceptors, middleware, and request lifecycle.
- Keep #2506 semantics unchanged unless a separate contract approves and tests RSC-aware prefetch,
  refresh, invalidation, or cache behavior. Graduation alone must not add a client data cache.
- Preserve real-anchor and full-document fallback behavior before hydration and when JavaScript is
  unavailable.

### Tests and Runtime Evidence

- Add export-map tests that import both `@fluojs/react/rsc` and
  `@fluojs/react/experimental/rsc`, compare exported values/types, and prove the experimental path is
  a re-export throughout the deprecation window.
- Keep negative tests proving root `@fluojs/react` and `@fluojs/react/client` do not export or eagerly
  load RSC, Server Function, renderer, build-tool, or browser/server-only modules.
- Cover manifest, Flight response, action transport, route ownership, hydration mismatch, safe
  transfer, error recovery, and supported runtime/bundler combinations with executable tests.
- Keep executable evidence semantic rather than import-only: runtime dual-import evidence compares
  the stable namespace directly with the experimental namespace, declaration evidence uses an exact
  type-equality assertion, and hydration/data-safety/runtime-bundler suites call the stable runtime
  with their canonical inputs and assert an observable runtime result. Module-existence checks and
  bindings mentioned only in matcher arguments do not count.
- Pass package build, typecheck, tests, docs parity, platform governance, public-export TSDoc when
  applicable, and release-readiness verification.

### Documentation and Release Evidence

- Update `packages/react/README.md` and `README.ko.md`, package reference/chooser docs, migration notes,
  known limitations, and import examples in the same PR.
- Record the approval issue, evidence links, selected deprecation window, and removal criteria.
- Add a Changesets entry whose semver intent matches the public package impact. Generated versions and
  changelogs remain owned by the canonical GitHub Actions release flow.

## Stable Subpath Activation

After all gates are approved, the graduation PR must:

1. publish `./rsc` with type and import targets in `packages/react/package.json`;
2. make `@fluojs/react/rsc` the canonical implementation entrypoint;
3. retain `@fluojs/react/experimental/rsc` as a direct re-export with deprecation documentation;
4. add runtime and declaration compatibility tests for both import paths;
5. keep root `@fluojs/react` and `@fluojs/react/client` isolated; and
6. include a backward-compatible feature changeset, normally `minor` while the package is pre-1.0.

Every conditional leaf of the package root export must remain on `./dist/index.js` or
`./dist/index.d.ts` as appropriate, and legacy `main`/`types` fields must remain on those same
canonical artifacts. Adding `./rsc` must never redirect root consumers to RSC artifacts.

Until that PR exists, governance must reject a `./rsc` export.

## Deprecation Window and Migration

Call the graduation release **G**. The experimental re-export must remain available in G and through
at least one later published `@fluojs/react` minor release **D**. Removal may be proposed only in a
release after D, so consumers receive one complete later minor release to migrate:

```ts
// Before and during the deprecation window
import { createReactFlightResponse } from '@fluojs/react/experimental/rsc';

// Preferred after graduation
import { createReactFlightResponse } from '@fluojs/react/rsc';
```

Removing the experimental path is a future breaking change unless maintainers explicitly decide
otherwise before public adoption. Under `0.x`, removal requires a `minor` changeset and
consumer-facing migration notes; at `1.0+`, it requires a `major` changeset. Do not silently remove,
redirect to incompatible behavior, or shorten the window after G.

## Semver and Roadmap Labels

Roadmap labels `0.4.0` and `0.5.0` are **roadmap phase positions**, not guarantees of actual package
versions. Only committed Changesets and the canonical `.github/workflows/release.yml` flow determine
the generated package version.

Defining this policy without adding `@fluojs/react/rsc` changes no published package API or behavior,
so the policy-only PR has no release changeset. The future stable subpath is backward-compatible
feature work and normally carries a `minor` changeset while pre-1.0. Experimental-path removal is
classified separately as the breaking change described above. A `1.0` release still requires
explicit maintainer approval and the repository-wide graduation requirements.

## Known Limitations That Remain Stable

Graduation does not promise a built-in Flight renderer/decoder, Vite or Webpack RSC plugin, automatic
`"use server"` transform/export discovery, file routes, route segments, client route table, SPA
document swapping, client data cache, prefetch, or automatic private-data serialization. Any later
addition needs its own behavioral contract, tests, docs parity, and Changesets intent.

## Verification

Policy and future graduation changes run:

```bash
pnpm vitest run tooling/governance/react-rsc-discoverability.test.ts
pnpm --dir packages/react test
pnpm docs:sync-check
pnpm verify:platform-consistency-governance
pnpm verify:release-readiness
```

The future graduation PR also runs export-map/declaration compatibility tests for both import paths
and any renderer, bundler, hydration, or runtime matrix named by its evidence record.

## Related Evidence

- [Behavioral Contract Rules](./behavioral-contract-policy.md)
- [Versioning & Release Rules](./release-governance.md)
- [Testing Guide](./testing-guide.md)
- [`@fluojs/react` package contract](../../packages/react/README.md)
- [Canonical package surface](../reference/package-surface.md)
- [Issue #2502](https://github.com/fluojs/fluo/issues/2502)
