# #3939 measurement and rejection report

The 2026-10-13 verdict is headroom `NOT_ESTABLISHED`, performance `INCONCLUSIVE`.
The lead stopped #3939 candidate selection under the frozen calibration policy.
There is no A/A, CPU/allocation profile, runtime candidate, BEFORE/AFTER run,
or benefit evidence. This report does not declare the issue closed, the lane done,
or a PR ready, and does not reinterpret prior report-only close authority.
The starting head remains
`ce70426f3bf29430c4eb941f8e94baaf8f78d364`; the accepted preflight digest is
`59bd0578c5701d29210ee000812732034981284b578d0b4abee296d89c9ad6ba`.
The measured source was a dirty prepared checkout on this head; the head alone
cannot reproduce it. Source/build/lockfile hashes in `frozen-windows-02.json`
bind the run.
The lead schedules every performance run exclusively, after other builds stop.
The measured Fluo server is the Windows desktop WSL2 environment; the Mac is
only the independent HTTP load generator. `AWAITING_LEAD_MEASUREMENT` in
`current-policy-collector-integrity.json` and `collector-integrity-preparation.json`
describes the earlier preparation checkpoint. Preserve those documents; the
current decision references the lead verdict below.

## Corrected collector completion

`results/issue-3939/headroom-windows-02/` contains 132/132 original records:
11 fixtures × 2 configurations × 3 pairs × 2 arms, with 64 total connections,
3-second configured warmup, and 10-second configured measured duration for every
condition. Observed autocannon wall durations can be 11 seconds; neither the
configuration nor any retained measurement has been changed.
The paired arm order is `1/4`, `4/1`, `1/4`.
There were 10,390,826 completed measured requests, zero traffic failures, and zero
invalid attempts. The lead verdict confirms every shard hash and server/generator
identity. This documentation task did not run traffic or repeat those identity
authentications.

For each pair, compute `sum(4-worker requests.average) / 1-worker requests.average - 1`,
then take the arithmetic mean of three pairs. Four of 22 conditions exceed the
frozen 3% mean gain limit. This table rounds for display; original values remain.

| Condition | Mean gain |
| --- | ---: |
| `json-large/equivalent` | 4.6180% |
| `ascii-large/default` | 3.3485% |
| `utf8-large/default` | 4.0261% |
| `buffer/equivalent` | 11.6246% |

The corrected collector's functional success establishes response validation and
collection for this run. It does not establish generator/network headroom, A/A
stability, or production runtime performance improvement. Small mean gains in
the other 18 conditions do not prove capacity either. This diagnostic changes
generator count against the same server source; it is not BEFORE/AFTER.
Do not weaken thresholds, remove outliers, retry unchanged, or repeat until PASS.

## Preserved historical failures

The lead stopped the earlier Mac-server headroom attempt after retaining
12/132 records: increasing generators from one to four raised first-condition
throughput by 57%-128%. This is rejected environment diagnosis, not Windows
server performance, successful calibration, or optimization evidence.

The Windows headroom attempt retains 60/132 completed records. Its UTF-8 warmup
failure (318 body mismatches among 4,414 HTTP 200 responses) identified pinned
autocannon's fragment decoding defect, not incorrect Windows response bytes.
The completed scaling breaches remain independently unresolved:
`json-small/equivalent` +13.2% and `utf8-small/default` +9.84% mean throughput.
The retained scaling verdict also includes `json-large/default` +3.6185% and
`json-large/equivalent` +3.9555%. Collector repair and completion of the new run
do not erase these four scaling failures or the UTF-8 failure, or reclassify
the old run as PASS. Preserve originals/manifests; this report grants no rerun
authority.

`traffic.ts` uses the existing pinned autocannon `setupClient` hook to decode
received fragments per queued response. Request-specific body/status checks,
parser events and timing remain in place; installed modules are untouched.
New collectors write immutable `record-N.json` and `failure-N.json` originals
plus a small `raw.json` hash/byte-length index using the existing EvidenceJournal.
`evaluate-aa` reads and authenticates one original at a time, retains only
metrics/nonces, and binds its report to `rawIndexSha256`. Missing, altered,
unindexed, reordered or outside-root originals fail closed with retained report.
Historical monolithic raw remains readable but cannot become current calibration;
non-CALIBRATED `evaluate-aa` verdicts exit nonzero. No old raw is rewritten or migrated.

## Immutable design and prerequisites

This section references the frozen prospective contract and historical
preparation recipe. A new freeze or measurement is not a remaining task;
do not execute these procedures after this rejection verdict.

`src/issue-3939/plan.ts` owns the machine design and its SHA-256;
`src/issue-3939/fixtures.ts` owns exact response bytes, lengths and hashes.
The primary condition is `json-large/default/64`. Paired 95% intervals use
Student's t with four degrees of freedom on five paired relative changes.
The minimum is 20,000 validated completions per ordinary sample and CPU
quantization no greater than 1% of measured CPU. These are prospective gates,
not historical evidence. The complete A/A matrix has 440 fresh server arms
(11 fixtures × 2 configurations × 2 connection levels × 5 pairs × 2 arms);
warmup and traffic alone take 22,000 seconds, excluding startup/teardown.
Do not replace that finite matrix with a passing subset.

Install both frozen dependency graphs and build the Node dependency closure
before compiling. The benchmark's complete typecheck additionally requires
the other benchmark-linked platform declarations.
The following is a historical preparation recipe, not a current execution
instruction. This documentation work unit ran no install, build, test, or
measurement. Its lead-assigned limits are not a new user authorization.

```sh
cd "$WINDOWS_MEASUREMENT_WORKTREE"
pnpm install --frozen-lockfile
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace install --frozen-lockfile
pnpm --filter '@fluojs/platform-nodejs...' build
cd tooling/benchmarks/http-comparison
pnpm exec esbuild src/issue-3939/server.ts --bundle --platform=node --format=esm --target=node24 --packages=external --tsconfig-raw={} --outfile=dist/issue-3939/server.mjs
pnpm exec esbuild src/issue-3939/load-client.ts --bundle --platform=node --format=esm --target=node24 --packages=external --tsconfig-raw={} --outfile=dist/issue-3939/load-client.mjs
```

The lead copies the final prepared source into the Windows measurement worktree
and stages the issue-owned `load-client.mjs` as `load-client.mjs` beside the Mac
generator install. It reuses `shoot` and
the existing `load.ts` SSH transport; it adds actual executable and generator
lockfile hashes to each returned measurement. Existing generator dependencies
must resolve the external imports. No remote installation or SSH transport
implementation is part of this change. Inside Windows WSL2, unset
`BENCH_SSH_CONTROL` unless a valid Windows-side socket has deliberately been
configured. The existing Mac master socket is not valid in Windows. The
original shared generator entry does not return the
required executable/lockfile attestation and is deliberately rejected here.

The lead supplies an observed identity JSON; no unknown/default identity is
accepted. It contains `server` and `generator` objects with nonempty
`hostname`, `os`, `arch`, `nodeExecutable`, `nodeVersion`,
`nodeExecutableSha256`, `power`, `network`, `resourceLimits`,
`backgroundWorkload`. The generator also requires `lockfileSha256`.
It also requires `clientEntrySha256`, matching the issue-owned compiled client.
Both runtime versions must be Node 24; host names must differ.
Top-level fields are `bindHost`, `serverHost`, `sshHost`, `remoteDirectory`.
The server's executable path must be its real path. `bindHost` and `serverHost`
identify the Windows WSL2 server; `sshHost`, `remoteDirectory`, and any
`BENCH_SSH_CONTROL` control connections to the Mac generator; the socket itself
must exist on the invoking Windows host. The lead must observe these
role-correct values anew; the previous transport direction must not be reused.
The earlier direct HTTP ten-request setup check remains historical
connectivity/correctness only.

Freeze after all preparation finishes. A new file is required; overwrite is
rejected. Source, linked package source/build files, both lockfiles, runtime
and hosts are bound. The dirty prepared checkout is explicitly recorded:
do not commit, edit, rebuild, or change transport after freezing.
No old calibration receipt is reusable. Freeze real server/generator identities
in the Windows measurement worktree after the final source copy.

## Lead-only commands

The following records the invocation shape for the collected `headroom-windows-02`
run. Do not rerun after this verdict or overwrite the existing output.
Do not rewrite the frozen manifest for the Mac checkout. The Windows execution
worktree was `/home/wpfek/fluo-http-performance-3939-3943-20261013/.worktrees/issue-3939`.

```sh
cd /home/wpfek/fluo-http-performance-3939-3943-20261013/.worktrees/issue-3939/tooling/benchmarks/http-comparison
unset BENCH_SSH_CONTROL # No deliberately configured Windows-side socket.
pnpm exec tsx src/issue-3939/experiment.ts headroom \
  results/issue-3939/frozen-windows-02.json results/issue-3939/headroom-windows-02
```

`RAW_NOT_EVALUATED` in the collector log and `NOT_EVALUATED` in the original index
are collection states and remain untouched. The separate lead verdict records
the evaluated `NOT_ESTABLISHED` / `INCONCLUSIVE` result.
Do not execute A/A, profiles, candidate, or BEFORE/AFTER commands.
The limitation that allocation sampling cannot establish exact native/external
Buffer allocations or total Node encoding cost remains.

## Immutable artifacts and roles

The following paths are relative to `tooling/benchmarks/http-comparison/`.

| Artifact | SHA-256 |
| --- | --- |
| `results/issue-3939/frozen-windows-02.json` | `f73658945e12343d762c6b5ee26d7d9eeeaee1930eb714679e9314c41878bc12` |
| `results/issue-3939/headroom-windows-02/raw.json` | `8fff8d6733f2b1f9fca512d067a50afe57cf180093893c5b65d527bc5b1d9346` |

The index owns SHA-256 and byte length for originals `record-0.json` through
`record-131.json`. The design digest is
`1277f395bf77dc44822086cd4da5981b794343e404d02cdd49e908bbd59bbf36`;
the prepared build artifacts digest is
`8e2a2621a017b0180be2fddf5d3d8405cc30f013954d2b7e33cab167a4c00fa2`.

The lane evidence root outside this worktree is
`/Users/ayden/Documents/fluo/.omo/verification/http-performance-3939-3943-20261013-1a832301/`.
Its `headroom-windows-02-verdict.json` SHA-256 is
`824f5fbce13e9e473bc769c739d7e321e776b97bb76eab03b964318edb72cf20`;
`headroom-windows-02.tar.gz` SHA-256 is
`c586b566d86ac0c258c8fa5c164e11e5c3a55f3fbdbb9654d47a90dc227aae62`.
The archive is outside this worktree and is not a documentation edit target.
These are local preserved artifact references, not public download links.
Historical Windows evidence in that root is `headroom-windows-01-raw.json`
(`616c7586c050a1df5d5e4957ac6a3eaa4dcfaf37f674fa4a4e2c9492c660b801`),
`headroom-windows-01-scaling.json`, and `windows-headroom-utf8-incident.json`.
Wrong-role evidence is `results/issue-3939/headroom-01/raw.json` and `frozen-01.json`.

The Windows server is `DESKTOP-VLEUB8O`, WSL2 Linux x64, Node `v24.21.0`,
`/opt/fluo-tools/node-v24.21.0-linux-x64/bin/node`.
The Mac generator is `mac-mini.local`, Darwin 27.2.0 arm64, Node `v24.20.0`,
`/Users/ayden/.nvm/versions/node/v24.20.0/bin/node`.
The server binds `0.0.0.0` and serves HTTP at `192.168.0.10:35711`.
The Mac at `192.168.0.129` sends direct LAN HTTP; SSH
`ayden@192.168.0.129` is control only, not an SSH data tunnel.
The frozen manifest owns the original resource limits, power, background
workload, and executable/client/lockfile hashes.

Exact commands for artifact inspection and reproducing the arithmetic means
from the lead's retained pair values without measurement are in
[evidence-receipt.md](./evidence-receipt.md).

## Focused verification and retained evidence

The following commands reference existing verification paths; none ran during
this documentation task.

```sh
pnpm vitest run packages/platform-nodejs/src/node/node-response.test.ts \
  packages/platform-nodejs/src/node/node-response.compression.test.ts \
  packages/platform-nodejs/src/node/node-response.compression-recovery.test.ts \
  packages/platform-nodejs/src/node/node-response.wire.test.ts \
  packages/platform-nodejs/src/index.test.ts \
  packages/testing/src/portability/http-adapter-portability.test.ts --maxWorkers=1
pnpm --filter @fluojs/platform-nodejs typecheck
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace test
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace typecheck
pnpm exec biome check packages/platform-nodejs/src/node/node-response.wire.test.ts \
  tooling/benchmarks/http-comparison/src/issue-3939/
```

The new Factory fixture test performs one bounded correctness request per
fixture, with no performance interpretation. Wire regressions preserve
observed HEAD/204/205/304/206 behavior rather than changing status policy.
Existing compression/recovery tests retain decline/handled, pre/post-commit
failure and disconnect coverage. Raw check logs are under
`results/issue-3939/`. The designated profile output path is
`results/profiling/issue-3939/`; no profiles were collected in this performance
investigation. Historical evidence is untouched.
No public package runtime optimization is shipped. This documentation task
changes no source, tests, manifests, or raw records, and adds no Changeset.
The local implementation commit retains the earlier private benchmark harness,
collector correction, tests, and authored policy JSON companions. Under
`CONTRIBUTING.md`, private benchmark/report changes and test-only package coverage
do not change published package behavior, API, contents, or release metadata;
therefore no Changeset is required. The separate check/source receipt binds
historical functional checks to unchanged source, not to fresh performance runs.
Book and package README edits are unnecessary: this records measurement
diagnosis and rejection without changing framework contracts or consumer usage.

Remaining requirements are lead reconciliation of the final diff and companion
artifacts against the accepted preflight, then contract/code/verification reviews
of the final exact head. Before publication, a completed verification receipt
bound to that head and required EN/KO semantic/documentation checks are needed.
Authorized PR publication and exact PR-head canonical selected GitHub CI follow;
a changed head requires affected reviews/checks again.
This task ran no docs CI, full local CI, review, or publication.
This report alone grants no merge, issue-close, or lane-completion authority.
