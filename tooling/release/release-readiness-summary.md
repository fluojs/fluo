# release readiness summary

<p><strong><kbd>English</kbd></strong> <a href="./release-readiness-summary.ko.md"><kbd>한국어</kbd></a></p>

- [x] Canonical bootstrap docs — The quick start guide documents the public `pnpm add -g @fluojs/cli` + `fluo new` path.
- [x] Repo-local smoke path docs — The repo-local sandbox path is documented in the CLI README as monorepo-only verification support.
- [x] Starter shape and runtime ownership — The generated starter uses runtime-owned bootstrap helpers plus a starter-owned health module, without default metrics or OpenAPI surfaces.
- [x] Generic-first bootstrap contract — Bootstrap docs and scaffold source no longer encode ORM/DB prompts, support tiers, or starter-time ORM adapter injection.
- [x] Toolchain contract lock — The toolchain contract matrix documents the generated app baseline plus the canonical fluo command surfaces.
- [x] Dist-based package entrypoints — CLI manifest and bin prove a dist-backed public `fluo` entrypoint with a subordinate compatibility alias.

- Commands executed: `pnpm --dir packages/cli build`, `pnpm --dir packages/cli typecheck`, `pnpm --dir packages/cli test`, `pnpm --dir packages/studio build`, `pnpm --dir packages/studio typecheck`, `pnpm --dir packages/studio test`, `pnpm --dir packages/cli run sandbox:create`, `pnpm --dir packages/cli run sandbox:verify`, `pnpm --dir packages/cli run sandbox:test`
- Side effects: `CHANGELOG.md` draft release-readiness section updated
