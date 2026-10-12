# #3912 미입증 후보 제외 및 플랫폼별 최종 disposition

## 판정과 승인 범위

전체 `performanceVerdict`는 **`NOT_ESTABLISHED`**다. Node request-wrapper
후보는 제외하고, Express 두 후보는 거절·복구 상태를 유지하며, Fastify에는
accepted candidate가 없다. 성능 개선, performance PASS, 개선 불필요 또는
완전한 성능 nonregression을 주장하지 않는다.

소유자의 `OWNER_APPROVED_COMPLETION_SCOPE_AMENDMENT`는 미입증 후보를
출하하지 않고 보고·정확성 검증을 마치는 방향으로 완료 범위를 변경했다.
새 passing candidate matrix 요구만 대체하며 원래 numerical verdict,
correctness, exact-head review와 merge 검증은 유지한다.

- Fresh issue: <https://github.com/fluojs/fluo/issues/3912>.
- Owner amendment: repository-root
  `.omo/verification/3915-unproven-candidate-exclusion-20261012.json`.
- Fresh issue body: `.omo/verification/unproven-exclusion-issues-20261012.json`.
- Accepted canonical contract:
  `.omo/verification/3912-exclusion-preflight-20261012.json`,
  SHA256 `26d929b7ad1dd97433d474c55f8c9e33f4c33750e4d4fd800ea03f8c1b999d44`.
- Pinned framework base: `1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18`.
- Exclusion starting head: `99614b72c801542b220e620b91dad7a944c64c40`.
- Branch/worktree: `issue-3912`, `.worktrees/issue-3912`.

이 보고서를 포함하는 ordinary exclusion commit은 `git log -1 --format=%H --
tooling/benchmarks/http-comparison/results/issue3912/REPORT.md`로 식별한다.
최종 head/base diff는 `git diff
1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18 <exclusion-commit>`으로 재현한다.
이 로컬 구현 완료는 engineering merge/CI 완료를 뜻하지 않는다. 새 head의
contract/code/verification review, full GitHub CI, remote head equality,
mergeability, merge 및 cleanup은 후속 lead 단계이며 여기서는 수행하지 않는다.

## 출하 표면과 보존한 회귀

`packages/platform-nodejs/src/node/internal-node-request.ts`를 pinned base와
byte-exact하게 복구했다. Base blob은
`6f454c8154033f78b9e5303bf7cc98ef31b8d8da`다. 후보 전용
`.changeset/http-platform-node-3912.md`를 제거했다. Express header normalization과
stream construction은 eager baseline 그대로이며 거절된 deferral을 재도입하지 않는다.
Fastify/Express runtime source와 세 adapter README EN/KO는 base와 일치한다.
공개 runtime/API/defaults/package metadata에 후보 변경을 남기지 않는다.

Base 대비 최종 tracked diff는 다음 네 파일의 test/report-only 변경이다.

- `packages/platform-nodejs/src/node/internal-node-request.test.ts`.
- `packages/platform-express/src/adapter.test.ts`.
- `tooling/benchmarks/http-comparison/results/issue3912/IMPLEMENTATION-20261008-2303.md`.
- `tooling/benchmarks/http-comparison/results/issue3912/REPORT.md`.

기존 후보 commit과 원래 IMPLEMENTATION 보고서·raw files·logs·summaries·실패 기록을 보존한다.
이번 ordinary commit은 복구·Changeset 제거·새 보고서만 기록한다.
`CONTRIBUTING.md`의 test/docs-only 예외에 따라 새 Changeset이 필요하지 않다.

Node의 기존 transport metadata 두 테스트와 추가된 **8개 회귀**를 그대로 유지한다.
Unread factories의 laziness, 첫·반복 access와 cookies/query cache identity,
explicit snapshot, synchronous factory failure 후 retry, lazy signal의 반복 관찰,
요청 간 cookies/query/params isolation, empty record 및 property descriptor 의미를
검증한다. 이들은 baseline에서도 통과한 correctness coverage이며 allocation 개선
또는 behavior RED의 증거가 아니다.

Express의 네 real-listener snapshot 조건과 facade 회귀도 그대로 유지한다.
기본 경로/user middleware full path, native route/duplicate-slash fallback의 eager
native header snapshot, numeric/array 값, `__proto__` own header, 직접 record mutation과
replacement identity, native-before-Fluo ordered cookies, 기본 `SAMEORIGIN`,
stream identity/replacement 및 drain listener cleanup을 검증한다.
Assertion 삭제·skip·약화 또는 lazy expectation으로 변경하지 않았다.

기존 request ID/header snapshot, body parsing/limits/rawBody/multipart cleanup,
native middleware ordering/termination/error chain, safe handoff/fallback,
serialization/status/cookies, cancellation, streaming/backpressure와 lifecycle 계약은
유지한다. 적용 harness는 `HttpAdapterPortabilityHarness`이며 runtime-managed
`PlatformComponent`용 lifecycle harness를 새 지원 계약으로 추가하지 않는다.

## Node.js 후보: 완료된 측정, INCONCLUSIVE, 제외

Repository-root `.omo/verification/nas-node180-candidate-3912-20261011/`의
`nodejs-summary.json`, `nodejs-integrity.json`, `reevaluation.json`이 원래 근거다.
Linux Node **24.21.0**, `stage-minimal`, `equivalent`, concurrency **64**,
warmup **30s**, measurement **180s**에서 **12 runs**, **7,856,265 requests**가
완료됐다. 기록된 첫 run 시작부터 마지막 run 종료까지 **2818.790038989s**이며
준비와 초기 parent verification은 제외한다. Raw-file hash **64개**가 일치했다.

- Producer baseline: `c554860cae0f05ebf8e95d079a02d3f58ed3f50d`.
- Producer candidate: `72ba42390d00cb693d900e0d34d7cb870e3cc2bb`.
- Validator head: `c169f9095a76b4b7d139427ff3cabf653413cdd0`.
- Validator: issue-3914의 `results/issue-3914/paired-aa.mts`,
  SHA256 `3b6ec3afd2c8d1ac53ac93ce7f4e6a0451679d531cae12e407b28aefd97cf6a6`.
- Schema/mode: `paired-node-180-v1` / `candidate`; original evaluator exit **1**.

유일한 inconclusive 원인은 `rssBytes: native block drift`다. Native RSS block CV
**5.584327506359987%**가 frozen **5%** limit를 초과했다.
`evidenceErrors`, `budgetBreaches`, `invalidAttempts`는 모두 비어 있지만
candidate acceptance는 없다. `PASS_OFFLINE_REEVALUATION_EQUALITY`는 corrected
evaluator가 원래 `INCONCLUSIVE` 판정을 동일하게 재현했다는 뜻이며 performance
PASS나 새 측정이 아니다. 원래 파일은 수정하지 않았다.

## Fastify·Express calibration과 거절 이력

`.omo/verification/nas-node180-3912-20261011/rollup.json`은 same-code calibration이다.
Producer head `c554860cae0f05ebf8e95d079a02d3f58ed3f50d`, framework source는 pinned
base다. Linux Node 24.21.0, minimal/equivalent/c64, 30s warmup/180s measurement
조건의 36 runs, **21,188,080 requests**, raw-file hash 192개를 기록한다.

| Platform | Runs / requests | 원래 판정과 한계 |
| --- | --- | --- |
| Node.js | 12 / 7,824,418 | `OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE`; same-code calibration만 해당하며 후보 개선 승인이 아님 |
| Fastify | 12 / 9,199,248 | `INCONCLUSIVE`: native throughput, CPU/request, p95 block drift; candidate acceptance 부재 |
| Express | 12 / 4,164,414 | `INCONCLUSIVE`: native p99 block drift; candidate acceptance 부재 |

Aggregate process exit **1**은 두 nonpassing calibration 판정이며 36 runs 자체는
valid traffic으로 완료됐다. Calibration을 native/Fluo/Nest candidate BEFORE/AFTER로
대체하지 않는다. 개별 summary/integrity 및 `prestart.json`이 source/plan/build
identity를 보존한다.

Express 거절 이력은 변경하지 않은 `IMPLEMENTATION-20261008-2303.md` 및
repository-root `.omo/verification/3912-express-minimal-diagnostic-summary.json`,
`3912-express-paired-d261198ec-summary.json`에 연결된다.

- Combined header/stream candidate `a39c0456f65ae71408f72820a5eb7514de09505f`:
  clean base와 동일 harness, equivalent/minimal/c64의 native/Fluo/Nest 18 samples.
  Fluo throughput **-5.04%**, CPU/request **+4.51%**, p95 **+4.79%**, p99 **+2.65%**.
  Native/Nest controls는 stable 또는 개선됐지만 Fluo 악화로 `CANDIDATE_REJECTED`.
  당시 budget은 frozen되지 않아 formal budget 판정은 `not-evaluated`다.
- Stream-only candidate `d261198ec003f7ec9d5f62c019b5d8e179368a3a`:
  3 alternating paired blocks, 18 samples, collection exit 0.
  Throughput **-1.29%**, CPU/request **+4.87%**, paired CPU ratio
  **1.0508237154627784**가 frozen **1.05** ceiling을 초과했다.
  p95 **+11.72%**와 candidate/paired CV의 5% 초과는 latency `INCONCLUSIVE`이지
  PASS가 아니다. `REJECT_CANDIDATE`, `canonicalAcceptance: false`를 유지한다.
  Successful warmup raw와 dedicated serving-runtime receipts 부재도 원래 한계다.

기존 60s calibration의 Node/Fastify throughput·CPU native drift와 Express p99
native drift는 모두 `INCONCLUSIVE`로 유지한다.
`.omo/verification/nas-node-3912-20261011/retained-calibration-analysis.json`의
36 runs와 resource samples를 offline 분석한 결과는 causal proof가 아니다.
높은 Fastify generator CPU만으로 saturation/headroom을 입증할 수 없고,
Express percentile 재계산 일치는 p99 metric 교체를 허용하지 않는다.
Host/kernel 제약, warmup stationary 여부 미입증, historical Nest 비교와 미측정
scenario/configuration/concurrency 조건은 그대로다. Deno 성능 제외는 공개 지원과
functional regression 의무를 제거하지 않는다. 새 measurement/profile/matrix,
repeat-until-pass, threshold 완화, outlier 삭제 또는 diagnostic 승격을 수행하지 않았다.

## 새 제외 구현의 focused verification

이번 검사 환경은 macOS arm64, Node **24.20.0**, pnpm **10.4.1**이다.
위 Linux Node 24.21.0 측정 환경과 구분한다. 기존 설치 환경을 사용했으며 새
provisioning 또는 full local CI를 수행하지 않았다.

| Command | Exit / 결과 |
| --- | --- |
| `pnpm --filter '@fluojs/platform-fastify...' --filter '@fluojs/platform-express...' --filter '@fluojs/platform-nodejs...' build` | 0; affected dependency closure build |
| `pnpm --dir packages/platform-nodejs typecheck` | 0 |
| `pnpm --dir packages/platform-express typecheck` | 0 |
| `pnpm --dir packages/platform-fastify typecheck` | 0 |
| `pnpm exec biome check packages/platform-nodejs/src/node/internal-node-request.test.ts packages/platform-express/src/adapter.test.ts` | 0; 2 files, no fixes |
| `pnpm exec vitest run --project packages packages/platform-fastify/src/adapter.test.ts packages/platform-express/src/adapter.test.ts packages/platform-nodejs/src --maxWorkers=1` | 0; 19 files, **314 tests passed** |
| `pnpm verify:changeset-release-lane -- --lane=stable --base-ref=1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18` | 0; stable lane, 0 package version deltas |

Build와 typecheck는 순차 실행했다. Tests에는 A03/A04 회귀와 기존 real-listener
portability, Node lifecycle 및 public-surface 검사가 포함됐다. 복구한 Node source의
LSP error diagnostics는 없었다. 이 PASS는 correctness/release-lane 검사 결과이며
performance PASS가 아니다. 이전 계약의 review/check 사실을 새 digest에 재사용하지 않는다.

새 raw check logs는 이 worktree의 같은 result subtree에만 보존한다:
`exclusion-build-20261012-0248.log`, `exclusion-focused-20261012-0252.log`.
이 ignored local logs도 원격 downloadable artifact로 주장하지 않는다.
최종 diff/byte equality 검사는 별도 `exclusion-source-20261012-0255.log`에 연결한다.
Unchanged examples/governance/public-export scan은 candidate withdrawal만을 이유로
다시 실행하지 않았으며 repository-wide coverage는 후속 full GitHub CI가 담당한다.

## Local durable archive

Repository-root `.omo/verification/unproven-exclusion-archive-20261012/receipt.json`
및 `plan.json`은 **제외 편집 이전**의 archive receipt다.

- `candidate-history.bundle`: SHA256
  `be6410c2898cb3d3aa331990aa9d0e5c5f235ec273628f1c56ba9de9ca1249d4`;
  archive command exit **0**, `git bundle verify` exit **0**.
- `worktree-raw-before-exclusion.tar.gz`: SHA256
  `00cfc4ebe237154e8a1330fb7fd9ad6d546b9698ae35b3e52dd224104b3f5b98`;
  listing exit **0**, **5235 members**.

원본 파일은 남아 있다. 이 archive는 local durable snapshot이며 remote downloadable
artifact도 이후 final cleanup archive도 아니다. Ignored `.omo` evidence는 이 보고서의
tracked 위치만으로 원격에서 다운로드할 수 없다. Plan은 cleanup을 승인하지 않는다.
나중의 report/check/review evidence를 cleanup 전에 worktree 밖에 보존하는 책임은 lead에 있다.
