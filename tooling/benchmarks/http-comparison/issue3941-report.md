# #3941 Fastify final local disposition

## Final disposition / 최종 판정 (2026-10-13)

The finite Windows Fastify server / independent Mac generator A/A prerequisite
completed **120/120 arms**, **23,255,005 measured requests**, zero traffic errors
and zero invalid attempts. The numeric evaluator returned **FAIL in 11/12
conditions**. Calibration is **NOT_ESTABLISHED** and performance remains
**INCONCLUSIVE**. This is a completed failed prerequisite, not missing data and
not an optimization win. The first-to-last measured span was **8522.004 seconds**,
from `2026-10-13T12:09:06.714Z` to `2026-10-13T14:31:08.718Z`.

Windows Fastify 서버와 독립 Mac generator의 유한 A/A 선행 검증은
**120/120 arms**, **23,255,005 measured requests**를 완료했습니다. Traffic 오류와
invalid attempt는 모두 0이지만 **12개 조건 중 11개가 수치 기준 FAIL**입니다.
Calibration은 **NOT_ESTABLISHED**, 성능 판정은 **INCONCLUSIVE**입니다.
원본이 누락된 상태가 아니라 완료된 선행 검증의 실패이며, 최적화 이득을 뜻하지
않습니다. 실제 첫 측정부터 마지막 측정까지의 기간은 **8522.004초**입니다.

| Condition / 조건 | Failed metrics / 실패 지표 |
| --- | --- |
| read-search-local/default/1 | cpu |
| read-search-local/default/64 | throughput, cpu, p99, rss |
| read-search-local/equivalent/1 | none (numeric gates only / 수치 기준만 통과) |
| read-search-local/equivalent/64 | throughput, cpu, p99, rss |
| json-command-local/default/1 | throughput, cpu |
| json-command-local/default/64 | throughput, cpu, rss |
| json-command-local/equivalent/1 | p95, p99 |
| json-command-local/equivalent/64 | throughput, cpu |
| rest-route-mix-local/default/1 | throughput, p99 |
| rest-route-mix-local/default/64 | throughput, cpu, rss |
| rest-route-mix-local/equivalent/1 | throughput, cpu, p99 |
| rest-route-mix-local/equivalent/64 | throughput, cpu, p95, p99, rss |

The authoritative parent verdict is
`/Users/ayden/Documents/fluo/.omo/verification/http-performance-3939-3943-20261013-1a832301/aa-3941-windows-03-verdict.json`.
The complete copied cohort is
`results/issue3941/0e121b649e58fb8d644889bc771514c9c33b30d34edc6d5d77a8c4420252a360/`.
All 120 raw SHA references and serving/generator identities were independently
checked by the lead. The external complete archive is
`/Users/ayden/Documents/fluo/.omo/verification/http-performance-3939-3943-20261013-1a832301/aa-3941-windows-03.tar.gz`,
SHA-256 `2e14c5dad95d7a26df9cf42850de73c2f9f026f9765d7de6f8a2483b5764ae07`.
The bounded committed disposition is `results/issue3941/final-disposition.json`;
the source/check receipt is `results/issue3941/local-checks.json`.

부모의 authoritative verdict와 전체 archive는 위 절대 경로에 보존되어 있습니다.
120개 원본 SHA와 서버/generator identity는 lead가 독립 확인했고, 전체 cohort는
위 issue-owned 디렉터리에 복사되어 있습니다. 원본 matrices/logs/dist/cache는
커밋하지 않으며 삭제하거나 덮어쓰지 않습니다. 커밋에는 bounded disposition과
source/check receipt, 실행 및 테스트에 필요한 authored companion만 포함합니다.

The failed prerequisite ends this finite path. **No headroom, profiles, candidate
or BEFORE/AFTER**, extra repeats, threshold changes or fresh performance follow.
The evaluator's observed `noiseEnvelope` is not calibrated and cannot relax any
gate. Actual header snapshot/search/normalization CPU and allocation costs remain
unestablished; no bottleneck, candidate or gain is inferred from this A/A failure.
No production runtime optimization or public API change is shipped.

실패한 선행 검증으로 이 유한 경로를 종료합니다. **Headroom, profile, candidate,
BEFORE/AFTER는 실행하지 않으며**, 추가 반복이나 threshold 변경도 없습니다.
관측된 `noiseEnvelope`는 calibrated 값이 아니고 gate 완화에 사용할 수 없습니다.
헤더 snapshot/탐색/정규화의 실제 CPU·allocation 비용은 아직 입증되지 않았습니다.
A/A 실패만으로 병목이나 후보, 성능 이득을 추론하지 않고 production runtime과
public API를 변경하지 않습니다.

Keep the three earlier incidents separate: the Windows bind failure had
30 connection errors and zero responses with listener `127.0.0.1:33910`;
the tee wrapper failed after 40 passing tests because its log directory was absent;
the runtime-format protocol failure retained **1/120 arms** under cohort
`77a0a537c3e8365ac1b4735adbb42101de6ab9d9e36ff40cd93c41de5d924145`.
None is relabeled as calibration or merged into the completed cohort.

이전 Windows bind 실패(30 connection errors, 응답 0), 40개 테스트 통과 후 로그
디렉터리 부재로 실패한 tee wrapper, **1/120 arms**에서 멈춘 runtime-format
protocol 실패는 각각 별도 기록으로 보존합니다. 새 cohort의 완료가 과거 실패를
성공으로 바꾸지 않습니다.

The accepted release-readiness no-suite fix, its declaration and focused tests
remain included: only actually absent apps tests are not applicable, future real
apps tests are automatically selected, coverage loss and selected failures still
reject, and build/typecheck/non-apps commands remain. The original full release
exit-1 log is preserved at `results/issue3941/checks/governance.log`, SHA-256
`3157c358972772428d995cf0b5de85677f0a57ebec2f734c174add41535c64b5`.
Full release/workspace/local CI was **not rerun**, and is not claimed PASS.

승인된 release-readiness no-suite 수정과 declaration/test를 유지합니다. 실제로
없는 apps suite만 적용 제외이며, 새 실제 suite는 자동 선택하고 coverage loss와
선택된 명령 실패는 계속 실패로 처리합니다. Build/typecheck/non-apps 명령은
유지합니다. 기존 full release exit-1 원본은 위 hash로 보존합니다.
Full release/workspace/local CI는 **재실행하지 않았으며 PASS라고 주장하지 않습니다**.

No Changeset is required: only package test coverage and private benchmark/release
tooling change; published package runtime, API, contents and release metadata do
not change. Local completion returns one ordinary verified commit and the exact
stage Result. New exact-head reviews and CI belong to the parent.

공개 package의 runtime/API/배포 내용/release metadata를 바꾸지 않고 package test와
private benchmark/release tooling만 변경하므로 Changeset은 필요하지 않습니다.
로컬 완료는 검증된 일반 커밋 하나와 정확한 stage Result로 반환하며, 새 exact-head
review와 CI는 부모가 담당합니다.

## Final focused checks / 최종 focused 검증

The final self-preparing harness passed **51 tests**, zero failures/skips,
exit 0 (`checks/final-harness-20261013.log`, runner duration 13961.952708ms).
The entry fixture builds its required package dependency closure and compiles
the actual Fastify server into a unique temporary module directory before
startup. The generator identity test builds its own temporary esbuild bundle.
Neither reads a manually prepared private benchmark dist/bundle, replaces a
real-listener assertion, nor overwrites the frozen measurement build or generator.

최종 harness는 **51개 테스트**, 실패/skip 0, exit 0으로 통과했습니다. Entry fixture는
필요한 package dependency closure와 실제 Fastify server를 먼저 build하고 고유한
temporary module 디렉터리에서 시작합니다. Generator identity 테스트도 자신의
temporary bundle을 직접 build합니다. 수동으로 만든 private benchmark dist/bundle에
의존하지 않으며, real-listener assertion을 유지하고 frozen 측정 build/generator를
덮어쓰지 않습니다.

Fastify metadata/adapter, shared Node request and HTTP dispatch/context, and
release focused regressions passed **35 files / 568 tests**, exit 0
(`checks/final-regressions-20261013.log`, runner duration 29.45s).
Fastify package-owner typecheck, tooling declaration typecheck
(`tsconfig.tools.json`), isolated benchmark/test typecheck and platform governance
passed (`checks/final-types-governance-20261013.log`). Changed TS/MJS/MTS lint,
explicit ignored collector companion lint and declaration lint passed
(`checks/final-lint-20261013.log`, `checks/final-ignored-lint-20261013.log`).
Changed code diagnostics were empty; `git diff --check` passed.

Fastify metadata/adapter, 공유 Node request 및 HTTP dispatch/context, release
focused 회귀는 **35개 파일 / 568개 테스트**, exit 0으로 통과했습니다. Fastify
package-owner, tooling declaration, isolated benchmark/test typecheck와 platform
governance도 통과했습니다. 변경 TS/MJS/MTS, ignored collector companion,
declaration lint와 diff 검사가 통과했고 변경 코드 diagnostics는 비어 있습니다.

The additional issue-owned `results/issue3941/tsconfig.checks.json` includes the
collector/dependency/generator TS companions that the benchmark's default glob
does not all include. Its no-emit check passed
(`checks/final-owned-types-20261013.log`); it changes no shared configuration.

기본 benchmark glob에 모두 포함되지 않는 collector/dependency/generator TS는
issue-owned `results/issue3941/tsconfig.checks.json`으로 포함해 no-emit 검사를
통과했습니다. 공유 typecheck 설정은 변경하지 않습니다.

The real-checkout catalog/command-plan probe observed packages 640, apps 0,
examples 16 and tooling 189. It emitted build/typecheck, all three non-apps test
projects and CLI sandbox commands, with apps explicitly `no-suite`. The probe
executed none of those verification subprocesses and does not assert they passed.
The exact source hashes and completed-check/log hashes are in `local-checks.json`;
earlier source preparation receipts and logs remain historical.

실제 checkout catalog/command-plan probe는 packages 640, apps 0, examples 16,
tooling 189를 확인했습니다. Build/typecheck, non-apps test project 3개, CLI sandbox
명령을 유지하고 apps만 명시적으로 `no-suite`로 분류했습니다. Probe는 그 검증
subprocess를 실행하지 않았고 PASS라고 주장하지 않습니다. 최종 source 및 완료된
검사/log hash는 `local-checks.json`에 기록하며 과거 receipt와 log는 역사적 근거로
보존합니다.

## Historical preparation records / 이전 준비 기록

All sections below are retained historical checkpoints. Their old "current",
"remaining" and parent execution commands describe those past checkpoints only;
the final disposition above supersedes them and authorizes no new measurement.

아래 모든 section은 과거 checkpoint 기록입니다. 당시의 "current", "remaining",
부모 실행 명령은 과거 상태만 설명하며, 위 최종 판정이 우선합니다. 새로운 측정
실행 지시로 사용하지 않습니다.

## Runtime-version protocol repair (historical, 2026-10-13)

VERIFIED_SOURCE_PREPARATION. Current receipt:
`results/issue3941/measurement-ready-runtime-version.json`. The accepted
preflight remains `b60b5ea4ddd154a0b233f328ef4ef88df584e9cddaef036e9e05c217fc5bece5`.

The serving attestation copies `process.versions`, so its authoritative
`runtime.node` is `24.21.0`. Frozen environment and generator identities use
`process.version`, so their authoritative version is `v24.21.0`. The collector
now requires a string serving version and compares `v${nodeVersion}` exactly
with the frozen version. Neither original representation is rewritten.
There is no version-range match, prefix stripping, trimming or coercion.
Different runtime, executable path/hash, build hash, authentication status and
instrumentation still fail. Generator version equality remains exact and
prefixed. No shared helper or numeric policy changed.

The full relevant path was inspected: `runScenario` retains the authenticated
serving record; the owned arm retains cold/warmup/traffic/resource originals;
`assertOrder` authenticates the previous raw receipt and calls `sample`;
`evaluateFiles` authenticates raw receipts and `evaluate` calls the same
`sample` before any numeric gates. Prepared/source/runtime checks use the
prefixed environment version, while cold/warmup/measured generators use the
prefixed generator wire version. Synthetic serving fixtures now use the actual
unprefixed format. Complete-matrix/predecessor tests and the real archived arm0
protocol probe exercise these paths; no other representation conversion was
required.

RED: the former comparison rejected the actual byte-authenticated arm0 with
`Original serving identity drift`, exit 1
(`checks/runtime-original-arm0-red.log`). The corrected real-format regression
also failed before the fix, alongside predecessor/evaluation paths; the old
comparison wrongly accepted a prefixed serving fixture
(`checks/runtime-version-red.log`: 11 selected tests, five failures).
GREEN: 51 focused tests, no failures/skips, exit 0
(`checks/runtime-version-focused-green.log`). Different runtime/executable/build
and malformed version cases still reject. Affected typecheck/lint and diff
checks passed (`checks/runtime-version-quality.log`); LSP diagnostics are empty.

The unchanged archived plan and raw arm0 were replayed only through the local
sample parser after checking the original raw byte hash. That offline protocol
probe now returns exit 0 and still rejects a one-row full evaluation as
incomplete (`checks/runtime-original-arm0-green.log`). It does not execute an
arm, inspect current Windows build provenance, resume the old cohort, accept
calibration or create new measurements.

The preserved cohort
`77a0a537c3e8365ac1b4735adbb42101de6ab9d9e36ff40cd93c41de5d924145`
remains INCONCLUSIVE_INCOMPLETE_COLLECTOR_PROTOCOL_FAILURE, **1/120**.
All six copied cohort files retain their original hashes. Parent incident
`adjudication-3941-runtime-version.json` and complete
`aa-3941-windows-02.tar.gz` are untouched; the archive remains SHA-256
`caaa3936ffc8259e045ff802afdb5974a9b3334624a958d64476cab19a05272c`.
Only owned collector, test, report, receipt and new preparation logs changed.
No build, new performance run, remote write or commit occurred here.

Parent: copy the repaired collector and tests, then rebuild/freeze **new**
source-bound files under exclusive host reservation. For unused new paths:

```sh
node --import tsx results/issue3941/collector.ts prepare results/issue3941/prepared-build-windows-03.json
# Construct identities-windows-03.json from that receipt and current generator observations.
node --import tsx src/issue3941.ts freeze results/issue3941/identities-windows-03.json results/issue3941/prepared-build-windows-03.json
# Preserve stdout once as frozen-plan-windows-03.json.
```

Only the parent may authorize a fresh cohort. The incomplete `-02` cohort,
prepared file and plan must not be changed, resumed or reused.

## Bind-host source checkpoint before runtime repair (historical)

VERIFIED_SOURCE_PREPARATION. The current receipt is
`results/issue3941/measurement-ready-bind-host.json`, bound to
`preflight-3941-bind-host.json` digest
`b60b5ea4ddd154a0b233f328ef4ef88df584e9cddaef036e9e05c217fc5bece5`.
The local source fix is ready for parent copying and fresh Windows preparation;
it is not a Windows connectivity or calibration PASS.

The only entry behavior change is:

```ts
FastifyHttpApplicationAdapter.create({ port, host: process.env.BENCH_BIND_HOST })
```

An explicit bind host reaches the existing adapter option. Unset remains
`undefined`, retaining the adapter's original loopback default. Workloads,
modules, headers, durations, matrix, repeat counts, all numerical thresholds and
the finite collector are unchanged. The current executable/policy binding alone
changes to the new preflight. The exact previous policy bytes are retained as
`results/issue3941/frozen-policy-collector-integrity-before-bind-host.json`
(SHA-256 `47800dce7aeea9d5ad2256e99f6b6015ddeda0756d0c0ef49f7fb25969d9276a`).
No public adapter, firewall or shared transport source was edited.

The regression executes the actual `src/fluo/server.ts` in a bounded child
process. Existing `mock.method` seams observe adapter/factory creation while
calling their real implementations. It awaits actual application listen, checks
the real public server address, and closes the app before the child returns.
`PORT=0` gives an owned ephemeral listener without a free-port reservation race;
there are no sleeps or performance requests. The test covers explicit
`0.0.0.0` and unset/default independently.

RED on the original entry: unset passed, explicit host failed because the
adapter received `{port: 0}` without `host`, exit 1
(`checks/bind-host-entry-red.log`). GREEN after the one-line fix:
42 focused tests passed, no failures/skips, exit 0
(`checks/bind-host-focused-green.log`), including both actual entry startups and
the inherited five finite-request UTF-8 correctness cases. Benchmark typecheck,
affected TS/MTS lint, `git diff --check` and only the existing selected Fastify
entry build passed, exit 0 (`checks/bind-host-quality-entry-build.log`).
Affected LSP diagnostics are empty. No root/workspace build, release rerun, full
CI, SSH/remote action, performance, calibration, headroom, profile or commit
was executed by this continuation.

The parent's incident and full correctness failure remain untouched at:

- `.omo/verification/http-performance-3939-3943-20261013-1a832301/adjudication-3941-bind-host.json`
- `.omo/verification/http-performance-3939-3943-20261013-1a832301/windows-3941-correctness-failure.log`

That pre-calibration failure is still 30 connection errors, zero responses, with
the actual observed listener `127.0.0.1:33910`. It is not a calibration sample.
The old Windows `prepared-build-windows-01.json` remains historical. Its parent
copy `prepared-3941-windows-01.json` is preserved at byte SHA-256
`a6d2e57a4b1c570d48ec2f82bb9ccb70df76bf8f8893ef8114c1ddad8e36096b`.
The original Windows preparation terminal remains 24,857 bytes, SHA-256
`a4d04017bc43792d71c8b6bee890674356f7a7743ea896de522d1df2146605e5`.
It records 40 passing tests but wrapper exit 1 because
`tee: results/issue3941/checks/windows-collector-integrity.log: No such file or directory`.
The parent reports its corrected wrapper rerun had 40 tests and exit 0; neither
that report nor the local 42-test GREEN relabels the original wrapper failure.

### Remaining parent preparation

After exclusive host reservation, copy the changed source/test/current-policy
files from this receipt to the Windows checkout. Preserve all prior prepared
files, plans and failed probes. From the real Windows benchmark directory:

```sh
node --import tsx results/issue3941/collector.ts prepare results/issue3941/prepared-build-windows-02.json
node --import tsx src/issue3941.ts freeze results/issue3941/identities-windows-02.json results/issue3941/prepared-build-windows-02.json
# Preserve that stdout once as results/issue3941/frozen-plan-windows-02.json.
node --import tsx src/issue3941.ts command results/issue3941/frozen-plan-windows-02.json 0 results/issue3941/prepared-build-windows-02.json
```

Use unused new filenames if any proposed `-02` path already exists; do not
overwrite or delete old evidence. `prepare` performs the authorized fresh
Windows root/selected build once, not a root build on this Mac. The parent fills
new identities from that new receipt and current actual Mac generator identity,
using the field mapping in the prior collector record below. The unchanged
generator bundle remains SHA-256
`594c330509d10782351e3eb901e4f7547fb3857a2e065128e8928858f63e046c`.
The old prepared manifest and plan cannot be reused after entry/source binding
changes.

Repeat the parent's existing bounded correctness-only probe with
`BENCH_BIND_HOST=0.0.0.0`, verify the actual Windows listener is no longer
loopback-only and the independent Mac receives correct responses. Only then
schedule calibration. No parent command above was executed by this implementer.

## Collector-integrity checkpoint before bind-host fix (historical)

MEASUREMENT_READY_FOR_PARENT_SCHEDULING. The current receipt is
`results/issue3941/measurement-ready-collector-integrity.json`, bound to accepted
preflight `0fafde0038ac0f443b27c731543257d286703cf81be7268ccd75d264b6e0762c`.
Everything below the historical-record heading is preserved prior evidence,
not the current invocation instructions.

The issue-owned collector calls the existing exported `runScenario`; it does
not copy its implementation. `prepare` runs one clean root dependency build,
one clean selected Fastify fixture build, and the owned generator bundle before
the parent freezes the cohort. Every ordinary arm uses a fresh runner and server
process, with source/dependency/build/policy/generator artifact hashes checked
before and after the arm. Its schema-3 output says `freshWorkspaceBuild: false`
and links the actual single preparation receipt. Cold request, warmup, full
traffic, serving identity, client/server resources, teardown failures and
`invalidAttempts` remain in the canonical journal.

The finite `run-aa` command runs exactly the existing 120 ordinary slots in their
unchanged alternating order; it skips diagnostic slots, stops on the first
failure, and refuses an existing cohort directory. Individual arms authenticate
their predecessor and reject overwrites. Original raw JSON has a hash receipt;
evaluation rechecks those bytes, rejects missing/duplicated/reordered/invalid
samples, and evaluates all five A/A metrics for all 12 conditions from the
original samples. Throughput uses requests/second; CPU/request uses original
server CPU seconds divided by original completed requests. Frozen CV, drift,
bootstrap and noise-envelope rules are unchanged. Headroom command emission
requires complete successful A/A evaluation; profiles retain the source-bound
lead-calibration gate. Neither is run automatically.

`dependencies.ts` is an issue-local resolved-byte inventory, shared only by this
collector and its generator. It introduces no package, global configuration or
shared benchmark API. The generator bundle retains the exact inherited UTF-8
collector and reports actual Node runtime/executable hash, declared and installed
lock hashes, client hash and resolved autocannon dependency-byte hash.

### Verified preparation, not performance evidence

- Final focused command: 40 tests passed, zero failures/skips, exit 0, including
  the inherited five finite-request UTF-8 correctness tests and a real
  identity-only invocation of the local generator bundle.
  `checks/collector-final-green-2.log` records the bundle and complete result.
- Benchmark typecheck, explicit owned-generator typecheck, five TS lint targets,
  both MTS lint targets and `git diff --check` passed, exit 0:
  `checks/collector-final-quality-2.log`. Affected LSP diagnostics are empty.
- Hash-comparison-only mutation: removing the one `sha256(bytes) !== expected`
  comparison made all five selected authentication tests fail with missing
  expected exceptions/rejections, exit 1:
  `checks/collector-hash-removal-red.log`. Restoring that exact comparison is
  covered by the final 40-test GREEN. Same-byte-length valid-JSON corruption is
  exercised for artifact bytes, prepared manifest and raw sample receipt;
  inventory changes and transitive dependency corruption are also covered.
- A read-only actual dependency-closure probe resolved 4,764 files:
  `checks/collector-bundle-closure-1.log`. This was not a serving build or timing.
- The first new collector test failed because the collector did not exist:
  `checks/collector-initial-red.log`. The first expanded final run retained two
  failures (generator CLI path canonicalization and missing headroom receipt);
  both were fixed, and its raw log remains `checks/collector-final-green.log`.

No serving/workspace build, full local CI, release-runner rerun, performance
cohort, headroom, profile, candidate optimization, SSH/remote action or commit
was executed in this continuation. Previous dirty package tests, release files
and the original full release-readiness exit-1 log are byte-identical. The local
generator bundle and focused synthetic arithmetic/order/tamper tests are
preparation checks, not calibration or a performance verdict. Nothing is
currently running.

### Exact parent inputs and CLI

Reserve Windows WSL2 server `192.168.0.10` and Mac generator `192.168.0.129`
exclusively. Copy the prepared issue source, inherited traffic files and current
policy to the role-correct Windows checkout. Frozen root and isolated benchmark
installs must exist there. The local Mac preparation build is not server evidence.
Under the parent reservation, from the Windows benchmark directory:

```sh
node --import tsx results/issue3941/collector.ts prepare results/issue3941/prepared-build.json
```

Preserve stdout/stderr and any failed preparation artifact; `prepare` rejects
an existing output. An explicitly authorized new attempt uses a different
issue-owned JSON filename, not deletion of the old attempt. This preparation
command has NOT been run by this implementer.

Copy `results/issue3941/generator/load-client.mjs` byte-for-byte to the Mac
generator directory as `load-client.mjs`, alongside the isolated generator
manifest and its real frozen `pnpm-lock.yaml`/installed dependencies. On the
Mac, with inherited `BENCH_*`, `NODE_OPTIONS` and instrumentation cleared:

```sh
node load-client.mjs --identity
```

The parent retains this real identity output and constructs
`results/issue3941/identities.json` using these exact sources:

| Identity field | Authoritative parent input |
| --- | --- |
| `server.runtime`, `server.executable` | Prepared receipt `environment.node`, `environment.nodeExecutable` |
| `server.executableSha256` | Prepared artifact hash of the real server executable |
| `generator.runtime`, `generator.executable`, `generator.executableSha256` | Mac `--identity` output `node`, `executable`, `executableSha256` |
| Both hosts' `physicalHost`, `osCpu`, `affinityPower` | Actual role-correct physical host, OS/CPU and affinity/power observations; no guessed fixture values |
| `source.head` | Prepared receipt `environment.git.sha` |
| `source.packagesSha256` | Prepared receipt `packagesSha256` |
| `source.benchmarkSha256` | Prepared receipt `environment.benchmarkSource.sha256` |
| `source.buildSha256` | Prepared receipt `servingBuildSha256` |
| `source.workspaceLockSha256`, `source.benchmarkLockSha256` | Prepared receipt `environment.lockfiles`, using the corresponding actual server paths |
| `source.preparedSha256` | Prepared receipt's canonical-body `sha256` field, NOT the JSON file's byte hash |
| `source.generatorClientSha256` | Prepared receipt `generatorClientSha256`; must also equal Mac `--identity.clientSha256` |
| `source.generatorLockSha256` | Mac `--identity.lockSha256` |
| `source.generatorInstalledLockSha256` | Mac `--identity.installedLockSha256` |
| `source.generatorDependenciesSha256` | Mac `--identity.dependenciesSha256` |
| `transport.BENCH_SSH_HOST` | Actual Windows-to-Mac SSH account/alias for `192.168.0.129` |
| `transport.BENCH_REMOTE_DIR` | Actual absolute Mac generator directory |
| `transport.BENCH_SERVER_HOST` | `192.168.0.10`, authenticated as the local measured serving endpoint by the existing timing guard |
| `transport.BENCH_BIND_HOST`, `networkPath`, optional `BENCH_SSH_CONTROL` | Actual bind interface, direct HTTP path and current role-correct control socket |

Freeze the exact stdout once with the parent's authorized file mechanism:

```sh
node --import tsx src/issue3941.ts freeze results/issue3941/identities.json results/issue3941/prepared-build.json
# Preserve stdout as results/issue3941/frozen-plan.json, without overwriting.
node --import tsx src/issue3941.ts command results/issue3941/frozen-plan.json 0 results/issue3941/prepared-build.json
node --import tsx results/issue3941/collector.ts run-aa results/issue3941/frozen-plan.json results/issue3941/prepared-build.json
node --import tsx results/issue3941/collector.ts evaluate results/issue3941/frozen-plan.json results/issue3941/prepared-build.json
```

`run-aa` reserves the plan-digest directory and owns fresh per-slot runner
processes, stdout/stderr logs, raw JSON/receipts and the final `aa-evaluation.json`.
It clears inherited benchmark/preload settings before applying each exact frozen
environment. Numeric FAIL or any invalid/incomplete arm returns nonzero without
retry. The `command` action is an inspection/single-slot alternative, not a step
to execute before executing the same slot through `run-aa`.

Only after A/A numeric success may the parent request `command` for a headroom
slot from `plan.runs`; it authenticates and reevaluates all 120 original artifacts
before emission. The existing headroom diagnostic remains parent-scheduled,
preserves 1/4 workers, three alternating repeats and 3s/10s durations, and is
not automatically executed by `run-aa`. Its existing fixture rebuild is separate
from the once-prepared ordinary A/A cohort and must not change frozen bytes.
Profiles still require the real successful source-bound lead receipt with all
120 A/A, six headroom and concurrency-1/utilization artifact references. All
prior failed/inconclusive records remain preserved. Candidate selection and
BEFORE/AFTER remain gated on those actual parent observations.

## Prior preparation record (historical)

## Status

AWAITING_LEAD_MEASUREMENT. Windows-server host roles and the current machine
binding are synchronized; the only authorized changed-binding harness run
settled with 19 tests passed, exit 0. Previous declaration checks are retained,
not repeated. The no-suite
runtime correction retains its prior focused regression and real-checkout
probe evidence; those unchanged runs were not repeated. This is a tested,
non-completion preparation checkpoint, not measurement acceptance, a full
release gate PASS or an issue-implement completion Result. The same dirty
worktree and all historical evidence remain.
No candidate has been selected, no production runtime has changed, and no
performance, calibration or profiling run has been executed by this implementer.
Focused checks are recorded under `results/issue3941/checks/`; final results
and the resolved scope blockers are recorded below.
This report is not an issue-implement completion Result, adoption verdict, review
PASS, full local CI receipt or permission to close the issue.

Worktree: `.worktrees/issue-3941`, branch `issue-3941`, starting HEAD
`ce70426f3bf29430c4eb941f8e94baaf8f78d364`. Preflight binding:
`66f00d1200633c4f5e4a64e784a089f5399bd9ad9314fa7771d45716f85a0673`.
Canonical artifact:
`.omo/verification/http-performance-3939-3943-20261013-1a832301/preflight-3941-windows-server.json`.
The earlier digests `290459451ae9a7f5c1683c3a233b082fd00814698a3da7193d3c47cd85780d4c`
and `1c0e1566be250575946087e0f379d2600dca15f28e3f99d29b498def2ad4ceab`,
plus `d1cf7a6f531313d853b432986bbf970f307eb631a0cca9bea474f224114fdbe2`,
remain historical; no original log, scope-conflict receipt or prior fixture was rewritten.
The worktree is intentionally uncommitted at this checkpoint.

## Frozen machine policy

`results/issue3941/frozen-policy-windows-server.json` is the current machine fixture checked against
`Issue3941.policy` in `tests/issue3941.test.mts`. The executable policy fixes:

- Business three workloads, default/equivalent, concurrency 1/64; 10-second
  warmup and 40-second measurement; five fresh-process A/A pairs per condition:
  120 ordinary measurements, with A1/A2 and A2/A1 alternating.
- Six headroom invocations of existing `src/headroom.ts`: 1/4 generators,
  fixed total concurrency 64, three alternating repeats, 3-second warmup and
  10-second measurement, 36 diagnostic measurements. These are not baselines.
- Two `runProfiles` plans, one per configuration: three workloads times
  CPU/allocation, one repeat, concurrency 64, 10-second warmup and 40-second
  capture/control durations: 12 captures and 24 controls.
- BEFORE/AFTER: the same 12 conditions and five pairs, 120 measurements, fixed
  alternating order. There is no runnable candidate arm until evidence establishes
  one candidate and the lead resumes implementation.
- A/A throughput and CPU/request CV and mean drift at most 3%; latency/RSS
  mean drift at most 5%. Headroom mean scaling at most 3% and every-repeat
  scaling at most 5%, plus independent-host, concurrency-1 capacity/burst and
  server-utilization evidence.
- Primary `read-search-local/equivalent/64` throughput gain strictly greater than
  max(3%, calibrated noise envelope) and paired 95% interval lower bound above
  zero. Every condition's regression interval upper bound must be within 3%
  throughput/CPU or 5% p95/p99/sampled peak RSS.
- Paired arithmetic mean of relative changes, percentile bootstrap, xorshift32
  seed 3941, 10,000 resamples, sorted nearest-rank endpoints 250/9750 (1-indexed).
  For the noise envelope use the maximum absolute throughput A/A interval
  endpoint across all 12 conditions. Preserve every pair; no outlier deletion,
  automatic additional repeats or repeat-until-pass.

The executable policy and current fixture bind the accepted
preflight digest. No numerical threshold, estimator, sample count or workload
changed. The original `frozen-policy.json` is preserved at its historical byte
SHA-256 `d22ec08d7e24310a40c4d967523444023a87f39c1ceab770359b7cea3d3bde49`.
The previous reconciled fixture is also preserved, byte SHA-256
`1fdf7b5ac65ed97ff0223f4fca51f5aaae1587d37eea3eaea22fc93d900ec747`.
The previous declarations-bound fixture is preserved, byte SHA-256
`1fb013348ca7e450fbdf1db65bff3df74d753de45c0e07813a592212919bc718`.
The current fixture is ignored by the existing results JSON ignore rule;
it must be explicitly included in the eventual scoped commit because the
regression test consumes it. There is no fabricated host-bound plan: the lead
creates the immutable `results/issue3941/frozen-plan.json` only from complete
real identities and fresh build provenance.

`calibration`, `pairedInterval`, `headroom` and `comparison` expose deterministic
numerical gates. Their positive status is deliberately
`PASS_NUMERIC_GATE_ONLY`: callers must also authenticate schema-3 raw traffic,
serving/source/build/runtime/lockfile identities and all functional evidence.
Same-physical-host controls return INCONCLUSIVE and are not independent headroom
evidence. None of these methods selects or adopts a runtime candidate.

## Lead prerequisites and exact commands

All commands below are executed by the lead after exclusive host scheduling.
The parent copies the prepared source to the Windows measurement worktree and
sets its actual benchmark directory before freezing; the Mac path is not the
measurement server checkout:

```sh
cd "$ISSUE3941_WINDOWS_SERVER_BENCHMARK_DIR"
```

The user-confirmed measured Fluo server is the Windows desktop WSL2 environment.
The Mac is only the independent HTTP load generator. The parent must freshly
observe and freeze server/generator executable, runtime, source/build, lockfile,
physical-host and transport identities on the role-correct setup. Earlier
Mac-server/WSL-generator addresses, runtime associations, control sockets and
the ten-request connectivity smoke are historical, not reusable calibration
or proof of connectivity in the reversed roles.

The lead reported that the old Mac-server Node headroom attempt stopped with
12/132 retained records: moving from one to four generators increased
first-condition throughput 57%-128%. This is rejected environment diagnosis,
not Windows-server performance or optimization evidence. Its partial records
remain preserved; neither the failure nor any acceptance threshold is
reinterpreted to produce a pass.

Before freezing, the lead supplies `results/issue3941/identities.json`.
Each of `server` and `generator` requires real `physicalHost`, `osCpu`, `runtime`,
`executable`, `executableSha256`, `affinityPower` strings. The `source` section
requires `head`, `packagesSha256`, `benchmarkSha256`, `buildSha256`,
`workspaceLockSha256`, `benchmarkLockSha256`, `generatorLockSha256`.
Use the shared `sourceSnapshot` sorted JSON SHA-256 for package/benchmark source
and `prepareTimingIdentity(fluo-fastify).artifactsSha256` for serving build.
Record fresh root/target build commands and linked package build provenance
separately; that serving digest alone does not authenticate every linked build.
`transport` requires role-correct `BENCH_SSH_HOST`, `BENCH_REMOTE_DIR`,
`BENCH_SERVER_HOST`, `BENCH_BIND_HOST` and a real
`networkPath`; optional `BENCH_SSH_CONTROL` is preserved. Missing/unknown identities
are rejected, never replaced by guessed defaults.

Fresh frozen installs, a fresh root build and the selected target build must
precede freezing. Existing helpers retain their build/provenance and real-serving
authentication; do not alter their source, lockfiles or version checks.

```sh
# Parent supplies fresh Windows-server -> Mac-generator transport settings.
node --import tsx src/issue3941.ts freeze results/issue3941/identities.json
```

Save that exact stdout once as `results/issue3941/frozen-plan.json` using the
lead's permitted file mechanism, before any timing. The CLI authenticates the
declared local source/runtime/lockfile/serving build binding without running traffic.
The plan digest names all real identities, policy and finite schedule.

```sh
node --import tsx src/issue3941.ts command results/issue3941/frozen-plan.json 0
```

For each non-profile schedule slot, this emits the exact executable, argv, cwd,
environment, output path and prerequisites. The lead executes those existing
`src/run.ts` / `src/headroom.ts` commands serially, once per slot. It does not
automatically execute the plan. Create the named output parent before execution,
reject an already existing output, preserve stdout/stderr, and clear inherited
`BENCH_*`, `NODE_OPTIONS`, preload/profiling/diagnostic settings before applying
the emitted environment. Preserve schemaVersion 3, every raw sample and
`invalidAttempts`. No extra matrix, amount override, duration reduction or retry
is permitted as acceptance evidence.

After successful A/A plus independent headroom, the lead supplies
`results/issue3941/lead-calibration.json`: `verdict: "PASS"`,
`planSha256`, `sourceSha256` (the plan's package source hash), and `artifacts`
containing distinct existing issue-owned `{path, sha256}` references for all
120 ordinary A/A artifacts, six headroom artifacts, concurrency-1 and
server-utilization evidence (at least 128 files). The lead must actually evaluate
the raw observations and all prerequisites before issuing this receipt;
hash validation cannot establish that judgment.

Profile slots are found from `frozen-plan.json`'s `runs`, not guessed ordinals:

```sh
node --import tsx src/issue3941.ts profile results/issue3941/frozen-plan.json 126 results/issue3941/lead-calibration.json
node --import tsx src/issue3941.ts profile results/issue3941/frozen-plan.json 127 results/issue3941/lead-calibration.json
```

The wrapper reuses `runProfiles`/`profileCompleteness`, hashes the calibration
artifact bytes, checks local source/build/runtime and transport identity, and
rejects an existing profile output directory. Controls and inspector captures
remain separate. Raw captures go only under
`results/profiling/issue3941/<plan-sha256>/<configuration>/`.
Sampling allocation is not an exact allocated-byte count.

Native hit/full/fallback/declined and headers-getter usage observations must be
collected separately from ordinary timing. The real-listener regression's
`dispatchNativeRoute`/getter interception provides the behavioral seam; it is
not a measured business-workload hit ratio. The lead must supply real-request
CPU/allocation profiles and these separate route observations before candidate
selection. No metadata bottleneck or gain is assumed from source inspection.

## Behavioral preparation and release impact

`native-route-work.test.ts` adds hook-assigned request-ID precedence, undefined
and empty-array fallback, first-array-value trimming, duplicate casing insertion
order, undefined duplicate lookup, effective scalar/array snapshots, cookie/query
identity and undefined-ID lazy absent-marker coverage through real listeners.
The pre-existing original-header snapshot, lazy signal/header and full-route
middleware cases remain. Existing `adapter.test.ts` and read-only shared Node,
HTTP context/dispatch regressions are focused validation targets.

There is no production or public API change. Changeset and README changes are
deferred until a measured candidate is established, as instructed. Old
NOT_ESTABLISHED/FAIL/INCONCLUSIVE and withdrawal records are untouched and are
not reinterpreted as #3941 acceptance.

## Focused verification

- Frozen root and isolated benchmark installs and the focused Fastify dependency
  build completed with exit 0 (`checks/install.log`, `checks/build.log`).
- `pnpm exec vitest run packages/platform-fastify/src/native-route-work.test.ts
  packages/platform-fastify/src/adapter.test.ts
  packages/platform-nodejs/src/node/internal-node-request.test.ts
  packages/http/src/dispatch/ packages/http/src/context/ --maxWorkers=2`:
  34 files, 512 tests passed, exit 0 (`checks/focused-tests-2.log`).
- `node --import tsx --test tests/issue3941.test.mts`: 19 tests passed, exit 0;
  benchmark `pnpm exec tsc --noEmit -p tsconfig.json` passed in the same final
  command (`checks/harness-final.log`).
- Fastify package typecheck and changed TS file Biome lint passed
  (`checks/types-governance-2.log`, `checks/harness-final.log`). Changed MTS file
  Biome lint passed using the existing `tests/fixtures/paired-ab-biome.json`
  configuration (`checks/quality.log`). All three changed code files had empty
  LSP diagnostics. `git diff --check` passed independently.
- Platform consistency governance passed. Release readiness FAILED, exit 1
  (`checks/governance.log:1429`): its workspace build/typecheck and package suite
  (640 files, 7,341 tests) completed, then `pnpm vitest run --project apps
  --maxWorkers=1` failed with `No test files found, exiting with code 1`.
  The remaining release stages did not complete. The existing script invokes
  workspace builds/typechecks and release/scaffold tests; this is the required
  release gate, not a canonical full local CI receipt.
- The optional skill no-excuse checker could not run: it requires
  `typescript/unstable/async` and `typescript/unstable/ast` (TypeScript 7 APIs),
  whereas this project installs TypeScript 6.0.2 and the benchmark installs 5.8.
  No dependency, shared config or external checker was modified to hide that
  incompatibility (`checks/quality.log`).

Initial preparation failures are retained: the new harness initially had no
module; four tests initially expected the wrong missing-section exception class;
the hook-header fixture initially included uncontrolled client headers in its
exact body expectation; and three new typing mistakes were corrected. A subsequent
benchmark typecheck overlapped Vitest's clean dependency rebuild and temporarily
could not resolve the persistence declarations; after builds settled it passed
without any shared source/config/lockfile edit
(`checks/benchmark-typecheck-settled.log`, `checks/harness-final.log`).

No full local CI or remote action was run. All preparation failures and corrected
reruns remain under `results/issue3941/checks/`, not overwritten or disguised
as measurements. No production runtime, package README, Changeset, lockfile,
shared helper or root/lane file was edited.

## Historical scope blocker and reconciled checkpoint

`tooling/release/verify-release-readiness.mjs:15,207-208` unconditionally schedules
the `apps` Vitest project. `git ls-files -- 'apps/**/*.test.ts'` is empty at the
unchanged starting HEAD. CONTRIBUTING already documents `apps` as an explicit
`no-suite` capability, but this release runner does not consult that catalog.
The lead subsequently assigned that runner and
`tooling/release/verify-release-readiness.test.ts` through the reconciled
preflight. The same worktree now reuses `readTestCatalog` and the unchanged
target manifest's actual include/exclude patterns. Only a genuinely absent apps
test project is classified as `no-suite`; build/typecheck and every non-apps
project remain. Future real apps tests automatically select the project.
Git diff against the supplied base (HEAD by default) feeds changed test paths
to the canonical catalog, retaining both owner-level and base-suite coverage-loss
guards before any verification subprocess runs. Selected subprocess failures
propagate unchanged. The returned command receipt and EN/KO summaries report
only completed commands and list no-suite separately, including when reusing
an explicitly supplied prior build.

No shared catalog, manifest, test selection pattern, skip/no-tests flag, publish
authority, historical log or receipt was modified. The original full release
failure remains at `checks/governance.log`, SHA-256
`3157c358972772428d995cf0b5de85677f0a57ebec2f734c174add41535c64b5`.
Per the lead's explicit instruction, full release-readiness and full
workspace/local CI are NOT rerun. Focused success proves this runtime mismatch
correction, not a full release gate PASS.

The bounded dirty implementation consists of:

1. `packages/platform-fastify/src/native-route-work.test.ts`
2. `tooling/benchmarks/http-comparison/src/issue3941.ts`
3. `tooling/benchmarks/http-comparison/tests/issue3941.test.mts`
4. `tooling/benchmarks/http-comparison/issue3941-report.md`
5. `tooling/benchmarks/http-comparison/results/issue3941/frozen-policy-windows-server.json`
   (existing ignore rule; preserved on disk, not staged)
6. `tooling/release/verify-release-readiness.mjs`
7. `tooling/release/verify-release-readiness.test.ts`
8. `tooling/release/verify-release-readiness.d.mts`

Original raw preparation logs and new reconciled logs remain solely under
`results/issue3941/checks/`. The earlier pre-reconciliation code bindings were:

| Artifact | SHA-256 |
| --- | --- |
| `src/issue3941.ts` | `485e0526e0b571a25792b1b6147aa83288660c156d8fdbb0a421c55cfe3d838e` |
| `tests/issue3941.test.mts` | `ffb42cf73fcebf8d3b354945ba0ef182ceef894861b9a0e78bb8542da160ca48` |
| `packages/platform-fastify/src/native-route-work.test.ts` | `f043b0691a3a55598e6fc8bd89f5a6537ef2b45d45817e5abb48e5eb9219ff89` |

The code bindings above are historical, not the updated code hashes; the
settled reconciliation bindings are recorded below.

No commit, candidate, calibration, headroom, profile or BEFORE/AFTER verdict
exists. Preserve this same worktree, dirty reproduction/evidence and identity.
After the lead independently verifies this correction and supplies measurements,
resume here; eventual local completion still requires the real measured
adoption/rejection, required release companions, a new verified local commit
and the exact stage Result. None is claimed by this checkpoint.

## Reconciled focused evidence before declaration authorization

All started focused checks have settled:

- RED: `pnpm exec vitest run --project tooling
  tooling/release/verify-release-readiness.test.ts --maxWorkers=1`, exit 1,
  55 tests, seven failures including absent-apps command mismatch and missing
  coverage-loss rejection (`checks/reconciled-release-red.log`).
- GREEN: the same focused command, exit 0, 56 tests passed
  (`checks/reconciled-release-green-2.log`). An intermediate dependency binding
  mistake failed and was corrected; that log remains
  `checks/reconciled-release-green-1.log`.
- Harness: `node --import tsx --test tests/issue3941.test.mts`, 19 tests passed,
  then `pnpm exec tsc --noEmit -p tsconfig.json`, exit 0
  (`checks/reconciled-harness-independent.log`).
- Real checkout probe, exit 0 (`checks/reconciled-checkout-probe.log`):
  catalog packages 640, apps 0, examples 16, tooling 189. Emitted six commands:
  build, typecheck, packages/examples/tooling Vitest, CLI sandbox matrix.
  Apps is explicitly `no-suite`. Verification subprocesses were NOT executed
  by this probe; it does not claim those six commands passed.
- Changed release MJS/TS and issue3941 TS Biome lint passed (three files,
  no fixes), but `pnpm exec tsc -p tsconfig.tools.json --noEmit` failed with
  17 declaration mismatch diagnostics
  (`checks/reconciled-quality-harness-1.log`).
  The chain did not run its later harness commands; they were executed
  independently as recorded above. `git diff --check` passed.

The probe can be reproduced without full verification:

```sh
cd /Users/ayden/Documents/fluo/.worktrees/issue-3941
node --input-type=module -e '
import { readTestCatalog } from "./tooling/ci/test-catalog.mjs";
import { runCanonicalReleaseReadinessVerificationCommands } from "./tooling/release/verify-release-readiness.mjs";
const baseSha = "ce70426f3bf29430c4eb941f8e94baaf8f78d364";
const catalog = readTestCatalog(process.cwd(), [], { baseSha });
const commands = [];
const emitted = runCanonicalReleaseReadinessVerificationCommands(
  (command, args) => commands.push(command + " " + args.join(" ")),
  false, { root: process.cwd(), baseSha }
);
console.log(JSON.stringify({
  mode: "real-checkout-emitted-command-probe; verification subprocesses NOT executed",
  catalogCounts: Object.fromEntries(Object.entries(catalog).map(([key, files]) => [key, files.length])),
  emitted
}, null, 2));
'
```

## Historical declaration ownership conflict (resolved)

Before the final companion update, `tooling/release/verify-release-readiness.d.mts` declared
`runCanonicalReleaseReadinessVerificationCommands(runCommand, skipBuild): void`,
does not expose the already exported `buildSummary`, and has no
`verificationContext` dependency or `verification` result field.
The runtime implementation and focused tests now require a source-bound
checkout context and structured executed/not-applicable command receipt.
The exact representative type errors are:

```text
error TS2305: Module '"./verify-release-readiness.mjs"' has no exported member 'buildSummary'.
error TS2554: Expected 2 arguments, but got 3.
error TS2339: Property 'notApplicable' does not exist on type 'void'.
error TS2339: Property 'verification' does not exist on type 'ReleaseReadinessResult'.
```

The lead resolved this ownership conflict through `preflight-3941-declarations.json`.
The assigned companion now describes the optional checkout context, command
receipt, dependency/result fields and existing summary export consumed by the
regression tests. The selected-failure test's callback annotation now accepts
readonly arguments, matching the existing callback contract; its emitted
JavaScript and test behavior are unchanged. No shared catalog, manifest,
runtime implementation, test logic, threshold or publish authority changed in
this final companion step. No typing was suppressed or test weakened.

Previous release source byte bindings before the annotation-only companion:
`verify-release-readiness.mjs` =
`131e134dfd0254b80cbc995d7ceadefaff1a7a6bd9b5cdcba4ef8b0b8f9bd5b1`;
`verify-release-readiness.test.ts` =
`dea5b8cd7d2c8bcf62685df055c74928af896f722b8771aaab6b49a4806a6553`.
The original full exit-1 log remains byte-identical. The earlier optional
TypeScript-7-only checker incompatibility is unchanged and is not bypassed.
No runtime optimization, performance traffic, profile, remote action or commit
has occurred.

## Declarations-bound preparation evidence (historical)

All final commands below completed with exit 0:

```sh
cd /Users/ayden/Documents/fluo/.worktrees/issue-3941
pnpm exec tsc -p tsconfig.tools.json --noEmit
pnpm exec biome lint --config-path tooling/benchmarks/http-comparison/tests/fixtures/paired-ab-biome.json tooling/release/verify-release-readiness.d.mts
pnpm exec biome lint tooling/release/verify-release-readiness.test.ts tooling/benchmarks/http-comparison/src/issue3941.ts

cd tooling/benchmarks/http-comparison
node --import tsx --test tests/issue3941.test.mts
```

Tools typecheck and three affected lint targets passed
(`checks/declarations-tools-lint.log`). The declarations-bound issue harness
passed all 19 tests (`checks/declarations-harness.log`).
LSP diagnostics were empty for the companion, annotation-only callback target
and updated issue3941 source.

The earlier 56-test release GREEN and real-checkout emitted-command probe are
retained, not rerun. The runtime implementation is byte-identical to their
reviewed source. The release test's only new change is a readonly type annotation.
No benchmark typecheck, full release-readiness, full workspace build/CI,
performance traffic, profile, remote action or commit was repeated in this step.
The original full release-readiness exit-1 remains historical and is NOT promoted
to PASS by these focused results.

Declaration-step byte bindings (historical for the issue source/test/policy):

| Artifact | SHA-256 |
| --- | --- |
| `tooling/release/verify-release-readiness.mjs` | `131e134dfd0254b80cbc995d7ceadefaff1a7a6bd9b5cdcba4ef8b0b8f9bd5b1` |
| `tooling/release/verify-release-readiness.test.ts` | `66c6c72e55e2d38ed2d612c533425b7f8341ffbb3c900b4ebb22eca8976c7702` |
| `tooling/release/verify-release-readiness.d.mts` | `83e1d92e2646886c197ae566aa939ab0d4400056a734695fd0cf01154408d632` |
| `src/issue3941.ts` | `4896cbdc8f6f27fc767134119567e61b36c67ae196f122d1a4fa86a4027d52d2` |
| `tests/issue3941.test.mts` | `59ce60065f5b029c25782bbdc8424da4e5d8c45fc7da907d7fd08b0697b7fce9` |
| `results/issue3941/frozen-policy-declarations.json` | `1fb013348ca7e450fbdf1db65bff3df74d753de45c0e07813a592212919bc718` |

Historical raw bindings retained:

- Original full exit-1 `checks/governance.log`:
  `3157c358972772428d995cf0b5de85677f0a57ebec2f734c174add41535c64b5`.
- 56-test release GREEN `checks/reconciled-release-green-2.log`:
  `357ed4764cfe3e659deb77e23653835c13e08699c817042f32aec054a11d64c3`.
- Real-checkout probe `checks/reconciled-checkout-probe.log`:
  `38726b907092a8f13c4a57e588c53f361d3a0b27da7ea08eb6205154ca703178`.

There is no remaining local preparation blocker. The lead supplies complete
real identities and immutable `results/issue3941/frozen-plan.json`, schedules
all A/A/headroom/profile/BEFORE-AFTER work exclusively, and returns successful
calibration plus real-request profiles before any candidate selection.
The current policy fixture is not a fabricated host-bound plan. Preserve this
same dirty worktree and resume only on lead-supplied evidence; final measured
adoption/rejection, required release companions and a verified new local commit
with exact stage Result remain future work, not acceptance claimed here.

## Current Windows-server checkpoint

Measured server: Windows desktop WSL2. Independent HTTP generator: Mac only.
The parent copies the final prepared source to the Windows measurement worktree
and newly freezes actual identities there; the current local worktree is the
preparation source, not Windows measurement evidence.

Only the following command ran for this continuation:

```sh
cd /Users/ayden/Documents/fluo/.worktrees/issue-3941/tooling/benchmarks/http-comparison
node --import tsx --test tests/issue3941.test.mts
```

Result: 19 passed, zero failures/skips, exit 0
(`results/issue3941/checks/windows-server-binding-harness.log`).
No package/release checks, typecheck, build, remote or performance command ran.
No runtime/API logic, matrix, repetition, workload fixture or analysis rule
changed. Historical policy fixtures, manifests, logs and
`measurement-ready-checkpoint.json` remain untouched.

Current policy:
`results/issue3941/frozen-policy-windows-server.json`,
SHA-256 `57a1c9658d962e1d613b9e0ff92daf7091d8133147eb3c3c7526980abbac588c`.
Current executable binding:
`src/issue3941.ts`,
SHA-256 `1251d78a34947b78dc076da1d5259e7baca21224e0ec0e91a9e3c2c56ad65fc4`.
Current policy consumer:
`tests/issue3941.test.mts`,
SHA-256 `8a91e82a3f1a861dfb1737c1fdd5b506c1f5aec51621b93cc0c7cfe8d37275db`.
Current checkpoint:
`results/issue3941/measurement-ready-windows-server.json`.

Exact continuation change paths (all relative to the worktree):

1. `tooling/benchmarks/http-comparison/src/issue3941.ts` — digest only.
2. `tooling/benchmarks/http-comparison/tests/issue3941.test.mts` — consumed policy path only.
3. `tooling/benchmarks/http-comparison/results/issue3941/frozen-policy-windows-server.json` — new current policy; criteria unchanged.
4. `tooling/benchmarks/http-comparison/issue3941-report.md` — current binding, corrected roles and rejected diagnostic record.
5. `tooling/benchmarks/http-comparison/results/issue3941/measurement-ready-windows-server.json` — new role-correct current checkpoint.

The old Mac-server headroom attempt's 12/132 retained records and 57%-128%
first-condition generator scaling remain rejected environment diagnosis.
They establish neither Windows performance nor an optimization gain and cannot
be reused as role-correct calibration. No acceptance criterion was relaxed.
