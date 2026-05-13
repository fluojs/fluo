# Platform Conformance Authoring Checklist

<p><strong><kbd>한국어</kbd></strong> <a href="./platform-conformance-authoring-checklist.md"><kbd>English</kbd></a></p>

이 체크리스트는 `@fluojs/platform-*`, `@fluojs/*-adapter`, 그 밖의 fluo 플랫폼 셸에 참여하는 런타임 어댑터 같은 공식 플랫폼 지향 패키지를 작성하거나 변경할 때 사용합니다.

## Scope

- [ ] MUST: 플랫폼 지향 패키지 변경의 계약 기준선으로 이 문서를 사용합니다.
- [ ] MUST: 런타임 동작, 생명주기 보장, 어댑터 capability가 바뀌면 패키지 `README.md`와 한국어 미러를 함께 맞춥니다.
- [ ] MUST: 구현과 함께 관련 behavioral contract 문서와 테스트를 동기화합니다.

## Conformance Harness Requirements

- [ ] MUST: 플랫폼 컴포넌트 계약 검사를 위해 `@fluojs/testing/platform-conformance`의 `createPlatformConformanceHarness(...)`를 실행합니다.
- [ ] MUST: `validate()`가 컴포넌트 상태를 전이시키지 않는지 검증합니다.
- [ ] MUST: side-effect capture를 설정한 경우 `validate()`가 장기 지속 부수 효과를 만들지 않는지 검증합니다.
- [ ] MUST: `start()`가 중복 호출에서도 결정론적인지 검증합니다.
- [ ] MUST: `stop()`이 중복 호출에서도 멱등적인지 검증합니다.
- [ ] MUST: `snapshot()`이 degraded 상태와 failed 상태에서도 호출 가능한지 검증합니다.
- [ ] MUST: diagnostics가 비어 있지 않은 안정적인 `code` 값을 유지하는지 검증합니다.
- [ ] MUST: 하네스 설정에서 완화하지 않는 한 error severity diagnostics에 `fixHint`를 제공합니다.
- [ ] MUST: `snapshot()` 출력이 sanitize 되었는지 검증합니다. 기본 금지 키 패턴은 `secret`, `password`, `token`, `credential`, `api-key`입니다. 명시적 allowlist가 있는 경우만 예외입니다.

## Adapter Portability Requirements

- [ ] MUST: HTTP 어댑터는 `@fluojs/testing/http-adapter-portability`의 `createHttpAdapterPortabilityHarness(...)`를 실행합니다.
- [ ] MUST: 손상된 cookie 값을 크래시 없이 보존하고 임의 정규화하지 않습니다.
- [ ] MUST: raw body 캡처가 켜져 있을 때 JSON과 text 요청의 `rawBody`를 보존합니다.
- [ ] MUST: byte-sensitive payload에 대해 `assertPreservesExactRawBodyBytesForByteSensitivePayloads()`를 검증하여 어댑터가 Unicode replacement, newline normalization, re-encoding 없이 정확한 `rawBody` byte를 보존하는지 확인합니다.
- [ ] MUST NOT: multipart 요청의 `rawBody`를 보존하지 않습니다.
- [ ] MUST: `text/event-stream` content type과 안정적인 event framing으로 SSE streaming을 지원합니다.
- [ ] MUST: 시작 로그에 구성된 host를 보고합니다.
- [ ] MUST: HTTPS 시작을 지원하고 HTTPS listen URL을 보고합니다.
- [ ] MUST: `close()` 이후 등록한 shutdown signal listener를 제거합니다.
- [ ] MUST: fetch-style websocket 어댑터는 `@fluojs/testing/fetch-style-websocket-conformance`의 `createFetchStyleWebSocketConformanceHarness(...)`를 실행합니다.
- [ ] MUST: fetch-style websocket capability 필드 `kind`, `contract`, `mode`, `version`, `support`, `reason`를 안정적으로 유지합니다.

## Package Contract Requirements

- [ ] MUST: 공식 플랫폼 패키지는 저장소 정책상 `PlatformAdapter`라고 부르는 접점을 구현합니다. HTTP 플랫폼 패키지는 `@fluojs/http`의 `HttpApplicationAdapter`로 이 접점을 충족합니다.
- [ ] MUST: 타입이 있는 구성을 노출하고 bootstrap 중 입력을 검증합니다.
- [ ] MUST: 패키지 동작과 문서에서 health와 readiness를 구분합니다.
- [ ] MUST: 호출자에게 보이는 실패 상태에 대해 안정적인 diagnostic code를 제공합니다.
- [ ] MUST: 소켓, 파일 핸들, 연결 같은 소유 리소스를 선언하고 shutdown 중 해제합니다.
- [ ] MUST NOT: 로그, diagnostics, snapshot을 통해 credential, token, password, API key를 노출하지 않습니다.

## Pull Request Evidence

- [ ] MUST: pull request 설명에 conformance 또는 portability 테스트 파일을 링크합니다.
- [ ] MUST: 생명주기 순서, readiness 동작, shutdown 동작, diagnostics, adapter capability에 대한 문서화된 계약 변경을 명시합니다.
- [ ] MUST: 공개 런타임 계약이 바뀌면 패키지 `README.md`와 한국어 미러를 업데이트합니다.
- [ ] MUST: 이 문서 쌍이 바뀔 때 영어와 한국어의 heading parity를 유지합니다.

## Related Docs

- [Behavioral Contract Policy](./behavioral-contract-policy.ko.md)
- [Platform Consistency Design](../architecture/platform-consistency-design.ko.md)
- [Testing Guide](./testing-guide.ko.md)
- [Public Export TSDoc Baseline](./public-export-tsdoc-baseline.ko.md)
