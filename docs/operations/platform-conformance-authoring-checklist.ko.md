# platform conformance authoring checklist

<p><a href="./platform-conformance-authoring-checklist.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 체크리스트는 플랫폼 일관성 SSOT의 acceptance 기준을 공식 플랫폼-지향 패키지의 작성/검증 게이트로 변환합니다.

주요 권한 문서:

- `../concepts/platform-consistency-design.ko.md`
- `./behavioral-contract-policy.ko.md`

## 언제 이 체크리스트를 사용하나요?

패키지가 런타임 소유 플랫폼 셸(`platform.components`)에 새로 참여하거나, 기존 플랫폼 계약 동작을 변경할 때마다 사용합니다.

## 필수 conformance harness 게이트

모든 공식 플랫폼-지향 패키지는 `@konekti/testing`의 공유 conformance harness를 실행하는 테스트를 포함해야 합니다.

- `createPlatformConformanceHarness(...)`
- HTTP 어댑터와 adapter-first 런타임 패키지에는 `createHttpAdapterPortabilityHarness(...)`
- `assertAll()` **또는** 항목별 invariant 단언

하니스가 보장해야 하는 최소 invariant:

- `validate()`가 컴포넌트 상태를 전이시키지 않는다(항상 검증).
- 상태 외의 숨은 장수명 side effect는 `captureValidationSideEffects`를 연결한 경우에 검증된다.
- `start()`가 결정적이다(멱등 성공 또는 중복 호출 시 결정적 실패).
- `stop()`이 멱등이다.
- `snapshot()`을 degraded/failed 상태에서도 호출할 수 있다.
- diagnostics가 비어 있지 않은 안정적인 코드와 error 수준 `fixHint`를 제공한다.
- snapshot이 민감 정보 키를 포함하지 않도록 sanitize된다.

리소스 소유/점유 semantics가 있는 플랫폼 패키지는 하니스 테스트에서 `captureValidationSideEffects`를 제공해 숨은 리소스 변화를 명시적으로 검증해야 합니다.

HTTP 어댑터는 요청 정규화, `rawBody` opt-in 동작, SSE 프레이밍, 시작 로그, 종료 시그널 정리에 대해 내장 Node 어댑터와의 parity를 증명하는 portability 단언을 포함해야 합니다.

## 패키지 작성 체크리스트

platform consistency alignment를 주장하기 전에 변경셋이 아래 항목을 모두 만족해야 합니다.

- [ ] 명시적 config 옵션을 노출하고 부트스트랩 시점에 검증한다.
- [ ] 결정적 `start()`와 멱등 `stop()` 동작을 문서화한다.
- [ ] readiness 의미를 health와 분리해 정의한다.
- [ ] 안정적인 `code`와 실행 가능한 `fixHint`를 포함한 구조화 diagnostics를 제공한다.
- [ ] sanitize된 snapshot을 내보낸다(비밀 정보 필드 없음).
- [ ] 의존성 엣지와 리소스 소유 semantics를 명시한다.
- [ ] 공용 telemetry namespace/tag 규칙을 따른다.
- [ ] CLI/Studio가 패키지 전용 파싱 없이 소비할 수 있다.

## PR 증거 요구사항

플랫폼-지향 패키지 PR에는 다음이 포함되어야 합니다.

1. harness 기반 테스트 파일 링크
2. 문서화된 behavioral contract 변경 여부
3. 동작/런타임 invariant 변경 시 README 업데이트
4. 검증 출력(`pnpm test`, `pnpm typecheck`, `pnpm build`, 또는 `pnpm verify`)
