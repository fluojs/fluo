# #3913 Bun 최종 disposition 및 Deno 성능 범위 제외

## 현재 판정과 승인 범위

2026-10-12 소유자 지시 `미입증 후보 제외`에 따라 #3913은 기존 측정과 한계를
보고하고 역사 증거를 보존한다. 성능 수용 판정은 `NOT_ESTABLISHED`다.
Bun 고유 runtime 최적화나 독립적으로 수용된 adapter 개선은 없으며,
완전한 Bun acceptance matrix도 없다. 개선을 입증했거나 개선이 불필요함을
입증했다는 결론으로 종료하지 않는다.

계약 출처는 fresh [#3913](https://github.com/fluojs/fluo/issues/3913) title/body,
`CONTRIBUTING.md`, `docs/contracts/behavioral-contract-policy.md`,
`packages/platform-bun/README.md` 및 `README.ko.md`다. 아래 `.omo/verification/`
경로는 repository root의 **local-only 증거 위치**이며 원격 다운로드 링크가 아니다.

- 승인 변경: `.omo/verification/3915-unproven-candidate-exclusion-20261012.json`
  (`OWNER_APPROVED_COMPLETION_SCOPE_AMENDMENT`).
- 승인 preflight: `.omo/verification/3913-exclusion-preflight-20261012.json`,
  digest `88f2ef4ec8b60ed841919d86798adfd82e4199aee48a27a59e3e3f7452d2c5f0`.
- 원본 inventory: `.omo/verification/3915-current-acceptance-status-20261011.md`.
  이 inventory의 당시 소유자 결정 대기 문구는 이후 승인 변경으로 대체되었으나
  당시 수치와 판정은 유지한다.
- 수정 시작 HEAD: `15443d0c4c55f66c504b02b81438846c4980eb4a`.

승인 변경은 새 candidate 성능 행렬을 통과해야 작업 단위를 완료할 수 있다는
요구를 대체한다. 기존 수치 판정, 정확성 계약, exact-head review와 GitHub CI
요구는 대체하지 않는다. 이 보고서는 보고·검증을 위한 로컬 산출물이다.
Engineering workflow 완료는 이후 review, final PR head의 full GitHub CI,
mergeability 확인, merge, cleanup 및 lane retrospective로 확인해야 하며,
현재 그 완료를 주장하지 않는다. 이후 workflow 완료도 성능 PASS를 뜻하지 않는다.

## Bun same-code calibration의 제한된 통과

`.omo/verification/nas-benchmark-20261011/summary.json`의 판정은
`OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE`, exit 0이다. 완료된 12 runs와
4,607,948 measured requests는 **same-code A/A calibration**에 한정된다.

| 식별 항목 | 원본 기록 |
| --- | --- |
| Framework source (X/Y 동일) | `1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18` |
| Harness head | `b7b4aaa5f333d93ee68929fb061dee11902c0b61` |
| Host/runtime | BornArchive Linux x64, kernel `4.4.302+`, Bun `1.4.2` |
| 조건 | `stage-minimal` / `equivalent` / concurrency `64` |
| Protocol | warmup 30초, measure 60초, minimum completed requests 20,000 |
| 순서 | `N X Y N`, `N Y X N`, `N X Y N`; N은 native-bun, X/Y는 같은 BEFORE의 fluo-bun |
| Frozen plan | `.omo/verification/nas-benchmark-20261011/aa-frozen.json` |
| Plan SHA256 | `e0e43df2e59b22cae6e6e7d2b015d121123875adcdf887b99ca9c52ffa3c6578` |
| Raw records | `.omo/verification/nas-benchmark-20261011/results/`의 `plan.json`, `journal.json`, `decision.json`, `run-*.json` |

다른 scenario, configuration, concurrency, 플랫폼, candidate acceptance 또는 전체
성능 예산으로 일반화하지 않는다. NAS kernel의 공식 지원 경계도 이 관측으로
바뀌지 않는다. `.omo/verification/3915-paired-aa-warm-generator-summary-20261011.json`
의 이전 same-code 통과 및 그보다 앞선 INCONCLUSIVE도 원래 source/head와 raw
위치에 보존되며 현재 보고서 HEAD의 성능 증거로 재표시하지 않는다.

## #3911 공통 header 후보: 미수용·출하 제외

공통 header 후보는 #3911 소유이며 #3913의 Bun 고유 구현이 아니다.
`.omo/verification/nas-header-3911-20261011/summary.json`은 완료된 **12 runs,
4,642,263 measured requests**, `invalidAttempts: []`, `budgetBreaches: []`,
`evidenceErrors: []`를 기록하지만 판정은 **INCONCLUSIVE**, exit 1이다.
Throughput와 CPU의 paired-ratio instability, native p95/p99 drift를 그대로 유지한다.
Budget breach가 없다는 사실은 후보의 개선이나 수용을 증명하지 않는다.

| 식별 항목 | 원본 기록 |
| --- | --- |
| baselineSource | `1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18` |
| candidateSource | `2f4dd790acac4fc5b73e04291b6a2481a5108e54` |
| baselineHead | `b7b4aaa5f333d93ee68929fb061dee11902c0b61` |
| candidateHead | `bdb3fa568c9dc688a00cb83f2d32a7036916a77c` |
| 조건 | BornArchive Linux x64 Bun `1.4.2`, `stage-minimal` / `equivalent` / concurrency `64` only |
| Raw root | `.omo/verification/nas-header-3911-20261011/header-results` |

이 후보는 미수용·출하 제외 대상이며 source 복원은 #3911의 범위다.
위 BEFORE/AFTER 기록은 존재하는 원본 증거다. 누락된 증거로 표현하거나
최종 head에서 얻은 성능 결과로 재표시하지 않는다.

## Deno 성능 제외와 역사 진단 보존

Deno는 소유자가 제외한 성능 범위로 유지한다. 추가 Deno 조사, profile,
비교, 최적화 또는 측정을 재개하지 않는다. 공개 Deno 지원과 기존 기능,
portability 및 native correctness 회귀 의무는 철회하지 않는다.

같은 디렉터리의 [최초 보고](./deno-close-scope-blocker-20261008T2315.md),
[lead 판정](./lead-abort-adjudication-20261008.md),
[diagnostic script](./deno-close-diagnosis-20261008T2315.mjs)와
[raw log](./deno-close-diagnosis-20261008T2315-run1.log)를 보존한다.
Script와 log의 bytes는 수정 시작 HEAD와 동일하게 유지한다.
당시 source `1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18`, digest, 관측, 실패,
미검증 항목과 추가 작업 제안은 역사 기록이며 재작성하지 않는다.
당시 제안은 현재 승인 범위의 실행 요구가 아니다.

기록된 Deno `2.9.7` (V8 `15.0.245.2-rusty`, TypeScript `6.0.3`)의 5개 실제
요청과 constructed pre-abort 사례는 native mechanism/correctness 진단뿐이다.
Fluo conformance, CPU, 할당, throughput, capacity 또는 최적화 acceptance
증거가 아니다. Private cache observer는 diagnostic-only·version-dependent이며,
native signal 교체나 legacy-abort 비활성화의 근거가 되지 않는다.

## 유지되는 계약과 후속 검증

이 변경은 report와 날짜가 명시된 역사 보고 pointer에 한정된다. Public runtime,
API, package contents, security defaults, lifecycle 또는 지원 범위 변경은 없다.
Bun README 쌍의 body 소비, 요청 격리, status/header, native-route fallback,
abort, streaming 및 retained shutdown drain 계약과 의미 있는 correctness
회귀를 유지한다. 공개 산출물 변경이 없으므로 `CONTRIBUTING.md`의 release
정책에 따라 Changeset을 추가하지 않으며 Book의 공개 계약 설명도 바꾸지 않는다.

Focused checks는 `git diff --check`, 보존된 script의 `node --check`, 원본 bytes
및 pointer-only 변경 확인이다. `node --check`는 구문 검사일 뿐 script를
import하거나 실행하지 않는다. Package build/typecheck, native conformance,
새 성능 행렬 또는 full local CI를 실행한 결과로 주장하지 않는다.
계약·code·verification 세 축의 exact-head review와 final PR full GitHub CI는
lead의 후속 단계이며 아직 완료된 근거가 아니다.

## Local durable archive

`.omo/verification/unproven-exclusion-archive-20261012/receipt.json`과 `plan.json`은
제외 수정 전 local durable snapshot의 근거다. Receipt는 `commandExitCode: 0`,
`gitBundleVerifyExitCode: 0`, `archiveListingExitCode: 0`, **5235 members**,
`originalFilesRemoved: false`를 기록한다.

- `candidate-history.bundle` SHA256:
  `be6410c2898cb3d3aa331990aa9d0e5c5f235ec273628f1c56ba9de9ca1249d4`.
- `worktree-raw-before-exclusion.tar.gz` SHA256:
  `00cfc4ebe237154e8a1330fb7fd9ad6d546b9698ae35b3e52dd224104b3f5b98`.

원본은 제자리에 유지한다. 이 archive는 원격 게시 artifact도, 최종 cleanup
archive도 아니다. 원래 FAIL, INCONCLUSIVE, unsupported 및 incomplete 상태를
유지하며 threshold 완화, outlier 삭제, diagnostic-to-acceptance 승격이나
repeat-until-pass로 수용 판정을 바꾸지 않는다.
