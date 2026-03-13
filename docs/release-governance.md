# release governance

This file is the public-facing companion to the Phase 5 release/package governance work.

## intended publish surface

These packages are the intended public release surface once the repository leaves its current private-workspace state:

- `@konekti/core`
- `@konekti/config`
- `@konekti/http`
- `@konekti/jwt`
- `@konekti/passport`
- `@konekti/prisma`
- `@konekti/drizzle`
- `@konekti/di`
- `@konekti/runtime`
- `@konekti/testing`
- `@konekti/cli`
- `create-konekti`

## versioning policy

- semver for public packages
- coordinated workspace releases when public package contracts move together
- internal workspace version bumps follow the public release train but are not public API promises on their own

## changelog and deprecation policy

- every public release should capture package-level changes and migration notes
- deprecations must be announced before removal unless the package is still explicitly experimental/preview
- docs and scaffold output should be updated in the same release window as surface changes

## release checklist

1. `pnpm test`
2. `pnpm typecheck`
3. `pnpm build`
4. verify scaffolded `pnpm`, `npm`, and `yarn` starter projects still run end-to-end
5. confirm docs match the current package surface and support matrix
6. confirm any manifest decision note still matches benchmark evidence
