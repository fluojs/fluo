# #3942 Express measurement rejection / Express 측정 경로 종료

## Final decision / 최종 판정 (2026-10-13)

**INCONCLUSIVE / NOT_ESTABLISHED**. Windows WSL2 Express server와 독립 Mac
generator의 headroom 실험은 예정된 30/30 records, measured requests 1,977,122개를
완료했습니다. Traffic errors와 invalidAttempts는 각각 0이지만 다섯 fixture
모두 paired log-ratio Student-t 95% interval upper가 동결 기준 1.02를
초과했습니다. Generator bottleneck 제외도 입증되지 않았습니다.
완전한 원본이 있으나 선행조건은 통과하지 못했습니다.

The role-correct Windows WSL2 Express server / independent Mac generator
headroom experiment completed all 30 planned records and 1,977,122 measured
requests, with zero traffic errors and zero invalid attempts. Every fixture
exceeded the frozen 1.02 upper-bound requirement; independent generator
bottleneck exclusion was not established. Complete raw evidence is preserved,
but the prerequisite did not pass.

| Fixture | Geometric mean (four / one generators) | 95% lower | 95% upper | Verdict |
| --- | ---: | ---: | ---: | --- |
| plain-json | 0.9387257989627761 | 0.8037494390353694 | 1.096369195225683 | INCONCLUSIVE |
| native-header-json | 0.9236459160223319 | 0.6515745906211989 | 1.3093232769733736 | INCONCLUSIVE |
| native-metadata-json | 0.9447608607309377 | 0.8623885091381986 | 1.0350011329128534 | INCONCLUSIVE |
| json-body-command | 1.0847625393179217 | 0.6137101672053317 | 1.9173704943913186 | INCONCLUSIVE |
| rest-route-mix | 0.9292863729782017 | 0.7418326830736373 | 1.1641077330604208 | INCONCLUSIVE |

Analysis uses three paired ratios per fixture, df=2 and critical value
4.30265273; no outliers or failed attempts were removed and no threshold,
fixture, duration, sample count or schedule was changed.

부모 지시에 따라 이 경로를 종료했습니다. A/A, CPU/allocation profile, 후보
선정, BEFORE/AFTER, 최적화 채택 및 조건 변경 없는 재시도는 실행하지 않습니다.
Production runtime 변경이나 성능 개선 주장은 없습니다. 아래 preparation
checkpoint는 과거 이력이며, 실행 재개 지시 또는 남은 필수 작업이 아닙니다.

The parent stopped this failed prerequisite path. A/A, CPU/allocation profiling,
candidate selection, BEFORE/AFTER and adoption were not performed. There is no
unchanged retry, production runtime change or optimization claim. The preparation
checkpoints below are retained history, not an instruction to resume measurement.

### Evidence and source binding / 증거와 source 결속

Authoritative parent verdict:
`/Users/ayden/Documents/fluo/.omo/verification/http-performance-3939-3943-20261013-1a832301/headroom-3942-windows-01-verdict.json`.
The following exact files remain in `results/issue-3942/`, excluded from Git
without deletion:

- `headroom-windows-01/raw.json`: SHA256
  `04119d92dbcf59b7b5f5e8fee5b11893d7633ffe2c2dbb4ea5ae03a3799812b9`.
- `frozen-windows-01.json`: SHA256
  `6bba0c95c9192bcf23bc1c20f005e31780ad28640e34c54eec3e4617611a0aed`,
  matching the raw records' `planSha256`.
- `hosts-windows-01.json`, `prepared-windows-01.json`, all per-condition
  warmup and server stdout/stderr files, and historical logs/manifests.

External raw archive:
`/Users/ayden/Documents/fluo/.omo/verification/http-performance-3939-3943-20261013-1a832301/headroom-3942-windows-01.tar.gz`,
SHA256 `d427591cd618a37dea5d092846fa8c0f567ab56a713281d5f76dd6aa7ac27573`.
This archive is preserved externally, not staged as source.

The preparation snapshots describe the collector used for the retained Windows
measurement, not the hardened source introduced by the build-drift fix-back.
The parent independently compared all 30 retained samples against all 660 frozen
build entries and found zero mismatches, recorded in
`/Users/ayden/Documents/fluo/.omo/verification/http-performance-3939-3943-20261013-1a832301/adjudication-3942-build-drift.json`.
The prior INCONCLUSIVE verdict and immutable raw originals remain unchanged.
Current `experiment.ts` and its regression tests differ from those preparation
snapshots; their old hashes and checks do not attest the newly hardened source.
The inherited shared collector/test are unchanged. The parent prepares new
exact-head receipts and contract/code/verification reviews after this local commit.

준비 snapshot은 보존된 Windows 측정에 사용한 과거 collector를 식별합니다.
부모가 30개 표본의 serving artifact를 각각 660개 동결 build 항목과 비교한
결과 불일치는 0개였습니다. 이번 fix-back의 `experiment.ts`와 회귀 테스트는
과거 preparation source와 다르며, 기존 hash와 검증으로 새 source의 검증을
대체하지 않습니다. 기존 INCONCLUSIVE 및 원본은 그대로 보존합니다.

### Frozen build fix-back / 동결 build fix-back

Each ordinary condition now re-reads the actual serving entry and every frozen
linked build before starting a server or sending correctness, warmup or capture
traffic. The freshly read hashes must match the original `binding.builds`;
a replacement cannot become a new accepted attestation. `TimingIdentityFailure`
retains the path, expected digest and actual digest through the existing
condition journal. Startup and post-capture authentication remain in place.

각 ordinary condition은 서버 시작 및 모든 요청 전에 실제 serving entry와
동결된 linked build 전체를 다시 읽고 원래 `binding.builds`와 비교합니다.
실제 파일 byte를 condition 사이에 교체하는 결정적 회귀 테스트는 serving
entry와 linked build 변경을 각각 거부하고 journal의 실패 증거 보존을 확인합니다.
검증은 correctness-only이며 성능 실행이나 기존 판정의 상향은 없습니다.
Raw RED/GREEN 및 affected types/lint 증거는
`results/issue-3942/fix-back-1-build-drift-*`에 별도로 보존합니다.

### Local finalization and limits / 로컬 최종화와 한계

Bounded machine evidence: `results/issue-3942/finalization-receipt.json`.
The authored source, deterministic collector regression, native-body baseline
test, policy files and this bilingual report are the intended commit companions.
Raw matrices, caches and generated `dist` are neither deleted nor staged.
Published package runtime/API/content is unchanged: only test coverage and
internal benchmark tooling/reporting changed. Per `CONTRIBUTING.md`, there is
no consumer-facing release impact and no Changeset is required.

기존 collector focused 30/30 pass, build, strict types 및 source lint 증거를
보존합니다. Express package-owner typecheck와 Express/Node 회귀의 최종 결과는
bounded receipt에 기록합니다. Windows 첫 focused 실행의 29 pass / 1 fail은
`packages/config/dist` 누락으로 발생했고 부모 root build 이후 30 pass / 0 fail,
exit 0으로 복구했습니다. 이 환경 실패와 이전 wrapper 실패도 보존하며 성능
판정으로 사용하지 않습니다. Full local CI, remote push, PR 및 cleanup은
이 단계에서 실행하지 않았습니다.

The retained collector suite passed 30/30, with passing build, strict types and
source lint. Final Express owner typecheck and Express/Node regression outcomes
are recorded separately in the bounded receipt. The parent's initial Windows
focused run had 29 passes / one failure because `packages/config/dist` was
missing; the root build repaired the environment and the recovery passed 30/30
with exit 0. Earlier wrapper failures remain historical failures, not performance
verdicts. Full local CI, remote push, PR operations and cleanup were not run.

## Historical preparation checkpoints / 과거 준비 이력

Historical status: **MEASUREMENT_READY_LOCAL_PREPARATION / AWAITING_LEAD_MEASUREMENT**.
The following uncommitted preparation checkpoint predates the final rejection
above and was not an issue-implement `Result`, acceptance PASS, candidate selection,
or measured optimization.

## Identity and scope

- Worktree: `/Users/ayden/Documents/fluo/.worktrees/issue-3942`
- Branch: `issue-3942`
- Starting/current HEAD: `ce70426f3bf29430c4eb941f8e94baaf8f78d364`
- Current preflight SHA256: `2db06833eb72bb88b7943ccc7bc8a234c9a95c0c9e6e226111cb50eceef20b1b`
- Current preflight artifact:
  `/Users/ayden/Documents/fluo/.omo/verification/http-performance-3939-3943-20261013-1a832301/preflight-3942-collector-integrity.json`
- Current policy artifact: `results/issue-3942/current-policy-collector-integrity.json`.
  Only the preflight binding changed; every numerical threshold, matrix,
  repetition, fixture, analysis rule and historical verdict is preserved.
- Edits: issue-owned `src/issue-3942/`, `tests/issue-3942.test.mts`,
  `results/issue-3942/`, this report, and exact inherited `src/traffic.ts` /
  `tests/traffic-utf8.test.mts`. The pre-existing native-body baseline test in
  `packages/platform-express/src/adapter.test.ts` is preserved without new edits.
- No production runtime edits or Changeset yet. This checkpoint changes only
  internal experiment tooling and test coverage, not published package behavior.
- No remote actions, shared lane edits, commit, or automatic full local CI.

## Collector integrity preparation, 2026-10-13

Machine receipt: `results/issue-3942/collector-integrity-receipt.json`.
Raw checks: `results/issue-3942/collector-integrity-checks.log`.
Hash-comparison-removal RED: `results/issue-3942/collector-integrity-hash-removal-red.log`.
The three removal commands were `node --import tsx --test
--test-name-pattern='valid JSON FIELD tamper' tests/issue-3942.test.mts`, with
FIELD respectively `entrySha256`, `nodeExecutableSha256`, `lockfileSha256`.
Each exited 1 with `Missing expected exception.`; each guard was restored
before the final focused run. The tampered wire is valid JSON with the same
byte length, and the restored guards reject it.

The exact inherited collector SHA256 is
`a256ed2f892d7c9c0ad4cbd6f2b23fae3f64dc5882fc5d76de159447987699a8`;
the inherited UTF8 test SHA256 is
`7dc5c812ba9316403a65faef6fd8916d642946d748982f9ccdc3862da7b2aa41`.
No independent shared-file edit was made. Shared `load.ts` is unchanged.

`ordinary()` retains the full warmup response in both the completed sample's
`warmupResponse` and the condition's exclusive `warmup.json`. The latter is
written before authentication, so wrong-host or wrong-hash warmups remain
available while capture is refused. Warmup and capture check the actual
generator hostname, Node, executable path, kernel, CPUs, bundle hash,
executable hash and lock hash against the frozen host record.

The issue-owned generator entry observes hashes from its actual bundled file,
`process.execPath`, and adjacent `pnpm-lock.yaml`; none come from declarations
or environment variables. The build bundles the inherited collector and its
dependencies. Deploy both files together:

- Bundle: `dist/issue-3942/generator/load-client.mjs`, 1,025,814 bytes,
  SHA256 `0257aae1f12bec7ffe12e328c23114d0d47f861160740afca02d8afc7915eea6`.
- Generator lock: `dist/issue-3942/generator/pnpm-lock.yaml`,
  SHA256 `00bab013fdc3a400e8f67c89f4b315502e8f782bf03686c9cbe9dc355ebdc027`.
- Fresh local preparation: `results/issue-3942/prepared-manifest-collector-integrity.json`,
  SHA256 `9725f329429dad7a781c5ac086844cbfa30a32fb8a4307aadf8098ca6b9fb3fe`.
  This is a Mac preparation receipt, not a Windows serving freeze.

Focused harness plus inherited UTF8 passed 30/30 in 5.360104208 seconds,
including five real Express correctness listeners and identity-only execution
of the compiled generator. Build, changed-source strict typecheck, source lint
(eight source files), LSP diagnostics and `git diff --check` passed.
The benchmark test files are ignored by the existing Biome configuration;
their types and runtime behavior were checked. No unchanged package check or
full local CI was repeated. The finite UTF8 tests send fixed correctness-only
request counts, not calibration or performance samples.

All 17 original issue result files and the pre-existing dirty adapter test
retain their original hashes, recorded in the receipt. Policy comparison
excluding `preflightSha256` is identical. Fixtures, numeric gates, durations,
matrix, historical verdicts and finite schedules are unchanged.

Existing JSON files in this checkout were at most 948,352 bytes; the fresh
preparation manifest is 965,625 bytes. This checkout contains no #3942 timing
raw JSON whose size would demonstrate a journal or 64 MiB process-output
failure. The remote load limit applies to one generator invocation, not the
entire finite experiment. No storage failure or required storage rewrite is
established by these files.

### Parent host identities and exclusive lease

Fresh local Mac observation: `mac-mini.local`, Node `v24.20.0`,
`/Users/ayden/.nvm/versions/node/v24.20.0/bin/node`, executable SHA256
`9d050fd455b56426e25d4d603c7c501cbb2630348e836cf221dcce748e90588a`,
kernel `27.2.0`, twelve `Apple M4 Pro` CPU entries. PID 96186 belongs to the
completed identity-only probe, not a reusable measurement process.

Windows WSL2 remains the server; Mac remains the independent generator.
No fresh Windows observation or remote command was performed here.
Historical `DESKTOP-VLEUB8O`, Node `v24.21.0`,
`6.18.54.1-microsoft-standard-WSL2`, Intel i5-9400 observations below are
not a current identity. The parent must freshly record Windows hostname,
WSL/kernel/CPU, exact executable/version/hash, source/build/root and benchmark
locks, Express resolution, quota/affinity/power/background load; similarly
observe Mac controls and the exact noninteractive SSH execution identity.
Each host record must bind its retained identity evidence bytes with
`identityEvidenceSha256`.

Before any timing, the parent must reserve both hosts exclusively for the
entire finite sequence, stop competing tests/builds/load/profiles, provide a
new lease in `hosts.lease`, and export that exact value as `ISSUE_3942_LEASE`.
No lease is claimed by this local preparation.

The parent supplies the actual Mac SSH target as `BENCH_SSH_HOST` and uses:

```sh
export BENCH_REMOTE_DIR=/Users/ayden/Documents/fluo/.worktrees/issue-3942/tooling/benchmarks/http-comparison/dist/issue-3942/generator
ssh -o BatchMode=yes "$BENCH_SSH_HOST" \
  "cd $BENCH_REMOTE_DIR && PATH=/usr/local/bin:\$PATH node load-client.mjs --identity"
```

That command reproduces shared `load()`'s remote Node selection. With an
existing `BENCH_SSH_CONTROL`, also pass `-S "$BENCH_SSH_CONTROL"` as `load()`
does. Verify the bundle and lock against the above hashes and hash the
reported executable independently with `shasum -a 256` on the Mac.
Freeze the returned runtime/path/host/CPU/kernel and byte hashes, not the
historical Node version or a login-shell assumption. Map `entrySha256` to
`hosts.generatorEntrySha256`, `lockfileSha256` to
`hosts.generatorLockfileSha256`, and executable hash/path to the generator
machine record. If the SSH runtime differs, the parent must resolve that
before freezing; this preparation changes no shell or installed Node.

On the parent-deployed Windows benchmark checkout, after source transfer and
required serving dependency preparation:

```sh
node --version
node -p 'process.execPath'
hostname
uname -r
lscpu
sha256sum "$(node -p 'process.execPath')" pnpm-lock.yaml ../../../pnpm-lock.yaml
pnpm exec tsx src/issue-3942/build.ts
pnpm exec tsx src/issue-3942/experiment.ts prepare \
  results/issue-3942/prepared-manifest-windows-collector-integrity.json
pnpm exec tsx src/issue-3942/experiment.ts freeze \
  results/issue-3942/hosts-windows-collector-integrity.json \
  results/issue-3942/frozen-plan-windows-collector-integrity.json
```

The parent writes the fresh `hosts-windows-collector-integrity.json` using
all fields documented below. `BENCH_SERVER_HOST` must be the direct Windows
HTTP hostname/IP in its `serverOrigin`; `BENCH_BIND_HOST` equals `hosts.bindHost`;
`BENCH_SSH_HOST` equals `hosts.generatorSshTarget`. Observe direct Mac-to-Windows
HTTP correctness and keep SSH only as generator control, never as a tunnel.

Only after the lease, identities and direct HTTP conditions are frozen, the
parent may run the unchanged finite sequence:

```sh
pnpm exec tsx src/issue-3942/experiment.ts headroom \
  results/issue-3942/frozen-plan-windows-collector-integrity.json \
  results/issue-3942/headroom-windows-collector-integrity
pnpm exec tsx src/issue-3942/experiment.ts aa \
  results/issue-3942/frozen-plan-windows-collector-integrity.json \
  results/issue-3942/aa-windows-collector-integrity \
  results/issue-3942/headroom-windows-collector-integrity/raw.json \
  results/issue-3942/headroom-windows-collector-integrity-assessment.json
```

The headroom assessment is a fresh parent raw-bound bottleneck assessment,
not a fabricated PASS. Earlier Node/Bun failures remain diagnosis only and
are never reused as calibration. No timing, profile, optimization, commit,
publication or issue closure was performed by this continuation.

## Host-role correction checkpoint

Status remains **AWAITING_LEAD_MEASUREMENT**. The current policy artifact is
`results/issue-3942/current-policy-windows-server.json`; only
`preflightSha256` differs from the historical policy. A read-only structural
comparison confirmed every other policy value is identical. The historical
`prepared-manifest-final.json` still has SHA256
`26a38f8d7c3e2dcaf87b4a7df6ddd08502095320d88687400e44b3f069654f92`.

Only the existing issue-owned test command was run for this continuation:

```sh
node --import tsx --test tests/issue-3942.test.mts
```

It exited 0: 19 tests passed, zero failed. Raw receipt:
`results/issue-3942/windows-server-binding-tests.log`.
No full tests, build, typecheck, package/release checks, remote operations,
performance runs or commit were performed in this continuation.
The new current policy and corrected source must be copied by the lead to the
Windows measurement worktree before freezing fresh server/generator identities.

## Fixtures and frozen design

`src/issue-3942/fixtures.ts` fixes five fixtures: plain JSON, native response
headers plus JSON, native request metadata plus JSON, JSON body command, and
REST route mix. Business traffic, payloads, and application modules reuse the
existing scenario/shared helpers. Native header values include numeric, array,
own `__proto__`, and cookie values. The body fixture writes an intentionally
different native `request.body` without consuming the stream; the adapter still
materializes wire JSON. The package regression also verifies native content-type
mutation and raw bytes through native handoff and normalized fallback.

`src/issue-3942/gates.ts` is the frozen machine policy, bound to the accepted
preflight. Timing uses default configuration, connections 16/64, 10-second
warmup, 40-second capture, eight alternating AB/BA pairs for each fixture/condition.
Headroom uses 64 connections, one/four generators, three alternating pairs,
3-second warmup and 10-second capture. Profiles use 64 connections, CPU/allocation,
two captures per fixture/mode, 10-second warmup and 30-second control/capture.

Paired ratios use a prespecified log-ratio Student-t 95% interval (df=7 for
timing; df=2 for headroom), without dropping outliers. A/A primary CV is at most
3%; throughput and CPU/request intervals must be inside [0.98, 1.02], and
p95/p99/RSS inside [0.95, 1.05]. Generator scaling CI upper bound must be at most
1.02 and the lead must independently exclude a generator bottleneck.

The numeric candidate gate requires the primary gain to exceed
`max(3%, 2 * A/A noise bound)` with its CI wholly in the improvement direction.
Every condition must independently preserve throughput lower >=0.98,
CPU/request upper <=1.02 and latency/RSS upper <=1.05. This numeric gate alone
does not authorize adoption: functional checks, valid real-request profile
attribution and the one-cause/one-candidate selection remain required.
The historical `NOT_ESTABLISHED`, `FAIL`, `INCONCLUSIVE`, and rejected stream-only
CPU ratio `1.0508237154627784` are retained.

## Local preparation and checks

The commands and receipts in this section describe the original local preparation.
They are not new checks requested for the host-role correction.

From the worktree root:

```sh
pnpm install --frozen-lockfile
pnpm --dir tooling/benchmarks/http-comparison --ignore-workspace install --frozen-lockfile
pnpm --filter '@fluojs/platform-express...' --filter '@fluojs/testing...' \
  --filter '@fluojs/platform-cloudflare-workers...' --filter '@fluojs/platform-deno...' \
  --filter '@fluojs/platform-nextjs...' --filter '@fluojs/validation...' build
pnpm vitest run packages/platform-express/src/adapter.test.ts packages/platform-nodejs/src --maxWorkers=1
pnpm --filter @fluojs/platform-express typecheck
```

The extra build owners are prerequisites for existing isolated benchmark
typechecking/provenance. They are not Deno/Next performance work.
Install, dependency build, 260 Express/Node regressions and Express typecheck
passed. Raw logs: `results/issue-3942/install.log`, `build.log`, `adapter-checks.log`.
Initial issue harness correctness failed because the first esbuild invocation
preserved decorators; `harness-checks.log` retains that failure. The corrected
build targets Node24 and uses an issue-local config without workspace source
aliases, keeping published linked package builds external. The subsequent
16-test harness run and isolated typecheck passed in `harness-checks-2.log`.
Final expanded benchmark checks are recorded in `benchmark-checks.log`.
That complete isolated suite passed 458 tests with zero failures; the existing
Linux fractional CPU-counter test was skipped on macOS (459 collected). Its
typecheck and the correctness-only CLI smoke also exited 0. After tightening
the source/build binding, the issue-owned regression suite has 19 tests;
its final command log is `final-harness-checks.log`. Changed-file LSP
diagnostics and scoped Biome lint are clean.

From the isolated benchmark directory:

```sh
pnpm exec tsx src/issue-3942/build.ts
pnpm --ignore-workspace test
pnpm --ignore-workspace typecheck
pnpm exec tsx src/issue-3942/experiment.ts smoke 0
pnpm exec tsx src/issue-3942/experiment.ts prepare results/issue-3942/prepared-manifest-final.json
```

The five compiled entries are `dist/issue-3942/<fixture>/server.mjs`, with
source maps. `smoke 0` uses ephemeral listeners and exact status/body/header
checks only; it does not invoke load, resource sampling, or profiling.
`correctness-smoke.json` is explicitly not performance evidence.
`prepare` preserves observed source/build/fixture/dependency hashes and source
contents; it does not fabricate missing host controls or calibration.
The first `prepared-manifest.json` is invalid preparation evidence: its Git
pathspec omitted package sources. It is retained, not accepted. The corrected
`prepared-manifest-final.json` uses an explicit recursive Git glob and includes
the transitive linked runtime build closure and package manifests, not just
direct benchmark dependencies. The regression checks that Express/shared Node
request sources and the transitive diagnostics build actually exist in the
hash maps. `prepared-manifest-2.json` is retained as an intermediate, not the
measurement binding.

Historical Mac-server preparation manifest SHA256 (not a Windows serving binding):
`26a38f8d7c3e2dcaf87b4a7df6ddd08502095320d88687400e44b3f069654f92`.
Its source SHA256 is
`1de40e805ae689cda5e1fecdcbd4bb989ae6d96dc2ba53ace6bf12920da613f9`,
serving build SHA256 is
`15d206ab9062a25b9747240c9e9daa2437667b68591c315bfbebd2b8120ea517`,
and fixture SHA256 is
`6e25c604721a958d3d62c12e51e4f7dcf2c8880bad1aec6b867d2a6e79900619`.
The final 19-test issue suite, isolated typecheck, manifest generation and
scoped lint exited 0. HEAD is unchanged, `git diff --check` is clean, and
all persistent dirty paths are inside the accepted scope.

## Lead-only host binding

The original setup receipt proves only the superseded WSL-generator-to-Mac-server
direction and ten correctness-only load-client requests, not connectivity,
headroom, calibration or performance for the corrected Windows server:

`/Users/ayden/Documents/fluo/.omo/verification/http-performance-3939-3943-20261013-1a832301/setup-receipt.json`

Current measured Fluo server: Windows desktop WSL2 `DESKTOP-VLEUB8O`,
previously observed Node `v24.21.0`,
kernel `6.18.54.1-microsoft-standard-WSL2`,
CPU `Intel(R) Core(TM) i5-9400 CPU @ 2.90GHz`.
Current independent HTTP load generator: Mac `192.168.0.129`,
previously observed Node `v24.20.0`,
`/Users/ayden/.nvm/versions/node/v24.20.0/bin/node`.
The lead must newly observe executable/build/lockfile, host and transport identities
in their corrected roles, copy the final prepared source into the Windows
measurement worktree, and freeze the real identities there. None of the historical
Mac-server preparation manifests is a current serving plan.

The earlier Mac-server Node headroom run was stopped at 12/132 retained records:
one-to-four generators increased first-condition throughput by 57%-128%.
It is rejected environment diagnosis, not Windows server performance or
optimization evidence. Its records and failed interpretation are preserved;
no threshold is relaxed and no calibration PASS is inferred.

The lead must supply `results/issue-3942/hosts.json` with these machine-consumed
fields; missing values fail closed:

- `server` and `generator`: `hostname`, `nodeVersion`, `nodeExecutable`,
  `nodeExecutableSha256`, `kernel`, `wsl`, `cpu`, `quota`, `affinity`, `power`,
  `backgroundLoad`, `identityEvidenceSha256`. Explicit observed unlimited/all or
  not-applicable states are allowed; unknown/pending/not-observed are rejected.
- `serverOrigin`: a direct HTTP origin with a selected serving port.
- `bindHost`: `0.0.0.0`; `transport`: `direct-http`.
- `lease`: the lead's exclusive measurement lease identity.
- `generatorSshTarget`: the lead-configured SSH target for the Mac generator,
  not the old WSL generator target `wpfek@172.20.55.47`.
- `generatorLockfileSha256` and `generatorEntrySha256`: the actual prepared
  Mac generator lockfile and `load-client.mjs` hashes from a role-correct receipt.

Server hostname/runtime/executable hash are checked against the local serving
host. Actual generator hostname/runtime/kernel/CPU are checked in each raw
load result. Generator executable/lockfile/entry hashes and physical controls
remain bound to the lead's independent machine attestation; the existing
load-client response does not re-attest those file hashes on each request.
No SSH transport, remote installation, or remote build is added.

## Scheduled measurement commands (not run here)

Only the lead runs these after the Windows server and Mac generator are quiet
and the lease is exclusive. Run from `tooling/benchmarks/http-comparison` in
the Windows measurement worktree containing the final prepared source:

```sh
# The lead supplies role-correct transport; reuse existing load.ts unchanged.
# BENCH_SSH_HOST / BENCH_SSH_CONTROL / BENCH_REMOTE_DIR identify the Mac generator.
# BENCH_SERVER_HOST identifies the directly reachable Windows WSL2 serving address.
# BENCH_BIND_HOST is the Windows server bind address.
# Set ISSUE_3942_LEASE to the exact lease value in the lead-created hosts.json.

pnpm exec tsx src/issue-3942/experiment.ts freeze \
  results/issue-3942/hosts.json results/issue-3942/frozen-plan-windows-server.json
pnpm exec tsx src/issue-3942/experiment.ts headroom \
  results/issue-3942/frozen-plan-windows-server.json results/issue-3942/headroom-windows-fresh
```

The new immutable `frozen-plan-windows-server.json` includes the fixed policy and observed serving
source/build, Node, root/benchmark locks, resolved Express, fixture hash and
lead-provided server/generator identities. All evidence creation is exclusive
(`wx`/new directory); existing outputs are not overwritten. Timing authenticates
the startup nonce, local endpoint/listener PID, runtime, absence of instrumentation,
fixture entry and linked serving build hashes before and after each ordinary run.

Headroom has no automatic bottleneck-exclusion claim. The lead must create
`results/issue-3942/headroom-windows-assessment.json` with `rawSha256` naming the exact
headroom `raw.json`, `bottleneckExcluded: true`, and `evidencePath` naming an
issue-owned JSON diagnostic that justifies that conclusion. Scaling is
recomputed from all 30 raw observations. Unproven exclusion, drift, missing
conditions or a scaling gate failure prevents A/A.

```sh
pnpm exec tsx src/issue-3942/experiment.ts aa \
  results/issue-3942/frozen-plan-windows-server.json results/issue-3942/aa-windows-fresh \
  results/issue-3942/headroom-windows-fresh/raw.json \
  results/issue-3942/headroom-windows-assessment.json
pnpm exec tsx src/issue-3942/experiment.ts profile \
  results/issue-3942/frozen-plan-windows-server.json profile-windows-fresh \
  results/issue-3942/aa-windows-fresh/verdict.json
```

A/A preserves 160 ordinary samples with server CPU/completed requests, throughput,
per-run p95/p99, raw histograms and sampled RSS. `verdict.json` binds raw bytes,
and profiling revalidates all ten complete alternating conditions rather than
trusting a status label. `invalidAttempts`, interruptions, traffic failure
diagnostics and server stdout/stderr are retained by the existing evidence helper.
Generator failures preserve its original stdout/stderr through `load.ts`; successful
generator payloads are retained as complete parsed raw results.

Profiles use existing `runProfiles`, control-before/capture/control-after, raw
protocol, subject and validity checks under
`results/profiling/issue-3942/profile-windows-fresh/<fixture>/`.
Sampled allocation is not exact bytes/request. The lead must inspect real-request
facade/header/signal/body sample attribution and supplied source maps before
selecting one cause and one candidate. A valid profile capture is not itself
proof of a bottleneck. BEFORE/AFTER serving builds and one primary condition/metric
will be bound after that evidence, before candidate timing; none is selected now.

## Historical remaining work before parent rejection

Role-correct Windows-server headroom, A/A, CPU/allocation profiles, candidate
selection and finite BEFORE/AFTER/adoption or rejection were not run at this
historical checkpoint. The final decision above supersedes this proposed
resumption path. Preserve this worktree and its
dirty evidence. After the lead supplies successful calibration and attributable
profiles, resume this identity, implement only the evidenced Express-owned
candidate, add its required Changeset, run focused checks, and finally return the
exact committed issue-implement `Result`. Shared Node/runtime/http/benchmark API
or lockfile changes require a scope conflict report, not edits by this issue.
