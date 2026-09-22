# Stage 3: continuous beginner path

Worktree: `.worktrees/docs-foundation`; base `e0c73126e`. No commit or deployment.
The stage 1/2 sources, Korean Book and repository documentation are preserved.

## Scope

The canonical beginner sequence continues in the CLI-generated Node/Fastify app:
Getting started -> Modules -> Controllers checkpoint -> Providers -> Validation
-> Serialization -> Error handling -> Testing. Root configuration, greeting and
health modules remain intact. The repository-checkout tutorial is explicitly a
separate exercise, not a required environment switch.

Six standalone checkpoint directories live in
`tooling/docs/fixtures/learning-path/`. `CheckpointCode` reads their complete
source files at documentation build time, so displayed implementation code is
the same code tested by the fixture suite, not a manually synchronized copy.
The Testing chapter's fenced test is extracted and executed in the generated
project by the standalone verification script.

## Execution evidence

- `pnpm vitest run tooling/docs/fixtures/learning-path tooling/docs/fixtures/docs-foundation`:
  10 test files, 44 tests passed, exit 0.
- `node tooling/docs/check-learning-path.mjs`: exit 0, `CHECKPOINT_PASS` for
  all six stages and `LEARNING_PATH_PASS`.
- The script creates an isolated app using published `@fluojs/cli@3.0.2`,
  adds published `@fluojs/serialization`, and preserves the generated root.
- Each stage passes the generated tests, `tsc --noEmit`, production build and
  real Node/Fastify listener requests. Stages 1-5 run seven generated tests;
  stage 6 runs eight including the exact test from the Testing chapter.
- Every stage preserves `/health`, `/ready` and `/greeting`. Requests verify
  list/create, rejected-input non-mutation, public response shape and resource
  404 as each capability is introduced.
- Servers use OS-assigned ports and a listener-ready log event, not sleeps.
  Applications are stopped and the temporary generated project is removed.

The first automated scaffold attempt inherited a TTY and selected the CLI's
interactive prompt path, which failed to resolve its optional prompt package.
The verifier now pipes child output and uses noninteractive input; the same
published CLI then completed the full workflow successfully. This does not
claim the optional interactive CLI packaging issue was fixed.

## Documentation checks

`pnpm verify:docs` passed: 59 English pages, 50 retained Korean pages,
14 English navigation files, the 10-entry knowledge index, 72 bilingual Book
chapters, documentation types and a 122-page production build.
The final prose correction was followed by another production build.

## Rendered learning path

All 11 changed reading surfaces were captured at desktop 1440 x 1000 and mobile
390 x 844: seven Overview chapters, Introduction, Quick Start, DI reference and
the repository tutorial entry. All 22 views had document scroll width equal to
viewport width. Captures are under `.omo/evidence/docs-stage3/`.

- All 31 distinct internal article destinations returned HTTP 200.
- All 18 source-backed code blocks exactly matched their tested checkpoint file.
- The mobile Validation code container scrolled independently (356px viewport,
  564px content, observed scrollLeft 80) while the document remained 390px wide.
- Two independent `bai/glm-5.3-flash` reviews returned PASS without blockers.
  One reviewer initially checked the main checkout rather than the worktree
  evidence directory; that missing-evidence finding was corrected.

Screenshots establish the captured layouts, not a comprehensive screen-reader
or browser-compatibility audit. No Lighthouse score is claimed.

Source fixture LSP diagnostics and scoped type evidence are recorded in
`tooling/docs/fixtures/learning-path/README.md`. The repository-wide tools
typecheck is not claimed clean: unbuilt unrelated JWT/realtime distribution
declarations are outside this documentation track. The external generated app
passes its own typecheck at every checkpoint.

## Maintenance and remaining scope

Change checkpoint source and tests together; the website renders the changed
source automatically. Re-run `check-learning-path.mjs` when the beginner steps,
published dependency expectations or shipped test change. Do not replace its
real listener checks with mocks or fixed delays.

Stage 4 package-family expansion, stage 5 Book web integration and stage 6
release publication automation remain later work.
