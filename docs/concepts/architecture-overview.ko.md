# 아키텍처 개요

<p><a href="./architecture-overview.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti는 명시적인 경계, 안정적인 메타데이터, 표준 데코레이터를 기반으로 구축되었습니다. 암시적인 리플렉션 기반 “마법”에서 벗어나, 예측 가능하고 타입 안전하며 감사 가능한 백엔드 프레임워크를 제공합니다.

## 이 개념이 중요한 이유

현대적인 백엔드 개발은 종종 숨겨진 컴파일러 동작과 런타임 리플렉션에 의존해 의존성을 연결합니다. 처음에는 편리해 보일 수 있지만, 장기적으로는 다음과 같은 비용을 만듭니다:
- **취약한 리팩터링**: 프레임워크가 암시적인 타입 메타데이터에 의존하면 매개변수 이름을 바꾸는 것만으로도 DI가 깨질 수 있습니다.
- **컴파일러 종속성**: `experimentalDecorators` 같은 레거시 플래그에 의존하면 팀이 현대적인 TypeScript 표준으로 이동하기 어려워집니다.
- **불투명한 실행**: 요청이 시스템을 통해 정확히 어떻게 흐르는지, 또는 왜 특정 provider가 선택되었는지 파악하기 어렵습니다.

Konekti는 **명시적인 의존성 선언**과 **표준 데코레이터**를 강제하여 이 문제를 해결합니다. 코드에는 실제로 일어나는 일이 그대로 드러나며, 숨겨진 컴파일러 생성 메타데이터에 의존할 필요가 없습니다.

## 핵심 아이디어

### 명시적 경계
Konekti의 패키지는 명확하고 문서화된 책임을 가집니다. 런타임은 패키지의 이름이나 위치만 보고 기능을 추측하지 않습니다. 대신 패키지는 애플리케이션 쉘에 인식되기 위해 공식 **플랫폼 계약**(참고: [Platform Consistency Design](./platform-consistency-design.ko.md))에 참여합니다.

### 안정적인 메타데이터
많은 프레임워크에서 데코레이터는 접근하기 어렵거나 프레임워크 내부와 강하게 결합된 방식으로 메타데이터를 저장합니다. Konekti는 메타데이터를 1급 구성 요소로 취급합니다. 데코레이터가 이를 작성하지만, 안정적인 프레임워크 소유 헬퍼가 이를 관리합니다. 따라서 내부 저장 방식이 바뀌더라도 아키텍처 정의는 유효하게 유지됩니다.

### 표준 데코레이터 (TC39)
Konekti는 미래를 염두에 두고 설계되었습니다. 표준 데코레이터 모델을 사용하므로 `tsconfig.json`에서 `experimentalDecorators`를 끌 수 있습니다. 또한 `emitDecoratorMetadata` 의존을 제거해 빌드가 더 빨라지고 코드가 현대 JavaScript 표준에 엄격하게 부합합니다.

## 프레임워크 구조

Konekti는 서로 협력하여 일관된 개발 경험을 제공하는 세 개의 분리된 계층으로 구성됩니다.

### 1. 코어와 Runtime (기둥)
- `@konekti/core`: 데코레이터와 metadata helper의 단일 진실 공급원입니다.
- `@konekti/di`: 가시성 규칙을 강제하는 고성능 토큰 기반 Dependency Injection 엔진입니다.
- `@konekti/runtime`: module graph를 구성하고 애플리케이션 lifecycle을 관리하는 orchestrator입니다.

### 2. Transport와 Protocol (가장자리)
- `@konekti/http`: 요청 실행, routing, HTTP metadata를 위한 추상 계층입니다.
- `@konekti/platform-*`: 특정 환경용으로 추상 HTTP 계층을 구현하는 concrete adapter(예: `platform-fastify`, `platform-bun`)입니다.

### 3. 기능 통합 (capability)
- `@konekti/config`: 엄격한 우선순위를 가진 검증된 configuration loading입니다.
- `@konekti/validation` & `@konekti/serialization`: 시스템으로 들어오고 나가는 데이터에 대한 명시적 경계입니다.
- `@konekti/jwt` & `@konekti/passport`: authentication과 identity management에 대한 표준 접근 방식입니다.

## 요청 흐름

Konekti의 실행 경로는 결정론적인 phase 순서입니다. 복잡하게 분기하는 내부 로직을 가진 프레임워크와 달리, Konekti는 “직선형” 철학을 따릅니다:

```text
[HTTP Adapter] -> [RequestContext] -> [Middleware] -> [Route Match] -> [Guards] 
-> [Interceptors (Pre)] -> [Materialization] -> [Validation] -> [Handler] 
-> [Serialization] -> [Interceptors (Post)] -> [Response Write]
```

이 결정론적 흐름 덕분에 디버깅할 때 어디를 봐야 하는지 항상 알 수 있습니다. validation이 실패하면, 그것은 항상 materialization 이후이면서 handler 이전입니다.

## 경계

- **Transport 독립성**: Konekti는 현재 HTTP 우선이지만, 내부 아키텍처는 핵심 로직이 특정 transport protocol과 분리되도록 설계되었습니다.
- **Module 캡슐화**: 가시성은 전역이 아닙니다. Module A의 provider는 명시적으로 export되고 Module B가 import하지 않는 한 Module B에서 보이지 않습니다.
- **Environment 격리**: 패키지는 `process.env`를 직접 참조하지 않습니다. 모든 configuration은 bootstrap 동안 `ConfigService`를 통해 전달됩니다.

## 관련 문서

- [HTTP Runtime](./http-runtime.ko.md)
- [DI and Modules](./di-and-modules.ko.md)
- [Platform Consistency Design](./platform-consistency-design.ko.md)
- [Package Surface](../reference/package-surface.ko.md)
