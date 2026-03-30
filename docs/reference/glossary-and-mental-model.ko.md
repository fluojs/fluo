# glossary and mental model

<p><strong><kbd>한국어</kbd></strong> <a href="./glossary-and-mental-model.md"><kbd>English</kbd></a></p>

이 용어집은 Konekti 프레임워크 전반에서 사용되는 핵심 용어와 개념을 정의합니다.

## core concepts

- **Dispatcher**: 라우팅 및 요청 실행을 담당하는 중앙 구성 요소입니다.
- **Middleware**: 핸들러 실행 전에 실행되는 넓은 범위의 필터 레이어입니다.
- **Guard**: 요청의 진행 여부를 결정하는 권한 부여 게이트입니다.
- **Interceptor**: 횡단 관심사(cross-cutting concerns)를 위해 핸들러 호출을 감싸는 래퍼입니다.
- **Request DTO**: 라우트 레벨의 데이터 바인딩 및 유효성 검사를 위한 명시적 계약입니다.
- **Exception Resolver**: 예외를 HTTP 응답으로 매핑하기 위한 표준 메커니즘입니다.

## framework policy terms

- **Official**: 완전히 지원되며 적극적으로 검증된 기능입니다.
- **Preview**: 사용을 위해 제공되지만 아직 완전한 기능 동등성이나 문서 커버리지를 갖추지 못했습니다.
- **Experimental**: 초기 탐색용으로 제공되며 아직 안정적이거나 공식적으로 지원되지 않습니다.
- **Recommended Preset**: 문서와 예제에서 최적화된 주요 경로입니다.
- **Official Matrix**: 권장 프리셋보다 넓을 수 있는, 지원되는 구성의 전체 세트입니다.

## generator terminology

- **`konekti new`**: 새 애플리케이션을 부트스트랩하기 위한 표준 명령어입니다.
- **`konekti g ...`**: 개별 애플리케이션 아티팩트를 생성하기 위한 명령어입니다.
- **Repository (`repo`)**: 데이터 접근을 위해 권장되는 아키텍처 패턴입니다.
- **Request/Response DTOs**: API 계약을 위해 의도적으로 분리된 스키마틱입니다.

## further reading

- `../concepts/http-runtime.md`
- `../concepts/decorators-and-metadata.md`
- `../operations/release-governance.ko.md`
