# 릴리즈 준비도 검증 요약

<p><a href="./release-readiness-summary.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

- [x] Canonical bootstrap docs — The quick start guide documents the public `pnpm add -g @fluojs/cli` + `fluo new` path.
- [x] Repo-local smoke path docs — The repo-local sandbox path is documented in CONTRIBUTING.md as monorepo verification support.
- [x] Starter shape and runtime ownership — The generated starter uses runtime-owned bootstrap helpers plus a starter-owned health module, without default metrics or OpenAPI surfaces.
- [x] Generic-first bootstrap contract — Bootstrap docs and scaffold source no longer encode ORM/DB prompts, support tiers, or starter-time ORM adapter injection.
- [x] Toolchain contract lock — The toolchain contract matrix documents the generated app baseline plus the canonical fluo command surfaces.
- [x] Manifest benchmark evidence — Release governance documents the canonical publish surface and the automated release gates.
- [x] Dist-based package entrypoints — CLI manifest and bin prove a dist-backed public `fluo` entrypoint with a subordinate compatibility alias.
- [x] Root OSS license file — A repository-level OSS license file exists at the root.
- [x] Public changelog baseline — CHANGELOG.md exists with Keep a Changelog baseline sections for Unreleased and current 0.x history.
- [x] Public package surface docs are synchronized — release-governance and package-surface docs declare the same @fluojs public package list.
- [x] Documented public packages exist in workspace — Every documented public package maps to an existing workspace package manifest.

- 실행한 명령: `pnpm build`, `pnpm typecheck`, `pnpm vitest run --project packages`, `pnpm vitest run --project apps`, `pnpm vitest run --project examples`, `pnpm vitest run --project tooling`, `pnpm --dir packages/cli sandbox:matrix`, `pnpm verify:platform-consistency-governance`, `pnpm verify:release-readiness`
- 부수 효과: `CHANGELOG.md` 릴리즈 준비도 드래프트 섹션 갱신
