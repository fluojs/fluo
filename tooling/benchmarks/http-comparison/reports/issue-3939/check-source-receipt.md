# #3939 local implementation check/source receipt

## 범위 / Scope

2026-10-13 canonical `issue-implement` 마무리입니다. Branch `issue-3939`,
starting HEAD `ce70426f3bf29430c4eb941f8e94baaf8f78d364`, preflight
`59bd0578c5701d29210ee000812732034981284b578d0b4abee296d89c9ad6ba`를 유지합니다.
기존 dirty harness·collector·test·policy·report를 보존해 로컬 커밋에 포함합니다.
이번 마무리는 EN/KO 문서 정정과 source/check 연결만 수행하며 production runtime을
수정하거나 성능을 재측정하지 않습니다. 최종 SHA와 이 receipt의 hash는 커밋 후
별도 로컬 `results/issue-3939/issue-implement-check-source.json`에 기록합니다.

This finalization preserves the existing dirty harness, collector, tests, authored
policies, and reports in one local commit. Only documentation was corrected here;
production runtime and measured source are unchanged. The post-commit local
receipt binds the final SHA and this document's hash. Local completion is not
performance acceptance, issue closure, PR readiness, or lane completion.

## Source 연결 / Source binding

아래 경로는 benchmark directory 기준입니다. Preparation receipt의 source/test
7개 hash가 모두 현재 source와 일치합니다. Windows `frozen-windows-02.json`의
435개 source/test hash도 Windows worktree prefix를 현재 worktree로 치환해
대조했으며 불일치 0개입니다. Build를 재실행하거나 다른 host identity를 새로
인증한 결과는 아닙니다. Preparation의 과거 README hash는 최종 문서와 다르며
문서 검증을 과거 test PASS로 대체하지 않습니다.

All seven source/test hashes in the preparation receipt match current files.
All 435 source/test hashes in the Windows frozen manifest also match after
mapping only the worktree prefix. This authenticates unchanged source, not a
fresh build, host authentication, or test run. Earlier report hashes intentionally
do not match finalized documentation.

| File | SHA-256 |
| --- | --- |
| `src/issue-3939/analysis.ts` | `ae26cb8b2d62ff0b451b59c774ed2a31d0af0823528c199e12352d57b6a55b95` |
| `src/issue-3939/experiment.ts` | `abc9e6a305207a6c3ed3d099cb64512b8c248aa1445e38270e93a7586e5a42a3` |
| `src/issue-3939/fixtures.ts` | `7d3fec2a3151e0ca8c2b1c36d65b9f12a06ef2ffc8f0790392945ca44e24a4c4` |
| `src/issue-3939/load-client.ts` | `b6a38de8ec5ab35dcff2b122b36617fd4ac84c8cba221e3695ff66861cc04e32` |
| `src/issue-3939/plan.ts` | `b8965d918e219638b0b8dc87599cb49023f7a7154fed6df07074557e42bc9283` |
| `src/issue-3939/server.ts` | `8e393d5d4ac4603e605c623246996cddc359969fa44800289066233cd442d06c` |
| `src/issue-3939/storage.ts` | `c6f8e937e63317a63da28816b1209652845e73fd56ce6bc2654451df4c80e151` |
| `src/traffic.ts` | `a256ed2f892d7c9c0ad4cbd6f2b23fae3f64dc5882fc5d76de159447987699a8` |
| `tests/issue-3939.test.mts` | `f042d639a6bbbb11c55b84532cbb09b10e2f187d77e9cf5ea2d7f996945317ed` |
| `tests/traffic-utf8.test.mts` | `7dc5c812ba9316403a65faef6fd8916d642946d748982f9ccdc3862da7b2aa41` |

Package wire test
`packages/platform-nodejs/src/node/node-response.wire.test.ts` SHA-256:
`c339783773524572e57fb13c38877ed80407cfb97043d51cf898fe5d82210abd`.

## 과거 검사 / Historical checks

다음은 재실행 결과가 아닌 보존된 결과입니다. `results/issue-3939/` 로그는
ignored 상태로 보존하며 tracked source에 추가하지 않습니다.
The following are retained historical results, not reruns. Raw logs remain ignored.

| Check | Retained result | Log / receipt SHA-256 |
| --- | --- | --- |
| `node --import tsx --test tests/traffic-utf8.test.mts` before repair | RED, exit 1, 2 regression failures | `collector-utf8-red.log`: `3c52ec9438dd56f5bade5f42fdec1e6dae45f0b6a5ca3ada38fbd07785781a8a` |
| `node --import tsx --test tests/traffic-utf8.test.mts tests/issue-3939.test.mts` | exit 0, 48 passed, 0 failed | `collector-integrity-final.log`: `b5774b5c7e95e35ae79be6a1d5bc025cbfb6105889052ad9f8142fb26da1959a` |
| `node --import tsx --test tests/traffic-utf8.test.mts` after type narrowing | exit 0, 5 passed, 0 failed | `collector-utf8-settled.log`: `c83a2ca4e9e1b19d74fff82827276deb27664dc575bd2e9f31e8ae471c9e27b1` |
| benchmark `pnpm typecheck` and five-source Biome | exit 0 | `collector-checks-settled.log`: `717300a7293413df4b987e09e2aab2177ebe6a0aae3120b64b37153e06847c5d` |
| benchmark `pnpm test` | 487 passed, 0 failed, 1 platform skip | `collector-benchmark-full.log`: `43487d824efb044ea8fa68fc8e89cafc85bdb513ce883b8eef23b56c7a151367` |
| six Node response/index/portability suites listed in README | 194 passed in 6 files | `focused-node-initial.log`: `3c2fb538376bab0dfc963f956f660341c51c38e84ddfceaa71b26da2b57de2d1` |

`collector-integrity-preparation.json` SHA-256:
`e9e3dfba19d6e716449528550aadbe1c7055ad552d3d1b64d048270598f20a25`.
Parent의 외부 `collector-restart-adjudication.json`은 Windows focused 48 pass와
위 benchmark 결과를 기록하며 같은 preparation source-set digest
`b8ab20aa98d5e9db92266b21c6e3bcd3a3b004cad0fd817e5b5a7082aea2ef9f`에 연결합니다.
그 receipt SHA-256은
`d18797c14891812cb993678396eaffabf90a89a94289b2a9fada9640e80c3d89`입니다.
이는 parent의 보존된 판정이며 이번 작업에서 Windows 검사를 직접 재실행한
증거가 아닙니다. 외부 `windows-node-harness.log`의 이전 30-pass 기록을 48-pass
로그로 표시하지 않습니다.

The parent's external adjudication binds Windows focused 48 pass and the full
benchmark result to the same preparation source-set digest. It is retained
parent evidence, not a Windows check run by this finalization. The earlier
30-pass `windows-node-harness.log` is not relabeled as a 48-pass log.
Historical failed Biome/typechecks and all invalid measurement attempts remain.

## 마무리 검사 / Finalization checks

Input/Identity validators passed before edits. Source hash reconciliation
passed (7 preparation entries and 435 frozen source/test entries, zero mismatch).
LSP diagnostics reported none for all 11 changed source/test files.
The following command exited 0, checking 9 files with no fixes; repository
Biome configuration excludes the two `.mts` tests, which were checked by LSP
and the retained benchmark typecheck:

```sh
pnpm exec biome check packages/platform-nodejs/src/node/node-response.wire.test.ts tooling/benchmarks/http-comparison/src/traffic.ts tooling/benchmarks/http-comparison/src/issue-3939/analysis.ts tooling/benchmarks/http-comparison/src/issue-3939/experiment.ts tooling/benchmarks/http-comparison/src/issue-3939/fixtures.ts tooling/benchmarks/http-comparison/src/issue-3939/load-client.ts tooling/benchmarks/http-comparison/src/issue-3939/plan.ts tooling/benchmarks/http-comparison/src/issue-3939/server.ts tooling/benchmarks/http-comparison/src/issue-3939/storage.ts tooling/benchmarks/http-comparison/tests/issue-3939.test.mts tooling/benchmarks/http-comparison/tests/traffic-utf8.test.mts
```

EN/KO report command blocks are identical. Semantic comparison covered figures,
verdicts, historical failures, roles, limitations, required later stages, release
rationale, and the two corrections: configured duration is 10 seconds (observed
autocannon wall duration may be 11 seconds); Windows must unset
`BENCH_SSH_CONTROL` unless a valid Windows-side socket is deliberately configured.
The Mac master socket cannot be reused there. Both authored policy JSON files
parse and retain their original historical preparation statuses and digests.
`git diff --check` passed before staging, and `git diff --cached --check` passed
for all 19 staged authored files. Both policy JSON companions are in the Git
index, so a clean consumer checkout retains them. No raw/log/generated/cache/dist
files or measurement matrices were staged. No prose-pinning test was added.

EN/KO 의미·명령을 대조했고 수치·판정·실패·역할·제한·후속 절차가 일치합니다.
위 검사는 신규 기능 test나 성능 측정이 아닙니다. 문서 변경으로 전체 benchmark를
반복하지 않았습니다. Public runtime/API/package contents/release metadata 변경이
없어 `CONTRIBUTING.md`의 test-only/private tooling 예외에 따라 Changeset은 없습니다.
Book·package README 계약도 변경하지 않았습니다.

Full local CI, docs CI, independent exact-head reviews and remote actions were
not run. Later lane stages own selected reviews and PR-head GitHub CI. No
performance PASS, benefit, closure, or readiness judgment is made.
The external archive remains the local file named in `evidence-receipt.md`,
SHA-256 `c586b566d86ac0c258c8fa5c164e11e5c3a55f3fbdbb9654d47a90dc227aae62`;
it is not a public download. All raw/manifest/index/verdict originals remain intact.

## Hash guard fix-back / hash guard 보강

2026-10-13 fix-back attempt 1은 starting HEAD
`9ceb42dc34c9851a055b8017ae8c606be4df6ca8`에서 지정된 code blocker만
보강합니다. 위 source/check 대조는 이전 구현의 역사적 기록입니다.
이번 테스트 hash는
`9b9256881f6f261151ef7c641553c4e873cdf04a7837b3a6d61f5507cffb3f98`이며,
과거 preparation/Windows test hash 일치를 새 테스트에 적용하지 않습니다.
원본 reference와 byte length를 유지하고 valid JSON의 throughput average를
`500`에서 `501`로 변조합니다. 실제 `evaluateRawIndex` ->
`readRawRecords` -> `readRawShard` 경로에서 `ExperimentInputFailure`와
정확한 `Tampered raw shard bytes or hash` 오류를 단언합니다.

Fix-back attempt 1 changes only the supplied hash-guard coverage blocker from
the starting head above. Previous source/check bindings remain historical.
The new regression retains the original reference and byte length, changes
valid JSON throughput from 500 to 501, and asserts the precise typed hash
failure through the real evaluator and shard reader. Historical preparation
and Windows test hashes do not authenticate this new test.

SHA-256 비교 `|| sha256(bytes) !== reference.sha256`만 임시 제거한 RED는
exit 1, 1 failed, `Missing expected rejection`입니다. 길이·path·JSON·평가
검사는 그대로였으므로 다른 guard의 실패를 hash 검증으로 오인하지 않습니다.
복원 후 `storage.ts`는 byte-for-byte 원본과 일치하며 SHA-256은
`c6f8e937e63317a63da28816b1209652845e73fd56ce6bc2654451df4c80e151`입니다.
Focused harness는 단일 실행에서 49 passed, 0 failed, 0 skipped, exit 0이며,
`pnpm typecheck` exit 0, changed-test LSP diagnostics 0입니다.

Removing only the SHA-256 comparison produced assertion-level RED: one failure,
exit 1, missing expected rejection. Restoring it reproduced the original
storage bytes. The focused harness passed once with 49 tests and no failures or
skips; benchmark typecheck passed and the changed test has no LSP diagnostics.

Commands run from `tooling/benchmarks/http-comparison`:

```sh
node --import tsx --test --test-name-pattern='equal-byte-length valid JSON tamper' tests/issue-3939.test.mts
node --import tsx --test tests/traffic-utf8.test.mts tests/issue-3939.test.mts
pnpm typecheck
```

Unique raw logs below are relative to `results/issue-3939/` and remain ignored:

| Check | Log | SHA-256 |
| --- | --- | --- |
| RED: hash comparison removed | `hash-guard-fix-back-20261013-c9fee003-07a2-47e8-ae08-1ac468e34ece-red.log` | `4e70832d313670dbe54b9776aca92d48e06edb96483ee2a41650ee7fa13963dc` |
| GREEN: original guard restored | `hash-guard-fix-back-20261013-c9fee003-07a2-47e8-ae08-1ac468e34ece-green.log` | `17fc9eb20b779971aae070728b7ea34cfbfc80951bf8c866ad6f925c47a81e49` |
| Typecheck | `hash-guard-fix-back-20261013-c9fee003-07a2-47e8-ae08-1ac468e34ece-typecheck.log` | `041fde050af445dcb3376f15ba6c31d19191c8d2b1de3afee3d73d092bcb5d8c` |

커밋 후 같은 root의
`hash-guard-fix-back-20261013-c9fee003-07a2-47e8-ae08-1ac468e34ece-receipt.json`에
새 HEAD, 이 문서·테스트·storage·로그 hash와 unchanged preflight를 연결합니다.
측정은 재실행하지 않았으며 132 records, headroom `NOT_ESTABLISHED`,
performance `INCONCLUSIVE`를 유지합니다. 측정 판정 원본 hash
`824f5fbce13e9e473bc769c739d7e321e776b97bb76eab03b964318edb72cf20`도
변경 없습니다. 모든 기존 raw·실패·receipt를 보존합니다.

The post-commit receipt binds the new HEAD to this report, test, restored
storage, logs and unchanged preflight. No new measurements ran; the existing
132-record measurement verdict and its hash remain unchanged. This test-only
private tooling fix needs no Changeset under `CONTRIBUTING.md`.
Full local CI and remote actions were not run. All three selected axes
(contract/code/verification) require fresh reviews on the new head; no old
review PASS is carried forward. These reviews belong to the parent lane.
