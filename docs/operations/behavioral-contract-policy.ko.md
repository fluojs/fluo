# behavioral contract policy

<p><a href="./behavioral-contract-policy.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 정책은 Konekti 모노레포에서 behavioral contract를 보존하기 위한 규칙을 정의합니다. 패키지 변경이 문서화된 런타임 기대 동작을 조용히 깨뜨리지 않도록 보장하는 것이 목적입니다.

## behavioral contract란 무엇인가

behavioral contract는 패키지의 런타임 동작, 사이드이펙트, 생명주기에 대한 문서화된 약속입니다. TypeScript 타입이 인터페이스를 정의한다면, behavioral contract는 그 인터페이스를 사용할 때 실제로 어떤 일이 일어나는지를 정의합니다.

Konekti에서 behavioral contract는 다음에 대한 권한 있는 기준입니다.
- 호출 시 컴포넌트가 무엇을 하는지
- 의도적으로 무엇을 무시하거나 제외하는지
- 상태, 리소스, 오류를 어떻게 다루는지

## 패키지 문서 필수 항목

모든 `@konekti/*` 패키지는 behavioral contract를 명시하기 위해 `README.md`에 아래 섹션을 유지해야 합니다.

- **supported operations**: 공개 메서드, 함수, 데코레이터의 상세 시맨틱.
- **intentional limitations**: 의도적으로 지원하지 않는 non-goal.
- **runtime invariants**: 리팩터링 후에도 반드시 유지되어야 하는 동작 (예: "Y가 없으면 항상 X를 throw").
- **lifecycle guarantees**: 해당되는 경우 정리(cleanup), 연결 관리, 종료 동작.

## contract 보존 규칙

- **기존 동작**: 패키지 README에 문서화된 동작은 리팩터링 중에도 보존되어야 합니다.
- **동작 추가**: 새로 문서화한 동작에는 해당 contract를 검증하는 테스트가 필요합니다.
- **동작 제거**: 문서화된 의도 동작 제거는 breaking change입니다.
  - `0.x`: minor 버전 증가 + 명시적 migration note 필요.
  - `1.0+`: major 버전 증가 + migration guide 필요.
- **시맨틱 변경**: 타입 시그니처가 같더라도 기존 동작 방식이 바뀌면 breaking change입니다.
- **환경 소유권**: 일반 패키지 소스는 `process.env`를 직접 읽으면 안 됩니다. 환경 값은 애플리케이션/부트스트랩 경계에서 들어와 명시적 파라미터, 타입이 지정된 config provider, 또는 주입 옵션으로 전달되어야 합니다.

세부 버전 정책은 `release-governance.ko.md`를, 확장 안정성 규칙은 `third-party-extension-contract.ko.md`를 참고하세요.

## pull request용 contract 체크리스트

패키지 동작에 영향을 주는 PR은 다음을 검증해야 합니다.
- [ ] migration note 없이 문서화된 behavioral contract를 제거하지 않았다.
- [ ] 새 behavioral contract를 영향 받은 패키지 README에 문서화했다.
- [ ] intentional limitation을 조용히 제거하지 않고 명시했다.
- [ ] runtime invariant를 regression test로 커버했다.
- [ ] 문서화된 boundary/template 예외 파일이 아닌 한 패키지 내부가 `process.env`를 직접 읽지 않는다.

## CI enforcement

behavioral contract 거버넌스는 CI에서 `pnpm verify:platform-consistency-governance`로 강제됩니다.

다음 경우 거버넌스 검증은 PR을 실패시킵니다.

- SSOT English/Korean mirror 문서 구조가 서로 드리프트한 경우.
- contract-governing 문서 변경 시 docs index, CI/tooling enforcement, regression-test evidence 동반 업데이트가 없는 경우.
- 패키지 README의 alignment/conformance claim에 대해 conformance harness 테스트(`createPlatformConformanceHarness(...)`) 근거가 없는 경우.
- repo에서 승인한 boundary/template 예외 외에 일반 `packages/*/src/**` 소스가 `process.env`를 직접 읽는 경우.

## 강한 contract 예시

아래 패키지들은 강한 behavioral contract 사례입니다.
- `@konekti/http`: guard contract, DTO 바인딩 규칙, routing invariant를 명확히 정의.
- `@konekti/microservices`: 트랜스포트별 동작 설명과 명시적 unsupported 항목을 포함.
- `@konekti/testing`: 생명주기 기대치가 명확한 안정적인 testing surface boundary 유지.

## contract 안티패턴

- **silent removal**: transport contract에 문서화된 `send()`를 "core에서 안 쓰니까"라는 이유로 제거.
- **undocumented limitations**: base interface 옵션 중 절반을 무시하는 새 adapter를 문서 없이 추가.
- **implicit side effects**: 문서화되지 않은 신규 백그라운드 프로세스/리소스 할당 도입.
- **암묵적 env 소유권**: 애플리케이션 경계에서 설정을 명시적으로 전달받지 않고 라이브러리 패키지가 `process.env`를 직접 읽는 경우.
