# Next compiler regression fixture

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

This fixture uses only distribution files and public exports from the current
checkout, not newly published packages. It requires Node.js `>=24.0.0 <27`,
independently installed worktree dependencies, and the affected dependency
closure build. Run from the repository root.

```bash
pnpm --filter '@fluojs/platform-nextjs...' build
pnpm --filter @fluojs/platform-nextjs test:e2e
```

By default, the suite uses the worktree's installed Next 16. Other versions can
be installed in an ignored directory in the same worktree. Next and the React
renderer use all three packages from that installation to avoid loading
different React copies.

```bash
mkdir -p .omo/next-16.3
pnpm --dir .omo/next-16.3 add --ignore-workspace next@16.3.4 react@19.2.7 react-dom@19.2.7
FLUO_E2E_NEXT_ROOT="$PWD/.omo/next-16.3" pnpm --filter @fluojs/platform-nextjs test:e2e
```

Similarly, install `next@16.0.0` separately in `.omo/next-16.0` to exercise the
peer range floor. This is not a claim that every 16.x patch was tested.
`FLUO_E2E_NEXT_ROOT` must stay inside the worktree.

## Automated regressions

- Real HTTP exercises decorated server controllers/field DTOs, GET and JSON POST,
  cookie conversion, malformed JSON/404 through App Router and Pages Router.
- A server page imports a `'use client'` TypeScript store. Its `@store` comment
  deliberately matches the legacy content condition. Dev and build/start must
  render `<output id="store">FLUO_SSR_STORE_OK</output>` in the HTML.
- Production builds must not bootstrap the backend; concurrent first GETs share
  one bootstrap per bundle, and SSE/error cleanup must complete.
- Next build checks shipped public option types through `next-config.types.ts`.
  `src/next-config.test.ts` covers rule order, non-mutation, and scope conditions.

Consumer configuration uses only the helper and scope declarations. It does not
manually resolve loaders or configure `type: 'ecmascript'`.
`preserveModulePaths` omits `as` and retains the original `.ts` path.

## Comparison experiments

`FLUO_E2E_COMPILER` is a fixture-only switch, not a public package API.

| Value | Helper options | Purpose |
| --- | --- | --- |
| Omitted / `scoped` | include + exclude + preserveModulePaths | Recommended scoped consumer path |
| `scope-only` | include + exclude | Verify scope independently of output path changes |
| `preserve` | preserveModulePaths | Verify path preservation independently of scope |
| `legacy` | Empty options | Reproduce the legacy helper's SSR import failure |

```bash
FLUO_E2E_NEXT_ROOT="$PWD/.omo/next-16.3" FLUO_E2E_COMPILER=preserve pnpm --filter @fluojs/platform-nextjs test:e2e
FLUO_E2E_NEXT_ROOT="$PWD/.omo/next-16.3" FLUO_E2E_COMPILER=scope-only pnpm --filter @fluojs/platform-nextjs test:e2e
FLUO_E2E_NEXT_ROOT="$PWD/.omo/next-16.3" FLUO_E2E_COMPILER=legacy pnpm --filter @fluojs/platform-nextjs test:e2e
```

Legacy mode intentionally fails on Next 16.3.4: dev GET `/` returns 500 and build
exits with `Can't resolve './store.ts.js'`. Scope alone leaves the SSR store
untransformed, while path preservation alone lets the transformed store resolve
at its original import path. The import defect and the need for scope options
are separate regressions. Existing defaults remain for compatibility.

Each run uses a unique `.omo/platform-nextjs-e2e-*` directory and ephemeral
ports. Readiness/stream events are subscribed before actions, with bounded
failure timeouts and no sleeps or readiness polling. `report.json` and command
logs remain after the temporary app and servers are cleaned up.
Do not confuse these automated regressions with a separate manual
browser/hydration demonstration.
