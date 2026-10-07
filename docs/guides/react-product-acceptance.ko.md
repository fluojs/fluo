# React 제품 수용

[제품 계약](../contracts/react-fullstack-product.ko.md)은 HTTP-first React
애플리케이션 프레임워크를 규정합니다. 공식 example과 generated
`react-vite-ssr` starter는 shipped HTTP, typegen, `Link`, `useForm`, provider,
개발 및 배포 경로를 조립합니다. 통합 fixture는 새 router, transport, cache나
인증 프레임워크가 아닙니다.

## 통합 fixture

`/catalog/session`에서 **Login A** 또는 **Login B**를 누른 뒤
**Authenticated products**로 이동합니다. `/catalog/session/products`는
인증된 list/search/detail과 create/update/delete를 제공합니다. Validation은
수정 가능한 입력을 유지합니다. Native 제출은 POST/303/GET이며 negotiated
enhanced 제출은 saved와 후속 approval 결과를 구분합니다. Logout은 protected
content와 old continuation을 철회하고, relogin은 실제 process-local 변경을
읽습니다. 권한 거절은 demo identity를 유지한 403이지 logout이 아닙니다.

기존 public `/catalog`, editor-cookie `/catalog/login`, `/catalog/background`,
`/products` 및 admin demo 계약은 유지합니다. 새 companion은 같은 catalog/session
조립을 재사용합니다. `catalogSession`, demo permission 및 고정 CSRF token은
HTTP ownership 예시이지 production authentication이 아닙니다. Map은
process-local demo persistence이며 durable하거나 사용자별 database storage가
아닙니다.

Jukebox shell은 실제 MessageChannel/resource를 계속 소유합니다. HTTP-approved
navigation, transient failure 및 obsolete work는 실제 operation/acknowledgement와
mount/cleanup 관측으로 검증합니다. 인증 teardown, document reload, tab close와
OS discard는 명시적인 lifetime boundary입니다.

## Matrix와 실행은 별개

[`product-acceptance-matrix.json`](../../examples/react-vite-ssr/tests/product-acceptance-matrix.json)은
필수 journey 20행을 포함합니다. 각 행에 success/failure/cancellation,
framework/application owner, source/test 경로, prerequisite, 구현 분류와 실제
surface를 기록합니다. Shipped source 분류는 실행 PASS가 아닙니다. Consumer는
실제 command exit, 완전한 browser report, 인증된 raw artifact와 current
source/head identity를 요구합니다. Missing/skip/failure/source-only 실행은
필수 행을 통과하지 못합니다.

Third-page authoring은 sealed packed consumer에서 실행합니다. Page component와
HTTP handler/DTO, 그리고 해당 page의 선택적 link만 작성합니다. 기존 typegen이
projection을 생성합니다. Inventory는 authored/generated 파일, line/hash,
두 제품 composition 및 renderer/entry/manifest/store 수동 wiring이 없음을
기록합니다. Positive compile과 실제 native/enhanced HTTP round trip에
input/props/saved data, invalid/duplicate route와 missing module 거절을 연결합니다.

## Focused 증거 명령

Packaging 전에 필요한 source closure를 새로 provision/build합니다. 최종 runtime
증거는 clean committed implementation checkout에서 실행하며 다른 checkout의
source dist를 차용하지 않습니다. 아래 output은 매번 새 absolute directory를
사용하고 실패·partial attempt도 보존합니다.

```sh
node --test tooling/ci/react-product-acceptance.test.mjs
node --test examples/react-vite-ssr/tests/reliability-handoff.test.mjs
node tooling/ci/react-product-acceptance.mjs capture tooling "$TOOLING_OUTPUT"
node tooling/ci/react-product-acceptance.mjs capture starters "$STARTER_OUTPUT"
node tooling/ci/react-product-acceptance.mjs capture soak "$SOAK_OUTPUT"
```

`tooling`은 canonical focused source/compiler 검사, 별도로 build한 ordinary/fault
production entry와 기존 three-engine reliability harness를 실행합니다. 두
production build는 같은 server output을 덮으므로 순차 실행합니다. `starters`는
기존 full locked cold-dev sandbox matrix와 packing driver를 재사용하고 packed
consumer의 실제 React/CSS/syntax/server/shared/config edit, native/enhanced 제품
journey 및 독립 production A/B deployment를 실행합니다. 명시적 driver entry는
다음과 같습니다.

```sh
FLUO_PRODUCT_ACCEPTANCE=1 FLUO_BACKGROUND_EVIDENCE="$PACKED_OUTPUT" \
  node examples/react-vite-ssr/tests/verify-background-starter.mjs
```

이 명령은 full canonical CI를 대체하거나 remote operation을 승인하지 않습니다.
기존 CI의 `starters`와 `tooling-1` task도 같은 명령으로 domain receipt와 raw
artifact를 생성합니다. Domain 완료는 제품 전체 완료가 아니며 normal CI는
historical benchmark를 수집하거나 Frida를 활성화하지 않습니다.

실행 가능한 consumer interface는 다음과 같습니다.

```sh
node tooling/ci/react-product-acceptance.mjs \
  examples/react-vite-ssr/tests/product-acceptance-matrix.json \
  "$PRODUCT_RECEIPT" "$ARTIFACT_ROOT"
```

[Receipt schema](../../tooling/ci/react-product-acceptance.schema.json)는
artifact path/digest reference, 실행, 행별 결과, three-engine correctness, soak와
historical measurement inventory를 정의합니다. Path는 evidence root 내부에서
해석합니다. 옮겨온 CI domain directory의 raw relative artifact path는 유지합니다.
Browser/config/build graph/method/source/lock/head identity는 실제 producer를
따릅니다.

`local` receipt는 `local-evidence-complete`를 반환하며 `ci-release`를
`lead-owned-pending`으로 유지합니다. 제품 PASS가 아닙니다. `final` receipt는
canonical three-axis exact-head review/policy evidence,
head/contract/policy/review-bound `explicit-operator-instruction`
`local-ci-waiver`, full exact-head canonical GitHub CI와 실제 제품 domain artifact도
요구합니다. Implementer가 이 lead-owned fact를 만들지 않습니다. 이번 lane은 CI
설정 변경 후에도 full local CI가 명시적으로 금지됩니다. Waiver는 focused
failure, scope, Changeset 및 remote CI를 면제하지 않습니다.

## 수치·stability·device 한계

운영자의 2026-10-06 `whole_product_numeric_acceptance=apply` 결정에 따라 최종
#3879의 원래 수치 FAIL/INCONCLUSIVE는 공개된 비차단 diagnostics입니다. 기존
budget/peer/profile/workload/반복, raw BEFORE/AFTER와 원래 evaluator verdict는
유지합니다. 인증·유효성, inventory 누락, 품질 실패/INCONCLUSIVE, correctness,
stability, ownership/cleanup 및 Fluo measured/warmup error는 계속 차단합니다.
Nonzero runtime exit는 수치 diagnostic이 아닙니다.

Historical client/server measurement는 원래 collector/evaluator identity와 실제
파일 hash를 유지합니다. Unchanged seam equivalence와 한계를 기록하며 변경된
통합 code를 fresh historical measurement로 표시하지 않습니다. 숫자를 green으로
만들기 위한 재수집은 하지 않습니다.

Current functionality는 Chromium/Firefox/WebKit 각각 최소 1000 measured actions를
요구하며 fault preparation/warmup은 제외합니다. 이번 lane의 승인된 soak profile은
`lane-3886-one-hour`로 실제 최소 3600000 ms, 완전한 terminal raw trace, count,
일곱 fault와 lifecycle checkpoint가 필요합니다. Scheduled default는 7200000 ms로
유지합니다. Historical `ca5e37bb` 증거는 원래 HEAD의 증거이지 변경된 integrated
app의 증거가 아닙니다. Seam equivalence가 증명되지 않으면 fresh one-hour를
실행합니다.

Physical mobile/tablet은 명시적으로 `deferred-to-3906`이며 PASS가 아닙니다.
Desktop/mobile emulation과 light/dark screenshot은 실제 새 route/error state를
검증하며 physical device behavior나 새 theme design을 뜻하지 않습니다.
Publication/version/changelog는 Changesets와 canonical GitHub Actions가 소유합니다.
