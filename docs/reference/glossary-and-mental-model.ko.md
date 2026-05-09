# glossary and mental model

<p><strong><kbd>한국어</kbd></strong> <a href="./glossary-and-mental-model.md"><kbd>English</kbd></a></p>

fluo 용어, 실행 관점, 부트스트랩 단계를 빠르게 조회하기 위한 참조 문서입니다.

## glossary

| term | definition | notes |
| --- | --- | --- |
| **Provider** | DI 컨테이너가 해결할 수 있도록 등록된 클래스, 값, 또는 팩토리입니다. | 런타임 wiring의 기본 단위입니다. |
| **Token** | 프로바이더를 조회할 때 사용하는 식별자입니다. | 보통 클래스, 문자열, 또는 `Symbol`을 사용합니다. |
| **Scope** | 프로바이더 생명주기 정책입니다. | `Singleton`, `Request`, `Transient` 중 하나입니다. |
| **Module** | 프로바이더, 컨트롤러, imports, exports를 묶는 경계입니다. | 모듈 그래프의 가시성 규칙을 정의합니다. |
| **Module Graph** | 부트스트랩 시 해결되는 의존성 순서의 모듈 트리입니다. | 프로바이더 가시성과 라이프사이클 순서를 결정합니다. |
| **Dispatcher** | HTTP 실행을 조정하는 구성 요소입니다. | 미들웨어, 가드, 인터셉터, 바인딩, 핸들러 호출을 순서대로 처리합니다. |
| **Middleware** | 핸들러 전에 실행되는 요청 처리 단계입니다. | 라우트 또는 모듈 단위로 구성됩니다. |
| **Pipe** | 입력 변환 또는 검증 단계입니다. | DTO 변환과 검증에 자주 사용됩니다. |
| **Guard** | 핸들러 실행 전에 접근을 판단하는 게이트입니다. | 비즈니스 로직보다 먼저 요청을 차단합니다. |
| **Interceptor** | 핸들러 실행을 감싸는 래퍼입니다. | 응답 변환, 타이밍 측정, 횡단 관심사 처리에 사용됩니다. |
| **DTO** | 요청 페이로드 형상을 설명하는 클래스입니다. | `@RequestDto()` 및 검증 어댑터와 함께 사용됩니다. |
| **RequestContext** | 요청 단위 런타임 객체입니다. | 요청, 응답 핸들, 파라미터, principal을 담습니다. |
| **Platform Adapter** | fluo 런타임 계약을 실제 환경에 연결하는 패키지입니다. | 플랫폼 어댑터 계약을 만족해야 합니다. |
| **forRoot / forRootAsync** | 설정 가능한 모듈용 동적 모듈 진입점입니다. | 옵션을 런타임 프로바이더 등록으로 바꿉니다. |
| **Standard Decorators** | fluo가 사용하는 TC39 표준 데코레이터입니다. | 레거시 데코레이터 컴파일러 플래그는 계약 밖입니다. |
| **Class-First DI** | 클래스를 기본 토큰 형태로 삼는 DI 스타일입니다. | 리플렉션 메타데이터 없이도 명시적 주입을 유지합니다. |
| **Bootstrap Path** | `FluoFactory.create()`부터 앱 준비 완료까지의 순서입니다. | 시작 실패나 readiness 문제를 추적할 때 유용합니다. |
| **Exception Resolver** | 오류를 HTTP 응답으로 매핑하는 계층입니다. | 던져진 오류를 정규화된 응답으로 바꿉니다. |
| **Dynamic Module** | 런타임에 생성되는 모듈 정의입니다. | auth, config, persistence, adapter 패키지에서 자주 사용됩니다. |
| **Circular Dependency** | 프로바이더 또는 모듈 간 상호 의존입니다. | 명시적 처리 또는 경계 정리가 필요합니다. |
| **Injection Point** | 클래스 수준 `@Inject(...)` 메타데이터나 provider 수준 `inject` 배열로 해석되는 생성자 매개변수 위치입니다. | fluo에서 `@Inject(...)`는 표준 클래스 데코레이터이며 constructor-parameter나 property 데코레이터가 아닙니다. |

## mental model

| model | reference summary |
| --- | --- |
| **Adapter-first runtime** | 애플리케이션 로직은 이식성을 유지하고, 환경별 전송 동작은 어댑터가 담당합니다. |
| **Explicit wiring** | DI, exports, 모듈 경계는 리플렉션 추론이 아니라 코드에 직접 선언됩니다. |
| **Package isolation** | 애플리케이션은 실제로 사용하는 기능에만 의존하도록 패키지가 세분화됩니다. |
| **Behavioral contracts** | 지원 플랫폼 전반에서 런타임 동작, 응답 규칙, 패키지 보장이 일관되어야 합니다. |

## lifecycle stages

| stage | runtime effect |
| --- | --- |
| **Resolution** | imports를 순회하며 모듈 그래프를 검증합니다. |
| **Instantiation** | scope 규칙에 따라 프로바이더 인스턴스를 생성합니다. |
| **Bootstrap** | 라이프사이클 훅을 실행하고 패키지 초기화를 완료합니다. |
| **Ready** | 플랫폼 리스너가 실제 트래픽을 받기 시작합니다. |
| **Shutdown** | 역순으로 파괴 훅을 실행하고 리소스를 정리합니다. |

## related docs

- [Architecture Overview](../architecture/architecture-overview.ko.md)
- [DI and Modules](../architecture/di-and-modules.ko.md)
- [HTTP Runtime](../architecture/http-runtime.ko.md)
- [Lifecycle and Shutdown](../architecture/lifecycle-and-shutdown.ko.md)
