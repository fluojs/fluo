# React long-session reliability

<p><strong><kbd>English</kbd></strong> <a href="./react-long-session-reliability.ko.md"><kbd>한국어</kbd></a></p>

## Scope and prerequisites

The official jukebox composition uses the existing `ReactClientRouterProvider`,
`ReactNavigationExperience`, `Link`, `useRouter`, `useForm`, session and HTTP
handlers. It does not add a player SDK, private query cache, RPC transport or
another router. See the [product owner](../contracts/react-fullstack-product.md),
[navigation owner](../contracts/react-navigation-payload.md) and
[form owner](../contracts/react-progressive-forms.md).

Shipped source/harness coverage is separate from current-head product execution.
Focused actual journeys, three-engine correctness, exact-head reviews and final
remote CI remain required for #3879. This lane accepts a separate completed
`lane-3886-one-hour` soak of at least 3600000ms; the scheduled default stays
7200000ms. Historical `ca5e37bb` completion retains its original head and raw trace,
not current integrated proof; changed unproven seams require a fresh run. See the
[product acceptance guide](./react-product-acceptance.md).
By maintainer decision, actual physical mobile/tablet
verification is deferred to [#3906](https://github.com/fluojs/fluo/issues/3906),
not reported as passed and not a blocker for the current lane.
Use a clean committed checkout, Node `>=24.11.0 <27`, pnpm `10.4.1`, built workspace
packages and the installed Playwright Chromium/Firefox/WebKit binaries with their
OS dependencies. Initial provisioning is separate from a prepared-run verdict.
Source classification alone neither provisions nor passes these commands.

## Deterministic workload

For the maintainer-approved #3886 lane acceptance, set
`FLUO_RELIABILITY_SOAK_PROFILE=lane-3886-one-hour` and
`FLUO_RELIABILITY_SOAK_MS=3600000`. Its handoff declares
`soakProfile: "lane-3886-one-hour"` and still requires a completed raw trace
and matching duration of at least one actual hour. Scheduled/manual defaults
remain two hours. A one-hour result must not be described as a two-hour PASS.

From the repository root, the lead runs:

```sh
pnpm build
pnpm --filter @fluojs/example-react-vite-ssr exec playwright install --with-deps chromium firefox webkit
REACT_VITE_FORM_TEST_SERVER=1 pnpm --filter @fluojs/example-react-vite-ssr build:reliability
pnpm --filter @fluojs/example-react-vite-ssr typecheck
FLUO_RELIABILITY_SEED=3886 pnpm --filter @fluojs/example-react-vite-ssr test:reliability
node --test examples/react-vite-ssr/tests/reliability-handoff.test.mjs
```

The config runs each engine without a Chrome channel override or retry. Seven
warmup cycles precede at least 1,000 measured actions. Each cycle includes QR,
songs, tagged back/forward, background search, an independent shell widget, a
real guarded queue POST, page departure and recovery in the same document.
Every action acknowledges a new sequence on the actual shell MessageChannel.
The seed, cycle fault schedule, action index, first failure, raw measurements and
event trace go into each unique Playwright output directory.

Faults cover network abort/recovery, 503, an event-held response, an obsolete
invalid payload, mapped importer rejection, an approved render throw/reset and
build-identity mismatch. The explicit `reliability` Vite mode injects only
importer/policy barriers at the existing loader seam; normal assets do not enable
them. Actual missing asset and independently built A/B deployment verification
remain the existing `deployment-transition.spec.ts` companion. Invalid **current**
payload retains document fallback; logout and explicit document reload/update
are separate lifetime boundaries, never preservation successes.

Ownership/cache companions exercise late body/import/policy, real saves with a
failed follow-up and GET-only recovery, existing reversed row/search responses,
page unmount, old-session rejection, fresh 401/403 and real port cleanup.
Store source tests retain provider disconnect/rebind and late session/deploy
authority checks. A discovered runtime defect first needs lead-executed RED;
source inspection alone is not a reproduced defect.

## Resource and measurement accounting

Quiescence means settled page/form state, tracked HTTP completion and real server
request-scope cleanup, not a fixed sleep or `networkidle`. Checkpoints compare
document/port instance and mount/cleanup, persistent global listeners, app sockets,
enhanced interaction owners and pending work with the same warmed page baseline.
Port identity uses a weak reference to the actual instance, and every operation
requires that instance's next acknowledgement. Request references are removed on
finished/failed events; form-control event/body/upload/barrier retention is drained
after real scope cleanup. Trace records stream to disk instead of an ever-growing
in-memory array.

The browser-visible counts are not a public diagnostics API or a complete JS heap
census. Internal store subscribers, React delegated element handlers, native module
caches, HTTP keepalive pools and harness observers have distinct owners; unobserved
internal values are not reported as zero. Public prefetch retains its existing
32-entry LRU, 64 KiB entry ceiling, four concurrent requests and excess opportunity
**skip**, not a queue. Cache/HTTP/store regressions test those existing contracts,
single-use and freshness separately. No new product resource budget is introduced.

Chromium CDP reports raw JS heap; Firefox/WebKit lack that metric here and record
unsupported/null, not zero or PASS. Server and harness `process.memoryUsage()`
record heap and RSS separately. Browser RSS uses the harness-descendant OS process
tree from `ps`; shared pages may be counted repeatedly and an unavailable process
metric stays unsupported. Warmup, GC-not-forced and measurement noise accompany
live counts. Neither one GC observation nor an invented heap/RSS threshold proves
correctness. Reproducible sustained growth requires owner diagnosis and the same
workload after a verified correction.

## Separate soak and packaged starter

```sh
FLUO_RELIABILITY_SOAK=1 FLUO_RELIABILITY_SOAK_MS=7200000 FLUO_RELIABILITY_SEED=3886 \
  pnpm --filter @fluojs/example-react-vite-ssr test:reliability --project chromium
FLUO_RELIABILITY_STARTER=1 FLUO_BACKGROUND_EVIDENCE="$PWD/.omo/verification/issue-3886/packaged-<unique-run>" \
  node examples/react-vite-ssr/tests/verify-background-starter.mjs
```

Create the unique packaged output directory before running. The driver installs
the actual packed starter, checks installed release/template byte hashes and runs
typegen/typecheck/tests/build, then the same long workload in dev and production
serially. A separate provisioning command installs all three engines using the
generated app's exact Playwright version and records its elapsed time. Its test-only
`FLUO_REACT_RELIABILITY=1` flag enables fixture importer barriers; it is not a
framework API or a default production setting.

`.github/workflows/react-reliability-soak.yml` is a separate scheduled/manual job
bound to the checked-out SHA. It operates for at least two real hours, measures
each event-settled cycle and keeps failure artifacts. Duration itself is under
test; no sleep synchronizes correctness. Normal PR coverage joins the existing
`tooling-1` task, without adding a task or expanded job to the 18-job plan.
The locked runner mounts its raw browser receipts/traces under `/evidence`.
No elapsed-time budget has been proven by this source pass.

## Exact-head handoff and physical verification

`tests/reliability-handoff.mjs` consumes a version-1 JSON handoff and an existing
artifact root. It requires `head`, three `correctnessReceipts`, one `soakReceipt`,
`companionEvidence` and `physicalDevices`. The approved #3906 deferral uses an empty
`physicalDevices` array and `physicalDeferral: { issue:
"https://github.com/fluojs/fluo/issues/3906", status: "deferred" }`. Only after all
automated companion and soak checks pass does this return
`status: "automated-evidence-complete"` with the deferral preserved; it does not
return full `evidence-complete` or physical-device PASS.
Run paths are relative to the supplied
root; each receipt owns its adjacent `events.jsonl`. Missing/empty/escaped files,
wrong heads, truncated traces, failures, incomplete fault/engine coverage and a
short soak fail closed.

Companion kinds are `build`, `source-tests`, `http`, `ownership`, `cache`, `native`,
`packaged-dev`, `packaged-production`, `docs`, `ci-plan`, `contract-review`,
`code-review`, `verification-review`, `remote-ci`. The lead supplies
`{ kind, head, status: "passed", receipt }` only after the real check. The receipt
is a normalized `{ head, status: "passed", artifact }` envelope pointing to its
original nonempty raw artifact. Normalization cannot replace its underlying run,
review or remote verdict; this consumer does not issue workflow authority.

Physical records require both `kind: "mobile"` and `kind: "tablet"`, `physical:
true`, exact `head`, `model`, `os`, `browser`, `version`, `operator`, `artifact`,
`result: "passed"` and all scenarios: `navigation`, `search`, `row`, `history`,
`fault-recovery`, `auth`, `reload`, `resource-ack`. The responsible operator must
actually perform and record them. Desktop engines, device emulation and narrow
viewport screenshots are not substitutes. Unavailable hardware remains an
explicit external verification requirement.

```sh
node examples/react-vite-ssr/tests/reliability-handoff.mjs <handoff.json> <artifact-root>
```

The output means collected evidence is complete for #3879 to review, not automatic
product PASS, MusicKit acceptance, uninterrupted playback after OS discard or a
1.0 release. Failed/unfinished runs have no successful handoff. All results must
name the final implementation head.
