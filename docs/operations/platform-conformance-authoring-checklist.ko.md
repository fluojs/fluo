# 플랫폼 준수 작성 체크리스트 (Platform Conformance Authoring Checklist)

<p>
  <strong>한국어</strong> | <a href="./platform-conformance-authoring-checklist.md">English</a>
</p>

이 체크리스트는 fluo 생태계에서 공식적인 플랫폼 지향 패키지를 작성할 때 준수해야 할 기술적 및 동작적 요구사항을 정의합니다. fluo 플랫폼 쉘에 참여하는 모든 패키지가 예측 가능하고, 이식 가능하며, 프레임워크의 핵심 표준과 일관성을 유지할 수 있도록 보장합니다.

## 이 문서가 필요한 경우

- **컴포넌트 생성**: 새로운 `@fluojs/platform-*` 또는 `@fluojs/*-adapter` 패키지를 작성할 때.
- **계약 수정**: 플랫폼 수준 컴포넌트의 공개된 동작이나 생명주기 훅을 업데이트할 때.
- **이식성 감사**: 패키지가 크로스 런타임(Node.js, Bun, Deno 등) 지원을 위해 fluo 플랫폼 준수 표준을 따르고 있는지 인증할 때.

---

## 작성 체크리스트 (Authoring Checklist)

### 1. 준수 하네스 및 테스트 (Conformance Harness & Testing)
모든 플랫폼 지향 패키지는 `@fluojs/testing`의 공식 테스트 하네스를 사용하여 검증되어야 합니다.
- [ ] **하네스 채택**: 일반적인 생명주기 검증을 위해 `createPlatformConformanceHarness(...)`를 구현합니다.
- [ ] **전송 이식성**: (HTTP/메시지 어댑터의 경우) 크로스 런타임 동작을 확인하기 위해 `createHttpAdapterPortabilityHarness(...)`를 사용합니다.
- [ ] **상태 격리**: `validate()` 메서드가 부수 효과가 없는 검사이며 컴포넌트 상태를 전이시키지 않는지 확인합니다.
- [ ] **생명주기 무결성**: `start()`가 결정론적이고 `stop()`이 멱등성(동일한 결과 보장)을 유지하는지 확인합니다.
- [ ] **성능 저하 상태의 관측성**: 컴포넌트가 실패하거나 성능이 저하된 상태에서도 `snapshot()`을 호출할 수 있는지 확인합니다.

### 2. 구현 및 설계 (Implementation & Design)
- [ ] **명시적 구성**: 명확하고 타입이 지정된 구성 인터페이스를 노출하고 부트스트랩 단계에서 입력을 검증합니다.
- [ ] **상태 vs 준비성**: "Healthy"(프로세스 실행 중)와 "Ready"(컴포넌트가 완전히 작동 중)의 차이를 명시적으로 정의합니다.
- [ ] **구조화된 진단**: 일반적인 실패 시나리오에 대해 조치 가능한 `fixHint` 메타데이터와 함께 안정적인 에러 코드를 제공합니다.
- [ ] **새니타이징 (Sanitization)**: 내보낸 로그나 스냅샷에 API 키, 비밀번호 또는 자격 증명이 포함되지 않도록 보장합니다.
- [ ] **리소스 소유권**: 소켓, 파일 핸들, DB 연결과 같이 소유한 리소스를 명확히 선언하고 `stop()` 단계에서 닫히도록 보장합니다.

### 3. 풀 리퀘스트(PR) 요구사항
플랫폼 패키지에 영향을 미치는 PR은 준수 여부에 대한 증거를 제공해야 합니다.
- [ ] **하네스 증거**: 준수 하네스가 실행되는 테스트 파일에 대한 링크를 제공합니다.
- [ ] **계약 변경**: 문서화된 런타임 불변성이나 동작 계약의 변경 사항을 명시적으로 언급합니다.
- [ ] **문서 동기화**: 패키지 수준의 `README.md` 및 한국어 미러를 최신 계약 내용으로 업데이트합니다.

---

## 관련 문서
- [동작 계약 정책 (Behavioral Contract Policy)](./behavioral-contract-policy.ko.md)
- [아키텍처 개요 (Architecture Overview)](../concepts/architecture-overview.ko.md)
- [테스트 가이드 (Testing Guide)](./testing-guide.ko.md)
- [제3자 확장 기능 계약 (Third-Party Extension Contract)](./third-party-extension-contract.ko.md)
