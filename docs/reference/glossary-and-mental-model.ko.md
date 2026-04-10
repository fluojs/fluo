# glossary and mental model

<p><strong><kbd>한국어</kbd></strong> <a href="./glossary-and-mental-model.md"><kbd>English</kbd></a></p>

이 용어집은 Konekti 프레임워크를 지배하는 핵심 용어와 멘탈 모델을 정의합니다. 기술 용어 조회 및 Konekti 방식의 백엔드 애플리케이션 구축 이해에 활용하세요.

## 핵심 용어

| 용어 | 정의 | 중요한 이유 |
| --- | --- | --- |
| **Dispatcher** | 수신 요청을 핸들러로 라우팅하는 중앙 오케스트레이션 레이어. | HTTP 요청-응답 사이클의 핵심입니다. |
| **Platform Adapter** | 추상 Konekti 런타임을 특정 환경(Node, Bun, Deno)에 연결하는 패키지. | 이 추상화 덕분에 코드가 다양한 런타임에서 이식 가능합니다. |
| **Standard Decorators** | 메타데이터 및 동작 부착에 사용되는 TC39 표준(Stage 3) 데코레이터. | 레거시 컴파일러 플래그(`experimentalDecorators`)가 필요 없어 코드를 미래 지향적으로 만듭니다. |
| **Class-First DI** | 구체 클래스 자체를 기본 주입 토큰으로 사용하는 DI 스타일. | 보일러플레이트를 줄이고 의존성을 명시적이고 탐색 가능하게 만듭니다. |
| **Bootstrap Path** | `KonektiFactory.create()`에서 애플리케이션 준비 완료까지의 시퀀스. | 시작 문제 디버깅 및 라이프사이클 훅 연결 이해에 도움됩니다. |
| **Module Graph** | 런타임에서 해결되는 의존성 순서의 모듈 트리. | 프로바이더 공유 방식과 앱의 부팅 순서를 정의합니다. |
| **Guard** | 핸들러 호출 전 요청 컨텍스트를 평가하는 인가 게이트. | "관리자만 접근 가능" 같은 보안 정책 구현에 필수적입니다. |
| **Interceptor** | 횡단 관심사를 위해 핸들러 실행을 감싸는 래퍼. | 로깅, 응답 변환, 전역 오류 처리 로직에 적합합니다. |
| **Request DTO** | 수신 라우트 데이터의 정의 및 검증을 위한 데이터 전송 객체. | 비즈니스 로직 실행 전 타입 안전성과 데이터 무결성을 보장합니다. |
| **Exception Resolver** | 던져진 예외를 포맷된 HTTP 응답으로 매핑하는 컴포넌트. | API가 클라이언트에 오류를 전달하는 방식을 중앙 집중화합니다. |

## 멘탈 모델

### 어댑터 우선 런타임: "한 번 작성, 어디서나 실행"
Konekti는 런타임을 중립적 오케스트레이션 엔진으로 취급합니다. 특정 HTTP 서버나 프로세스 모델을 가정하지 않으며, **Platform Adapter**에 의존하여 연결을 제공합니다. 이는 애플리케이션 로직이 Fastify, Cloudflare Worker, bare Node 리스너 중 어디서 실행되든 분리된 상태를 유지함을 의미합니다.

### 명시적 우선 암시적: "매직 없음"
많은 프레임워크가 "매직"이나 리플렉션에 의존하는 반면, Konekti는 명시적 선언을 선호합니다. 주입 의존성은 `@Inject()`로 선언되고, 모듈은 내보내기를 명시적으로 나열해야 합니다. 이를 통해 모듈 그래프가 예측 가능하고, 감사 가능하며, CLI를 사용해 쉽게 디버깅할 수 있습니다.

### 단일 책임 패키지: "사용하는 것만 비용 지불"
프레임워크는 세분화된 패키지로 분리되어 있습니다. Redis가 필요 없으면 `@konekti/redis`를 포함하지 않고, WebSocket을 사용하지 않으면 `@konekti/websockets`를 포함하지 않습니다. 이를 통해 프로덕션 번들을 가볍게 유지하고 의존성 트리를 관리 가능하게 합니다.

## 라이프사이클 단계

1.  **Resolution**: 모듈 그래프가 구축되고 의존성이 분석됩니다.
2.  **Instantiation**: 프로바이더가 스코프(Singleton, Request, Transient)에 따라 생성됩니다.
3.  **Bootstrap**: `onModuleInit` 같은 라이프사이클 훅이 의존성 순서로 실행됩니다.
4.  **Ready**: Platform Adapter가 리스너를 시작하고 애플리케이션이 요청 수신을 시작합니다.
5.  **Shutdown**: 시그널 핸들링이 `onModuleDestroy`와 우아한 연결 종료를 트리거합니다.

## 추가 읽기
- [아키텍처 개요](../concepts/architecture-overview.ko.md)
- [DI 및 모듈](../concepts/di-and-modules.ko.md)
- [HTTP 런타임](../concepts/http-runtime.ko.md)
