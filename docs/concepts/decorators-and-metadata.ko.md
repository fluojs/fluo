# decorators and metadata

<p><a href="./decorators-and-metadata.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 가이드는 `@konekti/core`, `@konekti/http`, 그리고 `@konekti/dto` 패키지에서 사용되는 데코레이터와 메타데이터 모델을 설명합니다.

### 관련 문서

- `./http-runtime.ko.md`
- `./di-and-modules.ko.md`
- `../../packages/core/README.ko.md`

## 데코레이터 구현

Konekti는 TC39 표준 데코레이터만을 기반으로 하는 데코레이터 우선(decorator-first) 방식을 사용합니다.

### 핵심 데코레이터 제품군

- **모듈 및 DI**: `@Module()`, `@Inject()`, `@Scope()`, `@Global()`
- **HTTP 라우팅**: `@Controller()`, `@Get()`, `@Post()`, `@UseGuards()`, `@UseInterceptors()`
- **DTO 바인딩**: `@FromBody()`, `@FromPath()`, `@FromQuery()`, `@FromHeader()`, `@FromCookie()`
- **유효성 검사**: `@konekti/dto` 패키지에서 제공하는 데코레이터들

## DTO 전략

- 요청 DTO 바인딩은 명시적인 옵트인(opt-in) 방식입니다.
- 파라미터 기반 주입 매직 대신 메서드 수준의 라우트 메타데이터와 DTO 필드 데코레이터가 사용됩니다.
- 유효성 검사는 프레임워크 소유의 데코레이터 메타데이터에 의해 구동됩니다.
- 중첩된 DTO 유효성 검사는 주요 기능입니다.

### 현재 제약 사항

- 데코레이터 우선 DTO 모델이 현재 지원되는 주요 규약입니다.
- 직접적인 스키마 객체 유효성 검사는 현재 우선순위가 아닙니다.
- 유효성 검사 어댑터 규약은 당분간 일반적인 확장 API로 확장되지 않습니다.

## DTO 보안

- 요청 DTO, 응답 DTO, 영속성(persistence) 모델은 분리되어 유지됩니다.
- 각 필드는 단일 요청 소스에 매핑됩니다.
- 본문(Body) 바인딩은 엄격한 허용 목록(allowlist)을 사용합니다.
- 위험한 키(예: `__proto__`, `constructor`, `prototype`)는 차단됩니다.

## 메타데이터 관리

- 저수준 메타데이터 읽기/쓰기 작업은 내부 헬퍼 API에 의해 처리됩니다.
- 런타임 및 기타 패키지는 이러한 헬퍼를 통해 정규화된 메타데이터에 접근해야 합니다.
- 커스텀 데코레이터는 내부 저장 형식에 의존해서는 안 됩니다.
- 메타데이터 시스템에 대한 제3자 확장은 현재 공개 API의 일부가 아닙니다.
- `Symbol.metadata`가 필요한 경우 호환성을 보장하기 위해 `ensureMetadataSymbol()` 및 기타 헬퍼를 사용하세요.

## 개념 모델

```text
데코레이터는 프레임워크 소유의 메타데이터를 기록합니다
런타임 패키지는 정규화된 메타데이터를 읽습니다
내부 저장소는 비공개로 유지됩니다
```
