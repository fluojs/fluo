# #3913 Deno 진단에 대한 lead 판정

기준 source는 `1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18`이다. 같은 디렉터리의 `deno-close-scope-blocker-20261008T2315.md`, diagnostic script와 raw log를 직접 읽고 shared dispatch source와 대조했다. 기존 실험을 재실행하거나 성능 측정으로 재표시하지 않았다.

## 확인한 경계

- `packages/runtime/src/web.ts:392`는 native `request.signal`을 읽는다.
- `packages/runtime/src/adapters/request-response-factory.ts:54`는 factory signal을 얻어 request에 전달하며, 오류 경로에서도 aborted 상태를 확인한다.
- `packages/http/src/dispatch/dispatcher.ts:476`의 `ensureRequestNotAborted`는 `isRequestAborted`를 호출한다. 호출 지점은 798, 802, 897, 1051이다.
- `packages/http/src/dispatch/request-abort.ts`의 일반 request 경로는 `request.isAborted?.() === true || request.signal?.aborted === true`를 검사한다. 따라서 factory의 signal 전달만 lazy하게 바꿔도 dispatcher가 native signal을 관측한다.
- Authoritative probe는 같은 cancellation source를 실제로 관측해야 한다. Deno 내부 cache observer를 production dependency로 사용하거나 정상 반환을 위해 항상 false를 반환하는 probe를 등록하는 것은 승인된 해법이 아니다.

## 판정과 남은 작업

다섯 유한 native 요청의 진단은 signal materialization과 Deno legacy normal-completion abort 경로의 관계를 뒷받침한다. 모든 framework 비용의 원인이나 절대 비용, 최적화 효과를 증명하지 않는다.

현재 근거로 shared factory scope를 넓혀 signal 전달만 lazy하게 바꾸는 수정은 진행하지 않는다. 필수 pre-abort 관측·signal identity/reason·peer cancellation을 보존하면서 비용을 제거할 안전한 수정은 아직 입증되지 않았다. 별도 adapter 우회나 legacy-abort 비활성화도 하지 않는다.

Bun 공통 header 개선은 #3911의 단일 구현을 사용한다. #3913은 해당 개선의 실제 Bun/Deno native 정확성 및 exact-source 전후 측정, Deno residual cost의 통제 비교를 여전히 필요로 한다. 변경 없이 종료하거나 성능 PASS로 처리하지 않는다. 남은 비용의 최종 수용 판단이 필요하면 그 측정 근거와 함께 umbrella owner에게 제시한다.

## 2026-10-09 보존 및 결정 경계

현재 preflight는 `1a198da57d58267a5212138e1db6161bf05fa4bc2317dad92d793c94a0442d22`다.
이 커밋은 기존 진단 script, 원본 log, 최초 worker 보고와 lead 판정을 보존한다.
최초 보고에 적힌 이전 digest와 당시 HEAD는 과거 실행의 식별자이므로 바꾸지 않는다.
Public package source, API, README 또는 배포 내용은 변경하지 않는다.
Changeset 대상 공개 산출물이 없으며 이 커밋은 구현 완료 Result가 아니다.

최신 Linux BEFORE-only 수집은 framework base를 유지하고 collector의 해싱
교란만 수정한 6개 표본이다. 원본과 판정은 repository root의
`.omo/verification/3911-linux-bounded-hash-before-c2fca6968.json` 및
`3911-linux-bounded-hash-before-summary.json`에 보존했다.
Native Bun RSS CV 8.1326%가 고정 기준 5%를 초과하여 INCONCLUSIVE다.
이는 Deno의 실패 또는 성능 결과가 아니며 #3911 후보의 개선 여부도 증명하지 않는다.
현재 장비에서 안정적인 비교를 확보하지 못했고 별도 서버 제공 여부도 확인되지 않았다.

남은 결정은 안전한 후보가 없는 Deno adapter에 임의 변경을 넣는 것이 아니라,
기존 cancellation 계약을 유지한 채 관측된 native runtime 비용을 어떻게 수용할지다.
Shared signal 전달을 lazy로 바꾸는 것만으로 dispatcher의 필수 abort 관측은
제거되지 않는다는 앞선 판정을 유지한다. 기존 신호를 교체하거나 정상 완료 abort를
비활성화하는 변경은 승인된 범위 밖이다.

Package 구현을 변경하지 않았으므로 package build/native conformance를 새로 실행하지
않았다. 기존 유한 요청 진단의 exit 0만 인용하며, 그것을 CPU/할당 측정이나
Fluo conformance, BEFORE/AFTER 또는 성능 예산 통과로 확대하지 않는다.
Exact-head 리뷰는 이 진단의 타당성과 남은 수용 결정을 판단하며 issue 완료를
자동 승인하는 단계가 아니다.
