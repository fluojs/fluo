# decorators and metadata

<p><a href="./decorators-and-metadata.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 가이드는 `@konekti/core`, `@konekti/http`, `@konekti/dto-validator` 전반에 걸친 현재 데코레이터 및 metadata 모델을 설명합니다.

함께 보기:

- `./http-runtime.md`
- `./di-and-modules.md`
- `../../packages/core/README.md`

## current decorator stance

공개 모델은 데코레이터 우선이며, 표준 데코레이터만을 사용합니다.

핵심 제품군은 다음과 같습니다:

- 모듈 및 DI 데코레이터: `@Module()`, `@Inject()`, `@Scope()`, `@Global()` 등
- HTTP 데코레이터: `@Controller()`, `@Get()`, `@Post()`, `@UseGuard()`, `@UseInterceptor()` 등
- DTO 바인딩 데코레이터: `@FromBody()`, `@FromPath()`, `@FromQuery()`, `@FromHeader()`, `@FromCookie()` 등
- `@konekti/dto-validator`에서 제공하는 유효성 검사 데코레이터

## DTO strategy

- 요청 DTO 바인딩은 명시적인 선택(opt-in) 시에만 작동합니다.
- 파라미터 데코레이터 매직보다 메서드 수준의 route metadata와 DTO 필드 데코레이터가 선호됩니다.
- 유효성 검사는 프레임워크 소유의 데코레이터 metadata를 통해 실행됩니다.
- 중첩된 DTO 유효성 검사는 퍼스트 파티 모델의 일부입니다.

## DTO security rules

- 요청 DTO, 응답 DTO, 영속성 모델은 분리되어 유지됩니다.
- 하나의 필드는 하나의 요청 소스에 매핑됩니다.
- Body 바인딩은 엄격한 허용 목록(allowlist) 방식을 사용합니다.
- `__proto__`, `constructor`, `prototype`과 같은 위험한 키는 차단됩니다.

## metadata ownership

- 헬퍼 소유의 metadata API가 저수준 쓰기/읽기 경계로 유지됩니다.
- runtime 및 기타 패키지는 헬퍼 API를 통해 정규화된 metadata를 읽어야 합니다.
- 커스텀 데코레이터는 원시 저장 형태를 공개 규약으로 의존해서는 안 됩니다.

## practical mental model

```text
데코레이터는 프레임워크 소유의 metadata를 씁니다.
runtime 패키지는 정규화된 metadata를 읽습니다.
원시 저장 형태는 공개 확장 포인트가 아닙니다.
```
