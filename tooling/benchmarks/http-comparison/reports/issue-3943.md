# Issue3943 local preparation

Status: `LOCAL_HEADROOM_REJECTED`. Final local completion requires the gates below.
Performance, deployed CPU/tail/cold-warm
behavior, production benefit and candidate adoption:
`NOT_ESTABLISHED`. No production runtime or package API change is proposed.

## Final local diagnostic checkpoint: 2026-10-13

Topology correction validation passed: private harness 13/13, workerd 12/12,
full benchmark 453 passed, zero failed, one existing Linux-only skip on Mac.
Typecheck and scoped lint passed. Five comparison-removal mutations produced
assertion-level RED and restored GREEN. Exact commands and logs are retained in
`results/issue-3943/topology-checks-20261013-1791905415999/topology-validation.json`.

The parent then prepared Windows WSL2 Node 24.21.0 and the independent Mac
Node 24.20.0 generator. Both real LAN workload correctness probes passed.
The frozen input binds 3,866 artifacts; SHA-256:
`617899c1a4dbcc07c60b334177c7eae822596be003e25939eb7d3e9c3503408b`.
The finite headroom cohort completed 12/12 arms and 502,195 measured requests
with zero traffic errors. Evaluation failed: stage-minimal/one-generator
throughput CV was `0.030138222108850293`, above the frozen `0.03` limit.
The manifest retains this evaluation failure as one invalid-attempt entry;
it is not a failed traffic request or an incomplete cohort.

Calibration remains `NOT_ESTABLISHED` and performance `INCONCLUSIVE`.
No A/A, profile, candidate, BEFORE/AFTER or Cloudflare deployment followed.
No threshold was relaxed and no additional cohort was run.
Raw records are under `results/issue-3943/headroom-windows-01/` and the freeze
under `results/issue-3943/parent-prepared-01/`. The outside-worktree archive
`headroom-3943-windows-01.tar.gz` has SHA-256
`772764afac0bebd8bb5f4dc8f33b333f0371ce4937f3aafc799a9aa5973a9c29`.
On 2026-10-13 the user selected local-result completion: publish diagnostic
tooling, regression tests and this rejection report, with optimization deferred
and Cloudflare measurements excluded. Local issue closure is authorized after
focused verification, exact-head reviews, GitHub CI and merge. Historical raw
`issueClosure: BLOCKED` describes the pre-approval capture, not this final scope.

The preparation instructions and earlier checkpoints below are historical.
Their unrun/pending statements describe those earlier stages, not this checkpoint.

## Local diagnostic entry

The accepted LOCAL topology is Windows WSL2 SERVER plus an independent physical
Mac generator over the already-authorized LAN/SSH control path. LOCAL excludes
Cloudflare deployment; it does not mean co-located processes. After source
validation, host reservation and the frozen diagnostic execution release:

```sh
cd tooling/benchmarks/http-comparison
node --import tsx src/issue-3943/experiment.ts /absolute/parent-frozen.json unique-run-id
```

This is the only issue-owned collection entry. It performs no install, build,
deployment or external Internet load. WSL2 needs existing `dist/fluo-workers`;
it does not need a local generator executable or `dist/load-client.mjs`.
Existing shared `load()` SSH support runs `<remoteDirectory>/load-client.mjs`
on the Mac. Results use a new, exclusive
`results/issue-3943/<run-id>` directory; an existing ID fails before writing.

The parent-frozen JSON contains `issue:3943`, the exact exported `DESIGN`,
`phase:"headroom"|"aa"`, absolute `parentReceipt`, `artifacts` (absolute file
paths to SERVER-local SHA256 hashes), `capacity:{path,sha256}`, `transport` and
`generator`. `transport` binds `kind:"ssh-lan"`, private `serverHost`,
`serverPort`, explicit `bindHost`, `sshTarget:"user@private-Mac-IPv4"`,
`remoteDirectory` and `sshControl` (absolute control path or null).
`BENCH_SERVER_HOST`, `BENCH_BIND_HOST`, `BENCH_SSH_HOST`, `BENCH_REMOTE_DIR` and
`BENCH_SSH_CONTROL` must exactly match it; no co-located fallback is allowed.
Both serving-identity checks receive the frozen server host explicitly.
The generator version is
`process.version` (for example `v24.11.0`), not `process.versions.node`
(`24.11.0`). `generator.host` binds hostname, actual Mac hardware UUID, darwin,
architecture and actual Node version. `generator.directory`, `roles` and
`artifacts` bind the observed remote executable, client entry, declared and
installed locks, and autocannon entry/manifest paths and hashes.
`generator.evidence:{path,sha256}` identifies a copied, hash-bound parent
receipt on WSL2, not a remote executable to open there. Its payload is
`{issue:3943,origin:"actual-in-generator-observation",generator:{host,directory,roles,artifacts},instrumentation:{execArgv:[],nodeOptions:null}}`.
Remote paths stay in that remote namespace; WSL2 hashes only its own source,
build/runtime/locks, raw capacity evidence and receipts.

The hashed parent receipt contains `issue`, `phase`, `rootBuildExitCode:0`,
`design`, `transport`, `generator` and `artifacts` equal to the frozen SERVER map
excluding the receipt itself.
This is a parent-owned release and build/source binding, not a child assertion
that a hash establishes causation. A/A additionally requires
`capacityReview:"accepted"` and an absolute `headroomManifest` in the frozen
map. That manifest must retain12 observations, one headroom verdict, the same
design and zero invalid attempts. The parent must review the manifest's raw
artifact hashes, independent generator/network capacity and completed build
evidence before writing its receipt.

Headroom and A/A are separate released invocations of the same CLI. Headroom
cannot automatically continue into A/A. Two workloads (`stage-minimal`,
`json-command-local`) use default configuration only:

- Headroom:64 total connections,1/4 generators, three alternating pairs,
 3-second warmup and10-second capture,12 arms.
- A/A:1/64 connections, five alternating A1/A2 pairs per workload/connection,
 10-second warmup and40-second ordinary capture,40 arms.
- Ordinary completion minimum:10000; process CPU quantum fraction at most1%.
 Throughput and process-CPU/request arm CV at most3%, paired mean drift at
 most3%, p95/p99/RSS paired drift at most5%. Headroom mean gain at most3%.
- Independent pair ratios,95% bootstrap interval,10000 resamples, seed3943.
 No outlier removal, retries, overwrite or automatic extra repetitions.

The issue-owned `generator.ts` is a thin identity entry around shared `shoot()`,
not a second traffic collector. The parent builds it as the Mac's
`load-client.mjs` in the frozen remote directory, next to or below its actual
declared/installed dependency locks. Its internal `--identity` control mode
emits actual process/hardware/file observations for the parent receipt; the LAN
control is already authorized. Declared `BENCH_GENERATOR_*` values cannot replace
actual executable, entry or lock reads. No transport or identity control changes
the frozen traffic counts, durations or numerical gates.

Shared `load()` and `shoot()` retain exact status/body checks. Every first-request,
warmup and ordinary response independently authenticates actual pre/post
generator hashes, physical host/runtime/client identity, absent instrumentation,
fresh nonce and the hash of its actual wire request (including a one-shot token).
One-shot PIDs may differ; the frozen physical Mac/executable/client may not.
Original request and phase results are saved independently before identity/metric
guards. `prepareTimingIdentity`, `authenticateTimingIdentity`, `RawCapture`,
`EvidenceJournal` and `monitorServer` retain serving evidence, raw bytes,
failures, interruption state and process resources. Process CPU remains a local
host diagnostic. First-request observations are separate and are not deployed
cold/warm evidence. Local multi-generator intervals are overlapping, not a claim
of exact simultaneous starts.

## Remaining gates

The lead found a concrete topology mismatch before Windows execution: the prior
collector used `LocalLoadSession`, rejected SSH and read the Mac executable as a
server-local artifact. That prior source is superseded, not accepted topology
evidence. The source correction changes only issue-owned source/tests/reports;
shared `load.ts`, `targets.ts`, `timing-identity.ts` and profile tooling are not
changed. Numeric `DESIGN` is unchanged. No timing has occurred.

Current correction tests are source-ready but unrun: remote executable absent
on the server, receipt byte tampering, LAN transport drift, different one-shot
PIDs, runtime/client/lock/request drift, instrumentation refusal and actual
hashes ignoring declared env values. The prior checkpoint files below are
preserved unchanged and describe their prior source hashes only. Current
harness/typecheck/lint require the parent's next host/check release; package
suites need not repeat.

Package validation completed on2026-10-13: Workers42/42 and runtime Web32/32
passed; Workers and runtime package typechecks exited0. The initial focused run
retains two new lifecycle-test timeouts: ordinary `send()` did not expose an early
response. The corrected tests exercise real SSE EOF before handler completion,
including handler failure. No production runtime fix was needed.

Evidence is in `results/issue-3943/package-checks-20261013-1791891602920/`,
including the original `focused.log`, both typecheck logs, and the passing
`retry-sse-eof/` logs. `package-checkpoint.json` binds the checks to the unchanged
HEAD, accepted preflight and four tested source hashes. The initial root Vitest
command's existing globalSetup ran dependency build closures; retrying through
existing package configs avoided repeating those builds.

Before topology correction, the private issue3943 harness passed 9/9 tests. Its byte fixtures and invalid
CLI-freeze test need no manually prepared private `dist` output. Artifact and
generator comparison removal each produced assertion-level RED (exit1), and
restoring each comparison produced GREEN (exit0). `identity.ts` was restored
byte-for-byte to SHA256
`b57d1626a171f6535643d9523c9be207795058fc3264cff2dc30967b669f1bbd`.
Isolated benchmark typecheck and scoped lint (8 TS and2 MTS files) also exited0.

The initial scoped lint failed with three errors. The statement-only `forEach`
callback and issue-owned condition cleanup were corrected without disabling
rules. Real filesystem regression cases preserve operation failure, cleanup
failure, and both together through `EvidenceJournal`; no original failure is
overwritten by cleanup. Original lint and intentional mutation failures remain
in `results/issue-3943/harness-checks-20261013-1791892537593/`.

After the parent released the shared native-workers port, the full isolated
benchmark suite, including `workerd.test.mts`, completed exit0 in94.497 seconds:
450 tests,449 passed, zero failed, one Linux-only CPU-counter test skipped on
macOS (`tests/resources.test.mts:109`). The workerd bind, real HTTP identity
including same-length bundle-byte tampering, and interrupted-process tests passed.
That historical run finished. No test/build is running for this correction.
Previously passed package suites were not
repeated; their only later edit was the equivalent statement-only cleanup callback.
Root provisioning is already
complete; do not repeat root install/build without a missing prerequisite.
No performance measurement has been made by this preparation.

Final check commands, original failures, restored source hashes and raw-log paths
are bound in
`results/issue-3943/harness-checks-20261013-1791892537593/harness-checkpoint.json`.

The frozen prospective profile matrix remains blocked: two workloads, CPU and
allocation modes, two repeats, eight captures,10-second warmup,
10-second control/20-second capture/10-second control. The existing shared
profile collector does not retain every warmup original or authenticate the
complete frozen source/generator boundary. Its API therefore is not invoked as
an accepted issue3943 capture, and no duplicate collector or unsupported profile
fallback is added. The parent must resolve that shared ownership gap and release
profiles after valid local prerequisites; request_factory profiles are not used.

The deployment blocker is missing authorization, target and telemetry evidence,
not an inherent platform limitation on CPU/allocation capture. Deployment still
needs a concrete approved account/project, endpoint, deployment
and source identity, external-load scope and host reservation, cost limits,
CPU/tail/cold-warm telemetry access, and a separately frozen deployed numerical
design. Local workerd evidence cannot replace any of those inputs.

Test-only coverage and private benchmark tooling do not change published
behavior or package contents; no Changeset is required for this preparation.
