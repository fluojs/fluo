# Documentation foundation verification

Date: 2026-09-21. Worktree: `.worktrees/docs-foundation`, branch
`docs-foundation`, base `e0c73126e`. No commit or deployment was performed.

## Delivered scope

- `CONTENT-MAP.md`: all 43 public root package manifests, their API owners,
  shared contracts, existing entry points, proposed chapters and remaining work.
- `DESIGN.md`: NestJS-inspired reading hierarchy with Fluo colors and reusable
  Fumadocs navigation, article, code and search primitives.
- Five English chapters: Introduction, Quick Start, Controllers, Dependency
  injection and Database transactions.
- English-first website policy with retained Korean sources and URLs.
  Repository and Book bilingual obligations remain in force.
- Search uses Fumadocs Flexsearch with Korean CJK indexing. The previous Orama
  default raised `Language "ko" is not supported` on the real API.

## Executed checks

| Check | Result |
| --- | --- |
| `pnpm vitest run tooling/docs/fixtures/docs-foundation` | 4 files, 25 tests passed |
| `pnpm verify:docs` | Exit 0; locale regression, ownership, knowledge index, Book, types and production build |
| Website ownership | 53 English pages, 50 retained Korean pages, 14 English navigation files |
| Knowledge index | 10 indexed contracts passed reference-integrity checks; not a semantic proof |
| Book validation | 72 chapters, Korean/English passed |
| Next production build | 110 static pages generated |
| `node tooling/docs/check-search.mjs http://localhost:4318` | English and Korean return nonempty locale-scoped results |
| Representative article internal links | 18 unique internal destinations returned HTTP 200 |
| Changed TypeScript and fixture LSP diagnostics | No errors |
| `git diff --check` | Passed |

The locale regression was observed failing before the checker change. The real
search API check reproduced the Korean failure before switching search engines.
After changing the search dependency, the development server required a restart
to discard stale module factories.
A combined validation session reached the Git pager (`(END)`) after the build
and timed out. The documentation command was rerun separately with an explicit
`DOCS_VERIFY_EXIT` marker rather than treating that session timeout as a pass.

## Runnable application evidence

`tooling/docs/fixtures/quick-start-foundation/verification-receipt.md` records
the isolated generated application using published CLI `3.0.2`, its exact
resolved package versions, seven passing tests, dev HTTP responses, production
build and start, and port override. Global CLI installation was not separately
executed; the pinned `pnpm dlx` path was used.

The four foundation test files exercise HTTP dispatch, a real listener,
dependency injection and Prisma capability rejection. Their fake Prisma client
does not establish SQL atomicity.

Native evidence was separately executed:

```sh
pnpm --filter "@fluojs/prisma..." --filter "@fluojs/drizzle..." --filter "@fluojs/mongoose..." build
cd packages/prisma/fixtures/after-commit
pnpm install --ignore-workspace --ignore-scripts --frozen-lockfile
pnpm run generate
pnpm run typecheck
pnpm test
```

Result: exit 0, **277 tests passed, 0 failed**, using real PostgreSQL and MongoDB.
Receipt: `.omo/issue-3718-native/run-is0z8Q/result.json` reports `success: true`
and both container cleanup operations fulfilled. These tests verify the shared
native transaction contract, not every application-specific model in the prose.

## Browser evidence

Production server: port 4318. All five representative routes were rendered at
1440 x 1000 and 390 x 844. Document scroll width equaled viewport width on all
ten views. The lead exercised mobile sidebar opening, search input and results,
theme switching, and local code scrolling. Light desktop/mobile captures live
in `.omo/evidence/docs-foundation/{0..4}-{desktop,mobile}.png`; route order is
Introduction, Quick Start, Controllers, Dependency injection, Transactions.
Additional captures record desktop dark mode and mobile code.

Two independent read-only reviewers using `bai/glm-5.3-flash` inspected all ten
captures and returned PASS without blockers. The screenshots prove the captured
viewports, not every browser or assistive technology. No Lighthouse score or
screen-reader audit is claimed.

## Remaining stages, not deferred defects in this increment

Complete the beginner sequence, rewrite the remaining package-family chapters,
publish the Book and canonical reference material within the website, and
establish release-version publication automation as described in `CONTENT-MAP.md`.
This increment does not claim those later stages are complete.
