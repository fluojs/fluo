# Isolated React application comparison

This suite is a scoped exception to the [existing local-only internal and HTTP
benchmarks](../README.md). It compares Fluo with pinned Next.js App Router, React Router
Framework Mode, and TanStack Start builds on the same seeded public listing/detail,
authenticated CRUD, and shell-preserving jukebox journey. The
[EN](../../../docs/guides/react-performance-benchmarks.md) and
[KO](../../../docs/guides/react-performance-benchmarks.ko.md) guides explain what
these comparisons can and cannot establish. This suite does not claim that the
current Fluo reference example already implements the complete product contract.

## Reproduction boundary

Install with this suite's isolated `pnpm-lock.yaml`; do not resolve framework versions
from the root workspace or update the lockfile during a timed run. Build linked Fluo
packages from the selected source commit, then build each application using its native
production command. Capture `git rev-parse HEAD`, `git status --short`, the lockfile
SHA-256, exact Node/pnpm/framework/browser versions, commands and exit codes with
every run. An uncommitted worktree is a different build input; retain its patch. Never
use data from a failed correctness journey or a failed production build as timing
evidence.

Production server children run with `NODE_ENV=production` identically for all
four frozen apps; provenance records `environment.serverNodeEnv`. Development
runners remain separate. Earlier development/unset-renderer measurements remain
archived rather than serving as a matched production verdict.

The shared passive Chromium NetLog observer authenticates missing CDP cancellation
terminals only through a unique exact native source clock and reciprocal lifetime
chain before capture. Original CDP observations remain intact; missing, contradictory
or ambiguous chains remain inconclusive. Native/CDP trace hashes and containment
are checked before evaluation. Logging overhead is included on both matched sides,
not measured separately. The page stays live through throughput and the unchanged
post-workload `ps` CPU/RSS snapshot; budgets, peer defaults and metric meanings do
not change.

### Opt-in exact native lifetime observation

Historical production measurement optionally accepts `nativeLifetime: { "enabled": true,
"python": "/opt/fluo-native-debug/bin/python" }` (under `measurement` in a
`run-gate.mjs` config). Omit it for the unchanged passive NetLog path:
the default never imports, starts, installs or requires Frida/Python.
FA-V2 requires separate timing and native-conformance executions as described
below; observer-specific requirements apply only to native-conformance.
The mode is `chromium-native-lifetime-v1`, with a retained versioned
symbol/argument/clock schema and agent/host source hashes.

The initial adapter supports only Linux/AArch64 ELF64 little-endian canonical
Playwright revision `1228` **headless_shell**, Chromium `149.0.7827.0`,
SHA-256 `b6f53f7e40c3ad6727cb3a12536026dcd93281e5965923752c8130ed53e5e8c4`,
GNU build ID `afcd146a627911fb30269f995d093903636ed886`.
It checks the executed executable, executable renderer mappings, native ABI
and exact retained symbols/offsets before installing hooks. A version string
alone is insufficient. Full Chromium, other builds/architectures and macOS
are unsupported; Linux evidence does not establish macOS representative support.
The external runtime is Python `3.11.2` executable SHA-256
`304aa87a76ebb13fd22d253ac157f14980ff2cdb23e6274f3b045571405e07dc`,
Frida `17.21.0`, and the exact Python/Frida file identities enforced by the
adapter. Provision that runtime separately in an isolated environment; the
benchmark does not install it or change host signing/attach permissions.

For the retained diagnostic container, verify and execute the opt-in config:

```sh
docker exec fluo-3884-native-debug-20261003 /opt/fluo-native-debug/bin/python --version
docker exec fluo-3884-native-debug-20261003 /opt/fluo-native-debug/bin/python \
  -c 'import frida; print(frida.__version__)'
docker exec fluo-3884-native-debug-20261003 sha256sum \
  /opt/fluo-native-debug/bin/python \
  /benchmark/browsers/chromium_headless_shell-1228/chrome-linux/headless_shell
# Run from an isolated copy of the collector with Linux-installed dependencies.
# Supply a fresh output root and the unchanged frozen config plus measurement.nativeLifetime.
PLAYWRIGHT_BROWSERS_PATH=/benchmark/browsers node src/run-gate.mjs \
  --config /absolute/native-opt-in-config.json --output-dir /absolute/fresh-results
```

Hooks are ready before entry navigation. Only owned browser descendants are
gated; new children get independent hooks before resume, and CDP must prove
their renderer role. PID/process birth, Resource birth and independent native
Loader birth, target/session and request occurrence must form a unique chain
through actual `IdentifiersFactory::RequestId` calls. Native loader pointers
are not CDP `loaderId`s. Only pending records can acquire cancellation from
matching `Cancel` entry, nested `HandleError` entry and both normal returns
strictly before the original CDP cutoff, with authenticated monotonic-clock
units. Actual CDP terminals stay unchanged. Cancellation is
`request-failed`, `canceled:true`, and counts in the existing error-rate
numerator/denominator; no body bytes, CDP status/error code or settled time
are synthesized.

Native events are buffered in host-retained shared memory without per-event IPC. Hook overhead
remains in measured work; setup/drain and separate observer costs are retained,
not separately measured or subtracted. Drain happens before BrowserServer
close but after unchanged throughput and `ps` samples, without moving the
original request cutoff. Raw native events, CDP ledger, coverage, schema/source
hashes, host logs and cleanup receipts remain in each fresh output root and
are authenticated and replayed by `verifyTraceFiles`, including warmups and
combined production/development sources.

Each owned Frida session and child gate remain resident until
that process exits naturally. Original observer hooks stop at drain without
changing a resuming exec child's gate. Final close cleans remaining sessions;
session detach/unload follows process exit, never precedes
BrowserServer close. Resident memory/runtime overhead stays
included, without subtraction. An eternalized inert script per session prevents live-agent unload when
failed/aborted preparation forces bounded observer-child termination.
Transport schema v2 retains an append-only memfd journal for each
PID/starttime/exec epoch. The host acquires and verifies its descriptor before
acknowledging hooks readiness or gated resume. The 500000 fixed-width records
never wrap: the native writer publishes each payload with AArch64 release
ordering, and the host reads markers with acquire ordering. Attempted/committed
counts, sequence markers, drops, native callback and invocation counts, ownership
and the original binary header/records remain in hashed raw evidence. Missing
ownership, an interrupted publication/callback, overflow or an incomplete call
cannot become complete by recomputing hashes.

Retired images are read from the retained mapping, without RPC to a destroyed
script. A live interval must cover the original cutoff; an earlier retired
interval requires authenticated detach plus a birth-bound normal status.
The early browser lifecycle observer may retain a separate zombie `/proc` status
witness; it never replaces a missing pidfd status or treats a signal to a zombie
as its cause.
When that witness is unavailable, only the authenticated owned browser/zygote
parent's actual `waitpid`/`wait4` normal return can supply an independent raw
reap status. Its pre-call kernel PID/starttime/parent, original stat, return PID,
status and observer sequence are retained. A NULL wait
status destination remains NULL; a separate birth-bound zombie `stat` exit-code
field captured before the actual reap may supply status, without rewriting
either the wait result or pidfd status. Raw SIGTERM 15 is admitted for an
earlier retirement only with its own complete pre-cutoff Chromium normal
termination caller/return chain and successful live-target send. It stays 15;
missing pidfd status stays missing. This proof does not borrow or backdate
`graceful-close` and is separate from the existing post-close shutdown proof.
Successful gated exec retains distinct old/new histories and
requires successor readiness before resume; failed exec cannot close the old
epoch. Unknown roles/status, crashes and unproved transitions stay inconclusive.
Neither the production COOP first navigation nor the capture boundary changes.
Nonempty retirement is also checked in a separately labeled two-document
correctness fixture, never a preliminary navigation in a measured cohort.
Journal mappings, native writer/callback accounting and lifecycle observation
costs remain included. Correctness evidence is not a paired performance verdict.

The Python host retains pidfd exit subscriptions through BrowserServer termination
and then finalizes the original-cutoff
evidence. Main exit/error/disconnect and owned descendant wait statuses are
retained even on failure. Known abnormal exits are rejected before NetLog parsing;
Python exit 0 or successful detach is not browser health. A reaped descendant's
unavailable wait status remains missing, not zero, so main exit 0 does not prove
every descendant exited normally.
Separate post-drain shutdown observation classifies raw status 15 as intentional
only when the authenticated Chromium main's normal-shutdown caller, live owned
target PID/start identity, successful SIGTERM send, explicit-close ordering and
normal main exit all agree. Its IPC/setup cost is not subtracted. Zombie targets,
failed sends, missing callers, unknown causes and other abnormal exits are not
admitted; status 15 and missing statuses are never rewritten to zero.

Unsupported identity, late attach, partial hooks, drops, incomplete returns,
transport/script errors, unproven renderer retirement, ambiguous reuse,
unverified child role or worker target coverage produce unavailable/inconclusive
evidence, never fallback coverage or invented cancellation. Observer sessions,
listeners and children are closed with bounded event-based waits on success,
failure, timeout and abort; cleanup failures remain recorded. Worker/service-worker
paths are not supported by the frame adapter. The two earlier canonical headless
diagnostics had no unresolved pending requests: their 36 already-canceled
bindings demonstrate viability, not missing-terminal integration or performance
acceptance. Focused runtime checks likewise do not replace identical-collector
before/after recollection across four frameworks/profiles, five samples/two
warmups or original budgets/statistics. The amended local representative pair
uses the explicit isolated Linux boundary below; macOS native observation
remains unsupported.
Historical fail/inconclusive receipts remain unchanged.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --dir tooling/benchmarks/react-app-comparison --ignore-workspace install --frozen-lockfile
for app in fluo next react-router tanstack-start; do
  pnpm --dir "tooling/benchmarks/react-app-comparison/apps/$app" --ignore-workspace install --frozen-lockfile
done
pnpm --dir tooling/benchmarks/react-app-comparison --ignore-workspace build
pnpm --dir tooling/benchmarks/react-app-comparison --ignore-workspace typecheck
pnpm --dir tooling/benchmarks/react-app-comparison --ignore-workspace test:smoke
node tooling/benchmarks/react-app-comparison/src/run-gate.mjs \
  --config tooling/benchmarks/react-app-comparison/config/representative.json \
  --output-dir tooling/benchmarks/react-app-comparison/results/<head-sha> \
  --mode discovery --historical-replay
```

`--mode discovery` records the first honest measurement before optimization. Its
`verdict.json` still contains the actual `fail` or `inconclusive` performance
verdict; exit status zero means only that the four-app correctness runs completed
and raw traces were retained. Omit the flag for the representative regression
gate: a `fail` or `inconclusive` verdict then exits nonzero. Never use discovery
mode in the representative CI workflow or describe discovery's exit status as
a performance PASS.
Keep each invocation in a fresh `results/<head-sha>/discovery/` or
`results/<head-sha>/regression/` directory. The gate rejects nonempty output
directories so a failed retry cannot reuse an older receipt.

The PR workflow runs `test:smoke` for suite changes after the isolated frozen install
and a root build within the existing 16-task catalog's conditional `static` task;
HTTP comparison retains its separate `isolated-benchmark` selector. It is a correctness and deterministic size/request-count gate, not
one noisy shared-runner performance sample. A separate representative-environment
workflow runs repeated profile measurements. A genuine failed measurement must remain
a failed gate; unknown or noisy data has an inconclusive verdict, never `pass`.
The existing GitHub representative workflow requires a provisioned `self-hosted, macOS, ARM64,
react-app-performance-m4-pro` runner. Without that runner, its GitHub dispatch
cannot be claimed as executed; local results must identify the actual host.
The runner starts built production servers with exact ready events, keeps raw
trace files under the supplied `results/` directory, then combines all four
profile receipts through `src/gate.mjs`. A single profile is not a gate pass.

### Explicit isolated Linux representative pair

The amended local #3884/#3885 pair uses one OrbStack Linux ARM64 environment
on the Apple M4 Pro host: kernel `7.0.14-orbstack-00380-ga7e0a2dc9535`,
12 logical CPUs and 8392974336 bytes of VM memory, image reference
`fluo-verification:sha256-81a185cd17d652f2d9fe7dbbaad1647262d17094e49eac533e7de30d2b37293e`
and actual immutable image ID
`sha256:f240abbe0c9fadb08df3b4f8b409111f5fd87733dfade0c69d6dfd839682d56b`.
Container CPU quota/period/nanoCPUs, memory/swap limits are zero and cpuset is
empty. These mean shared VM capacity, **not** a dedicated 12-CPU reservation.
Actual Node is `v24.21.0`; historical macOS observations used Node `24.20.0`.
`baseline.json` retains those historical facts and is not rewritten or paired
with Linux numbers.

This mode is explicitly opt-in. Keep `config/representative.json` unchanged;
make an isolated invocation config with
`measurement.nativeLifetime: { enabled: true, python: "/opt/fluo-native-debug/bin/python" }`.
For direct `measure.mjs`, put `nativeLifetime` at the config root instead.
The already-provisioned running container must see the current collector source,
config and fresh output paths, the existing Linux SDK and the canonical browser.
No Docker socket mount, permission change, install or browser rebuild is needed
by the launcher. Python/Frida were provisioned after image creation and are
authenticated separately, not inferred from the image ID.

Run the launcher **on the host**, substituting real paths visible inside the
selected running container:

```sh
node tooling/benchmarks/react-app-comparison/src/run-gate.mjs \
  --isolated-container fluo-3884-native-debug-20261003 \
  --config <isolated-config.json> --output-dir <fresh-suite-output> \
  --mode discovery
# For the after invocation, also require the before receipt's immutable hash:
# --environment-identity <before-environmentBinding.identitySha256>
# --environment-config-identity <before-environmentBinding.configSha256>
```

`measure.mjs --config <config> --output <receipt>` accepts the same
`--isolated-container` and both pair identity flags for focused invocation.
Pair comparison requires the environment and configuration hashes together;
matching tools with different frozen settings is rejected except for the
authenticated directional Fluo React-edit relation below. For that alternative,
also pass `--environment-before-record <original-before-environment.json>` and
`--environment-before-root <original-before-output-root>`. The collector authenticates
the original record before importing its unchanged bytes into the after output.
The flags alone do not authorize a config difference.
Capture the before side with `--react-edit-pair-source` when preparing this
unequal-config comparison. `run-gate.mjs` forwards that intent to development
children, not production-only children. The after side requires source proof
automatically when its authenticated before record has a different edit descriptor.
Ordinary isolated captures and exact-config pairs without this opt-in do not
require the historical source anchors or a production build for a dev-only run.
The internal `--isolated-guest` stdin transport is owned by the host launcher;
prepared environment JSON and caller-supplied image/version strings are not
observation inputs. The host actually runs Docker inspect/info against the selected
running container and rechecks container/VM/allocation after execution. The guest
cross-checks its hostname, kernel, CPUs/memory and cgroup allocation and measures
Node, pnpm, Playwright/TypeScript SDK, actual headless executable, external
Python/Frida files and observer schema/source hashes. Executable/source/allocation
bindings are revalidated around each sample.

Each fresh invocation retains `environment-<invocationId>.json` inside its output
root. Its byte digest, immutable `identitySha256`, separate `configSha256` and
invocation identity propagate through production/development/warmup samples,
combined source bindings, receipt provenance and aggregate provenance.
`verifyEnvironmentBinding`, `verifyMeasurementEnvironment` and `verifyTraceFiles`
reject missing/mismatched bindings, changed bytes, escaped realpaths, config/run
reuse and inconsistent combined sources. Missing observation exits nonzero rather
than synthesizing evidence. Run-specific PID/container instance/timestamps and
CPU samples are separate from immutable before/after comparison identity;
source provenance still identifies each runtime being compared. Comparable
identity uses content hashes rather than executable/SDK/collector absolute paths;
the actual paths and file bindings remain in `guestEvidence.guest` and the original
config remains in `configurationEvidence`. Product commit/build differences stay
in provenance, not in the comparable environment hash. Config locators under the
observed product root or framework development cwd normalize to root labels, and
the separately authenticated Python locator is excluded from comparable config.
Relocating before/after worktree/build roots therefore preserves comparability;
changing tool/collector content, allocation or frozen measurement settings does not.

The only unequal-config development pair is before product
`8a09eb8d216e555b97760a86539dea31e79c86a8` with Fluo
`src/document.ts` / `reload:true`, versus reviewed final product
`f9f5ac6722957cbe2752b9959e657a46594c0a1b` (or its source-verified implementation
descendant) with `src/catalog-destination.tsx` / `reload:false`.
Both replace `Editor login` once with `Editor login changed` on `/login`, observe
the same visible `h1`, and restore the exact source bytes. Only
`/dev/fluo/edits/react-edit/file` and `/dev/fluo/edits/react-edit/reload`
may differ in that direction in addition to the authenticated FA-V2
before-to-after phase transition; all other fields and peers remain identical.
The original representative config hashes are respectively
`b7e8cfc2c53a57006197357542b6831b9ccb58835297ee01e22a7a1afc5a5b5d` and
`a48953e1f5825e26afc5865a5177af988619bdceebec801cf8b4025b1a2fad73`;
each invocation and derived profile retains its own full exact config/hash.
The relation authenticates both contained original records, source blobs/head
lineage, actual build/dependency identities and final collector closure.
Production-only comparisons permit only the authenticated FA-V2 phase transition,
with all other config fields identical. Aggregate, profile,
development, warmup and combined replay must retain their distinct invocation
bindings and relation evidence; an aggregate relation is not a shared derived hash.

Before completion is a changed marker in a new main-frame document
(`reload-to-visible`); final completion requires the correlated component update
and changed marker in the same document (`hmr-to-visible`). Observers subscribe
before the source edit. Fallback document replacement is recorded as fallback,
not HMR, and cannot satisfy the selected HMR alternative. Raw edit evidence
retains initial/final visible markers, document tokens, exact HMR socket/update
identity and original/edited/restored bytes and hashes.
This product-native comparison was selected by the lead on best judgment after
the unanswered question expired, not by an affirmative user choice or waiver.
Merge base `942f673d34d58a9093d7012253913aec9143ff45` and final upstream
`f3e699047bfa51bbb69d9abeb2717eeb9e1871b0` include CLI/HTTP/React typegen,
background-form, navigation, store and provider changes. Product-level gains
cannot be attributed solely to #3884 or a same-upstream single optimization.
Narrow relation/runtime checks are not performance acceptance: the full fresh
four-framework/four-profile pair, two warmups/five alternating samples, original
budgets and versioned FA-V2 decisions, exact-head reviews and final GitHub CI remain required.

Schedule exclusive timing windows for the pair, including all four frameworks,
with the same actual toolchain/browser/observer/config/resources and final
collector. CPU-counter snapshots over entry-navigation through the unchanged
post-throughput `ps` boundary record actual generator CPU, ambient VM busy
percentage and idle CPU equivalents; development records its existing cold-ready
and edit-to-visible windows. They do not replace server CPU/RSS metrics, subtract
observer overhead or introduce an acceptance budget. VM idle capacity is a
measured observation, not proof of exclusivity; coordinate other timing work
before starting. Preserve five samples/two warmups, all profiles, alternating
order, budgets, versioned FA-V2 decisions and every historical fail/inconclusive.
Small runtime/replay checks establish the boundary, not full performance acceptance,
cross-platform parity, macOS support or physical-device verification. Ordinary
CI/default/macOS invocations remain unchanged and require no Docker/Python/Frida.

## Frozen decision policy

### FA-V2 acceptance migration

FA-V2 changes acceptance meaning without relaxing numeric budgets or public
behavior. The unchanged `baseline.json` median/spread/MAD vetoes are historical
replay only: `evaluatePerformance(..., "historical-v1")`, `evaluateEvidence`,
CLI `--historical-replay`. Historical FAIL/
INCONCLUSIVE or unversioned receipts cannot be relabeled as FA-V2.

Use all five independent samples without removal. L/U are observed min/max,
B the original budget and b the original band. Compare each of the three peers:

| Comparison | PASS | FAIL |
| --- | --- | --- |
| Upper absolute | U_F <= B | L_F > B |
| Throughput absolute | L_F >= B | U_F < B |
| Upper peer | U_F <= b * L_peer | L_F > b * U_peer |
| Throughput peer | b * L_F >= U_peer | b * U_F < L_peer |

Boundary crossing is INCONCLUSIVE; equality passes, with exact decimal/zero
comparisons and no tolerance widening. Spread/MAD are diagnostics, not
independent vetoes, and cannot hide true budget failures. The old separate
repeatability veto is lost. Five-sample extrema are not confidence intervals,
future-population bounds or statistical guarantees. Missing/invalid/duplicate/
quality/correctness/authentication failures cannot pass. Keep 200 requests/
concurrency 8, five measured/two warmups, alternating order, four frameworks/
four profiles, 22 client/six server metrics and all budgets/bands and peer
cache/prefetch defaults.

Authenticate membership and order against the frozen alternating measurement
plan, including raw `warmup`, `cycle`, `slot`, framework, profile and run ID.
Counts and unique IDs alone cannot distinguish warmups from measured samples.
The approved representative production descriptor binds throughput paths,
journeys/actions and interactions as well as 200/8; identical mutations in every
phase or purpose remain invalid even when their hashes are recomputed.

Derived configs explicitly set `measurement.methodVersion: "FA-V2"` and
`measurement.measurementPurpose: "timing"` or `"native-conformance"`.
Bind the same `measurement.pairId` and `measurement.pairPhase: "before"` or
`"after"` with distinct authenticated config/execution identities. Timing
requires `nativeLifetime: { enabled: false }`; native conformance requires
`{ enabled: true, python: "/absolute/provisioned/python" }`. Purpose is distinct
from cache `native`/`matched-cache` and execution `discovery`/`regression`.
Timing retains CDP/React readiness, passive NetLog authentication, original
cutoff and browser lifetime through throughput/server sampling without Frida.
Native conformance requires original ownership, coverage, journal, retirement,
raw exits and cleanup for the same product/build/stimuli/repetitions. Its
performance values never enter timing verdicts, and terminals cannot be borrowed
across executions. Native conformance alone is not performance PASS.

`evaluateAcceptedEvidence(baseline, timingReceipts, commonOutputRoot,
nativeReceipts)` authenticates both purposes. `evaluateAcceptedPair` additionally
bind fresh before/after phase/pair and frozen method/stimuli/environment.
Retain all raw/config/environment evidence under the common root; runner
`--native-receipts <JSON>` takes an array of matching receipt paths.
Use `--trace-root <common-root>` for sibling purpose roots. Full-suite
`<profile>.json` is the merged production/development receipt. Without
counterparts timing collection reports INCONCLUSIVE; normal gate CLI rejects
unversioned evidence. Method tests do not establish actual pair PASS or issue
closure. Fresh frozen pairs, independent reviews and full GitHub CI remain.

Client adoption preserves the approved RE-A01 source-bound React-edit relation:
before `src/document.ts`/`reload:true` versus after
`src/catalog-destination.tsx`/`reload:false` with unchanged
from/to/path/selector/expectedText and no other field changes. Authenticate and
retain separate full config/source/build/edit-source hashes.
`pairStimuliComparison` identifies the development relation but does not accept
it. The aggregate must invoke the existing client `authenticateReactEditPair`
on both original environment bindings, authenticate source proof and retain
that evidence. Missing verifier/proof fails closed. Server-only production
does not gain this exception. Timing/native counterparts within the same
product require identical actual edit descriptors; the cross-product exception
cannot be borrowed for purpose pairing.
The client verifier authenticates the same FA-V2 method, pair ID and purpose
and only the before-to-after phase transition, retaining original source proof
and relation replay. Production permits that phase transition only, not the dev
edit exception. Preserve
`pairPhase` in each full config/hash and freeze distinct before/after config IDs.

CPU is configured SERVER PID post-workload lifetime average/single logical CPU:
`100 * (utime + stime) / CLK_TCK / (uptimeSeconds - starttime / CLK_TCK)`.
Authenticate/recompute original `/proc/<pid>/stat`, a second birth/counter check,
`/proc/uptime`, `getconf CLK_TCK` and raw `ps`. RSS stays the existing `ps`
snapshot in bytes. No display rounding, client/window CPU or logical-core
division substitutes for this value; the 85% budget remains. Tick/birth
quantization and uptime's 0.01-second resolution remain explicit: unrounded
arithmetic does not guarantee continuous-time precision.

Passive NetLog does not guarantee resolution of missing CDP terminals. Actual
Next RSC without ExtraInfo has shown renderer/native millisecond mismatch and
absent `ResourceFinish` despite complete tracing; same-URL native ownership is
unproved. Keep the existing exact classifier, without a clock window/nearest
URL, guessed cancellation, peer prefetch edit or borrowed native counterpart
terminal. Pending timing remains a quality blocker.
Blink InspectorId/CDP and renderer-generated network request IDs occupy separate
identity spaces. The reviewed Chromium `ResourceLoader::Dispose` GC prefinalizer
can bypass `HandleError`/`DidFailLoading` and detach the URLLoader client. This
source coverage counterexample does not diagnose the actual pending request;
complete tracing is not proof that every terminal callback was instrumented.

[`baseline.json`](./baseline.json) fixes prospective numeric absolute budgets and
per-competitor relative bands for all 22 mandatory metrics on four named profiles:
desktop and emulated tablet-class CPU/network, each with native/default caching and
a matched-cache-policy run. Historical replay requires five independent runs per framework/profile,
two warmups per run, alternating target order, median of per-run percentiles, and a
15% across-run spread bound. A sample more than three median absolute deviations
and 15% of the median from center is inconclusive, not silently discarded. `errorRate`
must be zero. Higher throughput is better; other budgets are upper bounds. Do not
relax a budget without a separate explicit reviewed baseline change.

The initial discovery is recorded as `measured-fail` in `baseline.json`. Its
`fluoObservations` and `competitorObservations` contain the measured per-profile
medians for all 22 metrics; `null` denotes an unavailable observation, not zero.
A numeric median from noisy or outlying samples is descriptive, **not** a passing
check. Per-check reasons remain in the ignored local
`results/local-3883-auth-recheck/verdict.json`, indexed by the
[run manifest](./evidence/3883-baseline.json). The budget numbers are
**targets set before optimization**; the separate observations are measured.
Missing data, absent traces, failed correctness, insufficient repetitions, and
noisy runs cannot pass the historical evaluator. FA-V2 applies the observed-range
decision policy above, with spread/MAD retained as diagnostics.
The approved interaction marker belongs to the rendered destination rather than
the pending route location. Document replacement and response-body capture errors
mark the run inconclusive; failed browser requests remain in `errorRate` alongside
throughput failures. Failed correctness subprocesses retain their receipts and
still produce a combined verdict when the raw traces are complete. Owned process
groups emit `BENCH_PROCESS_REAPED` only after a liveness probe, escalating to
SIGKILL if SIGTERM leaves descendants alive.
Development cold start and React/CSS/server edit-to-visible are distinct timed
experiments; they must not be synthesized from production timings. Record native
cache controls separately and never set identity-dependent data to `public`.

Fluo development runs the existing canonical `fluo dev --runner fluo` integration,
not a production build/watch adapter. The fixture follows the shipped CLI template:
Vite middleware and its gateway WebSocket, refresh preamble before hydration,
current SSR destination loads, and the existing graph supervisor. The original
production entry and manifest keys, hashed split destinations and `/assets/`
serving remain independent of development. CSS observes visible HMR; the final
React stimulus uses the source-bound HMR alternative above, while the unchanged
before product uses its document reload path. The server stimulus waits for app-generation
readiness, then requests a fresh document to observe its changed HTTP data.
The edit-to-visible interval still starts before the source edit and ends at the
same visible text/computed-style assertion.
For document reloads, completion observes that marker in the newly committed
main-frame document without waiting for unrelated resources to finish loading.
Required generation readiness and relaunch readiness remain inside their
recorded intervals. The same collector applies to every peer and the baseline.
This observation correction also requires
identical-method baseline remeasurement; it does not relax budgets or turn
historical fail/inconclusive results into a performance PASS.

Optional `dev.<framework>.readiness` authenticates HMR before source edits.
The collector subscribes to CDP before navigation and requires the exact socket
origin/path, successful upgrade and structured readiness message. Installed Vite
8.0.3/8.2.2/8.3.1 uses the `vite-hmr` subprotocol and `{"type":"connected"}`;
Next 16.3.6 App Router with `--webpack` uses `/_next/hmr?id=...` (no subprotocol)
and a `type: "sync"` message with a compilation hash and no errors.
Arbitrary sockets, console text and socket-open events cannot satisfy readiness.
The event wait is bounded, cleans up listeners, and adds no sleep or polling.
HTTP-only fixtures without this optional field still require no WebSocket.

All initial HMR waiting is included in `devColdReadyMs` and each subsequent
edit experiment's recorded restart readiness. An edit-specific document
navigation authenticates its new connection too; its navigation/readiness time
is added to that experiment's ready step, before the unchanged edit interval.
Relaunch edits include readiness in their edit interval and retain the restart
observation. Raw timings retain the socket identity, exact message, CDP timestamp
and elapsed observation time. HMR connection is not hydration or module
registration completion. All four representative dev peers additionally opt into
`dev.<framework>.reactReadiness: { "timeoutMs": 60000 }`, using the same
`react-initial-completion-v1` observer before initial and edit-route navigation.
The entire React completion wait is included in cold-ready or the edit-navigation
ready step, never hidden before the React edit timer. Raw `reactReadiness` evidence
records renderer versions/bundle types, load, commit/passive events and completion.
The synthetic hook supplies the renderer registry required by Fast Refresh;
installed hooks retain their identity and callbacks. Omitting `reactReadiness`
or setting it to `false` preserves HTTP-only/no-React fixtures. Production keeps
its existing 10-second observer deadline and completion contract.
Recollect the baseline with this same readiness method before comparing edit
latencies. Budgets, counts, peer commands and production capture remain frozen.

The focused real-dev check requires installed linked packages and Chromium:

```sh
node --test tooling/benchmarks/react-app-comparison/tests/fluo-dev.test.mjs
```

It subscribes to browser mutations and app readiness before edits, restores the
stimulus sources after shutdown, checks fresh SSR, and verifies child exit and
public-port release. This is a correctness check, not a performance gate.

The mandatory metrics are cold/warm TTFB, shell arrival, LCP, hydration/main-thread
work, interaction-to-pending and approved-view p50/p95, transferred and compressed
JS/CSS, request count, throughput, error rate, CPU, RSS, dev cold ready, and
React/CSS/server edit-to-visible. Capture RSC and hydrated-model differences,
client work/bytes, server process CPU/RSS, generator saturation and contention,
environment and asset/request inventories. An emulation profile does not establish
results for an untested physical device.

The first four-profile discovery completed on the recorded dirty
`f71be378fc824d6b093a25881ea1f994826c6910` worktree with source SHA-256
`ba68a55a6c04d0d75b640c13373a39b33318d0a892be69437ea935ce1e3e8312`.
Subsequent lint-only changes moved the React provider's child to the canonical
`createElement` argument and used template literals for trace newlines.
The candidate source hash is
`2d52ddcbdfe8699308ea0f1b20f15112b95e2b7e5e0cc09f4658bdc10c391884`;
its build and browser smoke passed, but these discovery traces are **not** a
performance receipt for the later committed head.
The performance verdict is **fail**: Fluo tablet-native CSS edit median
`1504.67 ms` exceeded its unchanged `1500 ms` budget, and 22 relative-band
checks failed. There are also 42 noisy, 64 outlying, and 157 missing-metric
checks; none was changed to pass. Fluo desktop-native compressed JavaScript
was `66,373` bytes against a `170,000` byte budget, a pass for that metric only.
The manifest fingerprints 112 production, 112 development, and 80 combined
raw traces, plus every config, receipt, and verdict file. The bulk `results/`
directory is deliberately gitignored: a checkout of this commit contains the
manifest, **not** the underlying raw files. Keep or transfer the complete local
run directory to reproduce the observation. From this suite directory, verify
each manifest `sha256OfSortedShasumLines` with:

```sh
find results/local-3883-auth-recheck/traces -type f -name '*.json' -print0 |
  xargs -0 shasum -a 256 | LC_ALL=C sort | shasum -a 256
```

Substitute `dev-traces` or `combined-traces` for the other directories;
individual root-file SHA-256 hashes are listed under `receipts`. The committed
manifest is an integrity index and provenance pointer, not a substitute for
the ignored raw files or a claim that a GitHub artifact was uploaded.
The desktop browser viewport is 1440 × 900; the emulated tablet viewport is
820 × 1180 with 4× CPU slowdown and 1.6 Mbps downlink. The viewport and
network settings appear in each raw trace, not only in a profile label.
`shellArrivalMs` uses browser first-contentful-paint, and
`hydrationMainThreadMs` is the initial-navigation CDP `Performance.TaskDuration`
in milliseconds; it includes work outside hydration and is not an RSC byte count.
The shared `react-initial-completion-v1` boundary replaces load-only cold sampling.
Before entry navigation, the collector installs a React DevTools observer (forwarding
an existing hook) and CDP request observers. It requires document load and an actual
root with `isDehydrated=false` and an element, no pending root lanes, and no fallback
or dehydrated Suspense in the committed Fiber tree. A commit with the frozen passive
mask `10256` must pass `onPostCommitFiberRoot`; a subsequent commit with no passive
work can complete directly. This observes synchronous passive effects and their
scheduled React updates, not just the first root commit. Existing
`data-benchmark-hydrated` leaf-effect markers must also be true. Cold-owned document,
script and stylesheet request identities must settle successfully before cold CPU,
asset/request inventory sampling and the warm trigger. This is not a DOM-presence,
sleep or network-idle heuristic.

Support is limited to the frozen production renderers `19.2.8` and Next's bundled
`19.3.0-canary-cbb046ab-20260731`, whose commit/passive hooks and Fiber fields were
checked. Timeout, absent observer, unsupported renderer or failed initial resource
throws, producing a nonzero/inconclusive run rather than load-only fallback.
This does not guarantee completion of arbitrary asynchronous effect work,
future roots, or background prefetch. Next's native RSC prefetch is unchanged;
pending/aborted RSC remains separately recorded and can still make the run
inconclusive or fail its error budget. `timings.initialBoundary` retains renderer
versions, commit/post-passive states, load/completion/sample/warm timestamps, raw CDP
metrics/paint entries, initial requests and pending-at-warm identities; request
records retain loader/request IDs, initiators, settlement phase, timestamps and
cancellation. Existing raw-trace authentication remains mandatory.

Historical load-only data sampled a different initial-work window and could start
warm navigation while cold-owned modules were unfinished; retained Linux evidence
includes canceled cold scripts. Preserve all prior fail/inconclusive results.
Recollect unchanged-runtime before and final-runtime after with the **same corrected
collector** before comparing them. All 22 metric names/scopes, budgets, five runs,
two warmups, alternating order, uncertainty rules and peer defaults remain unchanged.
Four-app readiness smoke establishes correctness, not a performance PASS.
The `transferred*Bytes` asset budgets use decoded CDP `Network.dataReceived`
byte counts; `compressed*Bytes` uses encoded bytes from the same network events
(the body, excluding headers). The raw transfer total comes from
`Network.loadingFinished`. A completed response without decoded-byte events is
inconclusive, not a fabricated zero-byte body. Genuine `Network.loadingFailed`
requests remain in `errorRate`; an uncompleted speculative prefetch at the
capture boundary is recorded separately as pending and makes the run
inconclusive without counting as a completed success or failure.
Raw entries also record content encoding and cache-dependent request counts.
These are loaded asset costs; a cache hit must not be reported as a fresh wire transfer.
Separate `text/x-component` response bytes are recorded as
`rscResponseWireBytes` in the raw artifact, apart from JavaScript assets and
CDP main-thread work. Next.js may also inline RSC data in the initial HTML;
zero separate RSC bytes does **not** mean zero RSC payload or total page cost.
The `requestCount` and JS/CSS budgets cover the initial public listing only,
matching the PR smoke. All subsequent navigation and throughput requests remain
in the raw request inventory and `fullJourneyRequestCount` trace field.
Fluo serves its benchmark static assets with gzip when the browser advertises
it; an uncompressed Fluo response cannot be compared to a gzip-compressed peer
under the `compressed*Bytes` budgets. The browser trace records each response's
`contentEncoding` and `cacheControl`; `matched-cache` disables browser cache
reuse for every application through CDP, while `native` retains each host's
default policy. It does not rewrite response cache headers or force one
compression codec: the measured hosts may deliver gzip, Brotli, or identity
bytes. Relative encoded-byte bands compare **delivered wire cost under each
host's recorded encoding**, not equal-codec compression ratios. Neither mode
makes session responses public-cacheable.
Historical CPU/RSS are post-workload `ps` snapshots of the actual server PID.
FA-V2 replaces displayed CPU with authenticated unrounded lifetime ticks and
retains RSS; neither is request-interval CPU. The trace records generator PID, CPU, and RSS alongside the
server sample; inspect competing processes and generator headroom before
interpreting throughput or inferring capacity.

`config/representative.json` drives separate development runs against each
framework's dev command. The Fluo fixture uses `src/fluo-dev.mjs` to launch the
canonical `fluo dev --runner fluo` Vite middleware lifecycle. React and CSS
edits use browser-visible updates; server edits wait for application-generation
readiness and reload the document to observe the changed marker. These are
measurements of the seeded fixture through canonical Fluo development, not a
production-build restart proxy or proof of peer development parity. The three
peer fixtures run their own development commands. TanStack's route loader edit
in `src/routes/index.tsx` is measured by restarting its development server
and opening the changed page: its Vite client update is not a reliable
server-edit visibility signal. The recorded server-edit time includes that
restart instead of claiming automatic HMR. Next.js CSS and server edits also
restart and reopen the fixture because their updates did not reliably become
visible in the browser. These restart paths do not measure native CSS/server HMR;
the raw timing records `method: dev-server-relaunch`. Each React, CSS, and server edit starts a
fresh development server and browser so earlier edits cannot contaminate
later measurements. Every experiment edits a real source file, subscribes
to the relevant browser-visible change before the edit, and restores the
original bytes afterward. Cold-ready
includes the first usable HTTP page. Production servers are stopped before
development edits to prevent build output from contaminating production
samples. Raw production and development traces remain separate and a combined
trace names both sources. An unavailable edit is inconclusive, not zero.

## Ownership

Fluo's HTTP dispatcher retains route/DTO/guard/status/cookie/response ownership.
The benchmark does not invent a second public matcher, action router or RPC path.
The HTTP/DI suites retain their local-only policy. #3884/#3885 own measured
optimizations; #3876/#3877 own dev performance changes; #3879 owns final full
user-journey acceptance. This suite's incomplete fixtures must never be presented
as product completion evidence.
