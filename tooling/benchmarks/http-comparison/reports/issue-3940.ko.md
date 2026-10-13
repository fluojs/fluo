# #3940 Bun URL 중복 파싱 검증: 유한 경로 마무리

상태: **INCONCLUSIVE**. 승인된 유한 candidate-selection 경로를 종료합니다.
로컬 구현 완료는 성능 PASS, issue close 또는 laneDone 판정이 아닙니다.

## 판정과 측정 범위

Parent의 Windows desktop WSL2 Bun 1.4.2 SERVER와 독립 Mac Node v24.20.0
HTTP generator에서 동일-source A/A **240/240** records를 완료했습니다.
24조건 중 **19조건**이 고정 안정성 또는 A/A 동등성 기준을 통과하지 못했습니다.
완료 요청은 **62,263,421**, traffic failures와 invalid attempts는 모두 **0**입니다.
Measured span은 **12,587.852초**이며 첫 measurement 시작은
`2026-10-13T05:33:44.463Z`, 마지막 종료는 `2026-10-13T09:03:32.315Z`입니다.
이는 측정 구간 경과 시간이며 local/GitHub CI 예산 증거가 아닙니다.
Source-bound evaluator는 exit **1**, **INCONCLUSIVE**를 반환했습니다.

Headroom, CPU/allocation profiles, 후보 선택, BEFORE/AFTER는 진행하지 않습니다.
같은 설계의 재시도, outlier 삭제, threshold 완화는 하지 않습니다.
URL 중복 파싱의 요청별 CPU/allocation 비용과 최적화 이득은 **NOT_ESTABLISHED**입니다.
Production runtime 최적화는 없으며 기존 handoff/Web 요청 계약을 유지합니다.

## 신원과 원본 보존

- Branch/worktree: `issue-3940` / `.worktrees/issue-3940`.
- 시작 HEAD: `ce70426f3bf29430c4eb941f8e94baaf8f78d364`.
- 승인 preflight: `b06012382c0f87357321ef621761e4884995d799b0121c71f1fd2341ef9a5bdb`.
- Server: `DESKTOP-VLEUB8O`, Bun `1.4.2`, `192.168.0.10:33919`.
- Generator: `mac-mini.local`, Node `v24.20.0`.

Benchmark root 상대 경로 `results/issue-3940/frozen-windows-01.json`,
`aa-windows-01.json`, sibling `aa-windows-01.json.shards/`, 로그와 Windows
build/prior-policy/identity 입력을 로컬에 원형 보존합니다.
Parent의 authoritative verdict와 archive는 repository root 기준
`.omo/verification/http-performance-3939-3943-20261013-1a832301/` 아래
`aa-3940-windows-01-verdict.json`과 `aa-3940-windows-01.tar.gz`입니다.
Archive SHA256: `9f2f3dcee4be81014fa241df5872a565f0a8fead01111f8281952746b6325a23`.
Raw matrix/shard/log/bundle/dist/cache는 커밋하지 않습니다.

Manifest file SHA256: `8ef9f910aa9681a44c1e848d4aa96d538b42181081bffc0b44a7c3873e6d731f`.
Index file SHA256: `5e15223eebf3d09b2a89d9acfda63a9d99d05bc5508b6b82853a183b5f272c21`.
원본 source/build/runtime/host/network/transport/generator/lockfile 신원은 동결
manifest와 원본에 남습니다. 최종 커밋의 새 측정이라고 재해석하지 않습니다.
Offline readEvidence/evaluate 재검증은 모든 240 shard를 읽고 parent 판정과
동일한 결과를 확인했습니다. 새 timing run은 **0**입니다.

## 고정 정책과 저장 계약

`design-windows-server.json`은 6 workloads × default/equivalent × connections 1/64,
각 arm 5회, warmup 10초·measurement 40초, 고정 paired order를 유지합니다.
Throughput CV 3%, A/A throughput 및 CPU/request 3%, p95/p99/RSS 5%,
최소 10,000 requests와 CPU resolution multiple 100을 완화하지 않았습니다.
후보의 hit throughput/CPU 최소 이득 5%와 모든 회귀 기준도 그대로입니다.
이 기준은 현재 최적화 채택 증거가 아닙니다.

과거 `design.json` SHA256 `940409518cdde1c589eefb8dc2c0f0b99c6a6bc5d5b2128177e6cd7d05d99285`와
현재 policy SHA256 `891d93388ed849630340ab23791600217af22da4d51fd072c1994217b0bbb145`를
보존합니다. Policy 차이는 preflight binding뿐입니다.
과거 Mac-server/WSL-generator 준비와 12/132에서 중단된 Node headroom의
57%–128% 증가 진단은 Windows 성능 근거가 아닙니다.
#3939의 132-record headroom **NOT_ESTABLISHED**(4/22 mean gains >3%)도
Bun calibration이 아닌 저장 크기 참고 자료로만 유지합니다.

`storage.mts`는 immutable compact JSON 원본과 ordinal/byte-count/SHA256으로
묶인 bounded index를 보존합니다. Cohort 전체를 한 JSON 문자열로 만들지 않지만,
evaluator는 개별 원본을 메모리에 복원합니다. 개별 원본 문자열 제한은 남습니다.
`plan.mts`, `gates.mts`, `generator.mts`, storage와 두 design 정책은
clean checkout의 import를 위해 함께 커밋합니다.

## 집중 검증과 회귀 보강

기존 짧은 '{}\n' tampering은 byte-count 오류로 먼저 막혔습니다.
새 테스트는 original reference/index를 그대로 두고 같은 byte length의
유효 JSON nonce만 바꾸며 `shard original hash` 실패를 직접 단언합니다.
해시 비교 한 줄만 제거했을 때 **RED**, exit 1, `Missing expected exception`을
확인했습니다. Storage는 SHA256
`1b9b5a2d704286587a6027338aafbf59dec905447aa3146b092661621a0049f4`로 정확히 복원했습니다.

복원 후 상속 UTF8+issue 테스트 **38/38 GREEN**, exit 0입니다.
Benchmark typecheck와 관련 Biome lint exit 0, MTS TS stdin lint 출력
byte-identical, source/storage/test LSP diagnostics 없음, git diff --check 통과입니다.

과거 38-pass/typecheck/lint/bundle receipt는 보존합니다. Harness,
plan/gates/generator/storage 및 공유 collector는 당시 source hash 그대로이며,
변경된 issue 테스트는 이번 GREEN으로 다시 검증했습니다.
상속 `traffic.ts`/`traffic-utf8.test.mts`와 두 package 테스트 hash는 유지합니다.
이전 focused Vitest 266-pass, adapter 75-pass, 6 canonical Bun workload
correctness-only probe 기록은 새 성능 PASS가 아닙니다.

과거 전체 benchmark suite는 **458 passed, 2 failed, 1 skipped**, exit 1입니다.
수정하지 않은 `tests/paired-ab.test.mts:193`와 `tests/paired-node.test.mts:381`의
finite child JSON ENOENT를 보존하며 base-only 재현은 하지 않았습니다.
Parent가 보존한 후속 `results/issue-3940/benchmark-tests-adjudication.log`는
`pnpm --ignore-workspace test`의 **465 passed, 0 failed, 1 skipped**, exit 0을 기록합니다.
Repository 상대 경로 `.omo/verification/http-performance-3939-3943-20261013-1a832301/adjudication-3940.json`은
이 recheck와 두 family 재현의 **24 completed children, 0 failed**, exit 0을
준비 HEAD `ce70426f3bf29430c4eb941f8e94baaf8f78d364`에 연결합니다.
기존 실패는 다시 발생하지 않았습니다. Concurrency pressure는 가설이며,
기존 테스트가 per-child evidence를 제거했으므로 정확한 최초 child exit 원인은
알 수 없습니다. 기존 실패와 완료된 후속 검증을 모두 보존합니다.
이 과거 recheck는 최종 companion commit의 exact-head receipt나 성능 PASS가 아닙니다.
로컬 finalization 중 새 broad suite 또는 full local CI는 실행하지 않았습니다.

## 로컬 handoff

Bounded receipt: `results/issue-3940/finalization-receipt.json`.
새 로컬 커밋은 private harness, 직접 관련 회귀 테스트, machine companion 및
EN/KO 보고서를 포함합니다. Public package runtime/API/계약/배포 내용 변경이
없으므로 CONTRIBUTING.md의 internal/test-only 예외에 따라 Changeset은 없습니다.
Book/package README 변경도 필요하지 않습니다.

Issue-owned `results/issue-3940/.gitignore`는 원본을 삭제하거나 authored
MTS/design/receipt companion을 숨기지 않고 로그, generated collector bundle과
`paired-repro/`를 ignore합니다. Companion commit 이후 canonical exact-head focused
receipt, 독립 contract/code/verification 리뷰와 publication은 parent가 담당합니다.
원격 작업, issue close, laneDone, merge 또는 cleanup은 수행하지 않았습니다.
