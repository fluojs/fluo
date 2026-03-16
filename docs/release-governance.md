# release governance

This file is the public-facing companion to the Phase 5 release/package governance work.

## intended publish surface

These packages are the intended public release surface once the repository leaves its current private-workspace state:

- `@konekti/core`
- `@konekti/config`
- `@konekti/http`
- `@konekti/jwt`
- `@konekti/openapi`
- `@konekti/metrics`
- `@konekti/passport`
- `@konekti/prisma`
- `@konekti/drizzle`
- `@konekti/di`
- `@konekti/runtime`
- `@konekti/testing`
- `@konekti/cli`

## versioning policy

- semver for public packages
- minor releases preserve generated starter commands, toolchain config shapes, and the documented bootstrap paths
- major releases may require app updates when a public contract moves; those releases must ship migration notes in the same window
- coordinated workspace releases happen when public package contracts move together
- internal workspace version bumps follow the public release train but are not public API promises on their own

## changelog and deprecation policy

- every public release should capture package-level changes and migration notes
- deprecations must be announced before removal unless the package is still explicitly experimental/preview
- docs and scaffold output should be updated in the same release window as surface changes

## release checklist

1. `pnpm verify:release-candidate`
2. confirm docs match the current package surface and support matrix
3. confirm any manifest decision note still matches benchmark evidence

## release-candidate gate

`pnpm verify:release-candidate` currently proves:

- package typecheck + build succeed from the monorepo root
- scaffolded starter projects work outside the repo-local app path through the packed CLI/bootstrap codepaths that underlie the canonical `@konekti/cli` flow
- `pnpm`, `npm`, and `yarn` starter projects all pass `typecheck`, `build`, `test`, and `konekti g repo ...`
- generated starter projects expose runtime-owned `/health` + `/ready`, `/metrics`, and `/openapi.json`
- CLI bins and packed package artifacts work from `dist` output rather than `src`-only execution

The command also writes `tooling/release/release-candidate-summary.md`, and CI publishes that summary as both a workflow summary and an artifact.

The matching CI entry lives at `.github/workflows/release-candidate.yml`.
