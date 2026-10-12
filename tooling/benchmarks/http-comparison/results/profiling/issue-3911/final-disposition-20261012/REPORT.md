# Issue 3911 최종 후보 제외 보고

## 최종 disposition과 승인 범위

2026-10-12 owner 결정인 "미입증 후보 제외"에 따라 공통 Web header
lookup 후보를 출하하지 않는다. `performanceVerdict=NOT_ESTABLISHED`이며,
기존 측정의 `INCONCLUSIVE`는 그대로 유지한다. 후보 제외와 보고·정확성 검증
workflow의 완료는 performance PASS, 개선, 동등성 또는 전 플랫폼 비회귀를 뜻하지 않는다.

유효 계약은 `.omo/verification/3911-exclusion-preflight-20261012.json`이다.
Digest는 `90b5dc14fe87203e4a330b582fd7dafead1d4714bfea7b1c1d9e72fe262ab254`다.
최신 이슈 본문은 `.omo/verification/unproven-exclusion-issues-20261012.json`의
`number=3911` 항목이며, owner amendment는
`.omo/verification/3915-unproven-candidate-exclusion-20261012.json`이다.
기존 `3911-preflight.json`의 A09-A13, A17-A18, V10-V12, V17-V18에
해당하는 추가 수집·완전한 affected-platform 성능 행렬·numerical acceptance
완료 의무를 이번 work unit의 전제에서 제외한다. 수치 예산, 원본 verdict,
correctness/security 계약과 final-head review·GitHub CI·merge gate는 유지한다.
이미 승인된 제외 결정을 다시 승인받는 gate는 추가하지 않는다.

## 후보 경과와 최종 source

| 경과 | 원본 identity 및 판정 | 최종 처리 |
| --- | --- | --- |
| Allocation-only header lookup | `fbae0e55bd6a8438715f2002af74c2e6c385fe96`: `Object.keys(...).find(...)` 대신 own-enumerable scan을 사용했다. 기존 짧은 Bun 비교와 profile은 개선을 입증하지 못했다. | 후보를 제외하고 승인 base로 복원한다. |
| Response-owned header index | `342bcd9f1`에서 도입하고 `253c9c5bb5d99e3202521554636a9757a26c65cb`에서 freeze·transparent Proxy 경계를 수정했다. Long-window 비교의 RSS CV와 한 pair의 RSS 증가가 frozen 기준을 충족하지 못했고 전체 verdict는 `INCONCLUSIVE`였다. | `2f4dd790acac4fc5b73e04291b6a2481a5108e54`에서 이미 index, mutable cell, accessor를 제거했다. 다시 도입하지 않는다. |
| 최종 제외 | 시작 HEAD는 `2f4dd790acac4fc5b73e04291b6a2481a5108e54`이며 이전 후보 commits를 보존한 ordinary new commit으로 철회한다. | `packages/runtime/src/web.ts`를 base `1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18`와 byte-for-byte 동일하게 복원한다. |

후보-only `.changeset/http-common-request-pipeline-costs.md`를 삭제한다.
최종 base-to-head 공개 implementation, exports, manifest, build input,
문서화된 동작 및 release surface에는 이 issue의 변경이 없다.
`packages/runtime/package.json`의 publish 대상은 `dist`이고 build는 tests를
제외한다. 최종 누적 diff는 보존한 historical report, functional tests 및
이 disposition report뿐이므로 `CONTRIBUTING.md`와
`docs/contracts/release-governance.md`에 따라 새 Changeset은 필요하지 않다.
Package version, changelog, 다른 Changeset은 변경하지 않는다.

복원된 lookup에는 case-insensitive 이름 검색의 linear scan, `Object.keys`
임시 배열, callback 및 lowercasing 비용이 남는다. Live header mutation과
원래 casing을 보존하는 lookup, independent Set-Cookie 및 native `Headers`
변환, security defaults, body materialization, dispatch와 lifecycle 처리는
기존 계약을 수행하는 비용이다. 이 비용의 제거 가능성이나 전체 CPU 중
인과적 비중을 이번 disposition에서 새로 측정하거나 단정하지 않는다.
Request-ID 최적화도 구현하지 않았으며 기존 소유권 경계를 유지한다.

## 보존한 정확성 회귀 테스트

`web.test.ts`의 첫 테스트에서 Object.keys spy, allocation counter,
zero-allocation assertion과 최적화 전용 테스트 이름만 철회한다.
동일한 real Web factory, dispatcher, controller 및 security middleware
integration의 CSP `default-src 'self'`, `nosniff`, JSON Content-Type,
native response body `{ ok: true }` assertion은 그대로 유지한다.
철회한 allocation 조건은 새 계약에서 요구하지 않는 구현 비용 조건이다.

나머지 functional tests는 변경하지 않는다. First own-enumerable header
casing, mixed-case replacement, 직접 mutation/deletion, whole-map replacement,
inherited/non-enumerable 구분, string/array 값, 순서가 유지되는 independent
Set-Cookie, Vary, Content-Type, native response memoization, shallow freeze,
transparent Proxy, commitment 및 204/205/304 body suppression을 보존한다.
기존 body, request isolation, error, abort, multipart 및 SSE tests도 유지한다.
Security defaults, middleware/observer 순서, request scope 격리·정리,
controller override/accessor, falsy throw, body limit·단일 materialization·
원본 readability, abort 및 lifecycle/stream cleanup 계약을 변경하지 않는다.

## NAS allocation-only 비교: 원본 INCONCLUSIVE

원본은 `.omo/verification/nas-header-3911-20261011/summary.json`이며,
raw root는 `.omo/verification/nas-header-3911-20261011/header-results`다.

| 항목 | 원본 값 |
| --- | --- |
| Scope | BornArchive Linux x64 Bun1.4.2 stage-minimal equivalent concurrency64 only |
| Completed runs | 12 |
| Measured requests | 4,642,263 |
| Elapsed seconds | 1323.373550365 |
| evidenceErrors / invalidAttempts / budgetBreaches | `[]` / `[]` / `[]` |
| exitCode / verdict | `1` / `INCONCLUSIVE` |
| Baseline source | `1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18` |
| Candidate source | `2f4dd790acac4fc5b73e04291b6a2481a5108e54` |
| Baseline integration head | `b7b4aaa5f333d93ee68929fb061dee11902c0b61` |
| Candidate integration head | `bdb3fa568c9dc688a00cb83f2d32a7036916a77c` |

Source identities와 측정 harness를 통합한 heads는 서로 구분한다.
원본 inconclusive 이유는 다음과 같다.

- `throughputRps: paired ratio instability`
- `serverCpuMicrosPerRequest: paired ratio instability`
- `p95Ms: native block drift`
- `p99Ms: native block drift`

Budget breach가 없다는 관측은 PASS나 안정성을 입증하지 않는다.
Ratios, native controls, 원시 요청 결과 및 기준은 그대로 보존하며
threshold 완화, outlier 삭제, repeat-until-pass 또는 diagnostic/correctness
결과의 performance acceptance 승격을 하지 않는다.

## 증거 보존과 미측정 한계

`../local-20261008-st01a11dc4/REPORT.md`는 historical candidate report다.
그 안의 후보 구현 설명, allocation RED/GREEN, release 설명 및 당시
remaining acceptance는 그 시점의 기록이며 최종 출하 상태가 아니다.
기존 bytes를 수정하지 않고 SHA256
`0cf1501e0d49f65a119422ebff779c3dd789a96aad2f8e96e36fee885cb47088`을 보존한다.
부모 result subtree의 기존 raw captures, logs, reports와 실패·중단 증거도
변경하지 않는다. Historical `verify:release-readiness` scheduling 실패와
중단된 실행은 PASS로 재표시하지 않는다.

주요 원본 증거 위치는 다음과 같다.

- 이 worktree의 `tooling/benchmarks/http-comparison/results/profiling/issue-3911/`:
  allocation RED/GREEN, index mutation/freeze/Proxy RED/GREEN, 기존 host smoke,
  sandbox, adapter 및 correctness logs.
- `.omo/verification/3911-bun-matched-long-80af7ab-*`: index 후보의 plan,
  raw records, log, hashes, metric summary. BEFORE integration head
  `d67bc44fdda5cd5e4e959f69ff838b6200d5e941`의 framework packages는 승인 base와
  동일했고 candidate integration head `80af7ab1732ca50d11fa9908744fd7e287bdb056`의
  framework packages는 index source `253c9c5bb5d99e3202521554636a9757a26c65cb`와
  동일했다. 후보 RSS CV 11.19%, paired RSS CV 10.53%는 5% limit을 초과했고
  한 RSS pair는 18.98% 증가해 10% budget을 초과했다. 이 historical
  `INCONCLUSIVE`를 이후 NAS allocation-only 비교의 빈 budgetBreaches와 섞지 않는다.
- `.omo/verification/nas-header-3911-20261011/`: 위 12-run NAS comparison.
- `.omo/verification/3915-current-acceptance-status-20261011.md`: lane의
  completed evidence inventory. 당시 owner direction pending 문구는 historical이며
  2026-10-12 amendment가 최종 제외 방향을 정했다.

Full affected-platform candidate acceptance matrix는 완료되지 않았다.
Fastify/Express calibration의 불안정성, Workers local·Next App/Pages의 partial
calibration과 failed native Next condition, deployed Workers의 correctness-only
evidence는 위 inventory의 원래 의미를 유지한다. Supported, unsupported,
incomplete, failed, 미측정 coverage를 서로 바꾸거나 개선·동등성으로 해석하지 않는다.
Deno는 owner 결정에 따라 performance scope에서 제외되었지만 공개 지원 및
functional regression 의무를 철회하지 않는다. 다른 issue의 검증된 benchmark
tooling은 해당 owner에게 남고 이 issue에서는 harness source를 변경하지 않는다.
새 benchmark, profile, calibration, host smoke 또는 acceptance matrix는 실행하지 않는다.

## Local durable archive

`.omo/verification/unproven-exclusion-archive-20261012/receipt.json` 및
`plan.json`은 제외 전 historical snapshot의 완료 근거다.
`commandExitCode=0`, `gitBundleVerifyExitCode=0`, `archiveListingExitCode=0`,
`archiveMembers=5235`, `originalFilesRemoved=false`를 기록한다.

| Local archive | SHA256 |
| --- | --- |
| `candidate-history.bundle` | `be6410c2898cb3d3aa331990aa9d0e5c5f235ec273628f1c56ba9de9ca1249d4` |
| `worktree-raw-before-exclusion.tar.gz` | `00cfc4ebe237154e8a1330fb7fd9ad6d546b9698ae35b3e52dd224104b3f5b98` |

두 파일은 해당 `.omo/verification/unproven-exclusion-archive-20261012/`에 있는
local durable archives다. 원격 artifact publication이나 remotely downloadable
파일을 주장하지 않는다. Ignored `.omo` 증거 경로는 로컬 보존 위치이며 원격
다운로드 링크가 아니다. 이 pre-exclusion archive는 이후 final report 및 새 검증
evidence의 cleanup 전 durable 보존을 대체하지 않는다. 그 보존 확인은 lead의
기존 lane workflow에서 수행하며 이 stage는 cleanup 권한을 추가하거나 사용하지 않는다.

## 검증 경계와 남은 engineering gates

최종 source equality와 scope를 먼저 확인한 후 아래 focused checks를 순차 실행했다.
Vitest의 기존 packages-global-setup 및 prepared-build 검증을 우회하지 않았으며
dist writer가 완료된 뒤 typecheck를 실행했다.

```sh
pnpm vitest run --project packages packages/runtime/src/web.test.ts packages/http/src/dispatch/dispatcher.test.ts packages/http/src/middleware/security-headers.test.ts --maxWorkers=1
pnpm --filter @fluojs/runtime typecheck
pnpm exec biome check packages/runtime/src/web.test.ts
pnpm verify:changeset-release-lane -- --lane=stable --base-ref=1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18
git diff --check
```

| 이번 제외 구현의 evidence | 실제 결과 |
| --- | --- |
| `focused-vitest-20261012.log` | 3 files / 141 tests passed, exit 0, Vitest duration 24.24 seconds. 기존 global setup의 emitted-package builds도 완료했다. |
| `runtime-typecheck-20261012.log` | `@fluojs/runtime` typecheck exit 0. |
| `biome-20261012.log` | Changed test 1 file checked, no fixes, exit 0. |
| `changeset-release-lane-20261012.log` | Stable lane passed, exit 0; 101 existing pending package bump intents, 0 package version deltas. 이 issue의 새 release intent는 없다. |
| `archive-byte-equality-20261012.log` | 기존 evidence 26개 모두 pre-exclusion archive member의 SHA256과 일치, exit 0. 변경 전·후 같은 26개 파일의 hash inventory도 일치했다. |
| Source 및 diff 확인 | `web.ts`의 base-to-working-tree `git diff --exit-code`가 exit 0. Historical report의 starting-head-to-working-tree diff도 exit 0. 후보 Changeset은 없고 `git diff --check`는 exit 0. |
| Changed test diagnostics | LSP: no diagnostics. |

위 로그는 이 report와 같은 worktree-local subtree에 보존한다.
테스트 및 정적 검증 결과는 performance acceptance가 아니다.

최종 공개 source가 base와 동일하고 누적 diff가 tests/reports뿐인 이 계약에는
adapter 전체 suite, examples/sandbox matrix, 16-host smoke, harness 전체 suite,
성능/profile 행렬 및 full canonical local CI 반복 의무가 없다.
Pure-prose report를 고정하는 테스트도 추가하지 않는다.

이 stage의 종료 범위는 검증된 ordinary new local commit이다.
Final exact-head contract/code/verification 세 review axes, full final-head
GitHub CI, remote head equality, explicit `MERGEABLE`, lane-scoped merge와
cleanup 및 cleanup 전 새 evidence 보존 확인은 lead의 후속 gates로 남는다.
이 보고서는 해당 review/CI/merge의 완료를 주장하지 않는다.
