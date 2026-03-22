# di and modules

<p><a href="./di-and-modules.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 가이드는 `@konekti/core`, `@konekti/di`, `@konekti/runtime` 전반에 걸친 현재 의존성 주입(dependency-injection) 및 모듈 모델을 설명합니다.

함께 보기:

- `./architecture-overview.ko.md`
- `./http-runtime.ko.md`
- `../../packages/di/README.ko.md`
- `../../packages/runtime/README.ko.md`

## DI principles

- 명시적인 토큰 DI
- runtime 타입 리플렉션(reflection) 기반의 자동 연결(autowiring) 의존성 없음
- 기본적으로 생성자 우선 주입 방식
- `@Inject([...])`: 생성자 의존성 metadata를 소유합니다.
- `@Scope(...)`: 생명주기 scope metadata를 소유합니다.

## provider forms

- `useClass`
- `useFactory`
- `useValue`

## scopes

- `singleton`
- `request`
- `transient`

## override 보존 정책

- `override()`는 교체 대상 토큰의 singleton/request 캐시 엔트리를 무효화한다.
- 축출된 stale 인스턴스가 `onDestroy()`를 구현했다면 즉시 정리한다.
- override로 stale가 된 인스턴스를 전역 컨테이너 `dispose()` 시점까지 보관하지 않는다.

## app-facing injection strategy

현재 공개되는 방식은 임시 static 프로퍼티가 아닌 데코레이터로 작성된 metadata입니다.

```ts
@Inject([USER_REPOSITORY, LOGGER])
@Scope('singleton')
class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: Logger,
  ) {}
}
```

## token ownership rules

- 토큰이 모듈이나 패키지 경계를 넘을 때 공개 규약의 일부가 됩니다.
- 내보내지는 토큰은 임시 리터럴이 아닌 안정적인 상수 또는 타입이어야 합니다.
- 토큰 소유권은 해당 리소스나 규약을 소유한 패키지에 유지됩니다.
- 예제와 generator는 프레임워크 패키지와 동일한 토큰 작성 규칙을 따라야 합니다.

## module responsibilities

모듈은 다음을 정의합니다:

- DI 가시성(visibility) 경계
- 기능 경계
- 결정론적인 부트스트랩 순서
- 미래의 서비스 경계를 위한 명시적인 import/export 지점

## visibility rules

- provider는 기본적으로 정의된 모듈 내부에서만 보입니다.
- 모듈 간 접근을 위해서는 provider 모듈에서의 `exports`와 consumer 모듈에서의 `imports`가 모두 필요합니다.
- 토큰이 로컬에 없거나 가져온(imported) 모듈에서 다시 내보내진(re-exported) 것도 아니라면, 부트스트랩 시점에 즉시 해소 실패(fail fast)합니다.

요약하자면:

- 동일 모듈 -> 로컬 provider 접근 허용
- 모듈 간 접근 -> `exports` + `imports` 필요

## diagnostics expectations

- 생성자 의존성 metadata와 생성자 인자 개수(arity)가 일치해야 합니다.
- 부트스트랩 에러는 로컬 provider 누락, export 누락, import 누락, 그리고 잘못된 주입 metadata를 구분해야 합니다.
- 즉각적인 실패 진단(fail-fast diagnostics)은 선택 사항이 아닌 프레임워크 규약의 일부입니다.

## testing stance

- 유닛 테스트는 가능한 경우 직접 생성(direct construction) 방식을 사용해야 합니다.
- 통합 테스트는 provider 재정의 기능이 있는 테스트 모듈/컨테이너를 사용해야 합니다.
- `@Inject([...])`는 metadata일 뿐이며, 테스트에서 일반적인 직접 생성을 방해하지 않습니다.

## runtime ownership

`@konekti/runtime`은 모듈 metadata와 DI metadata를 소비하여 다음을 수행합니다:

- 모듈 그래프 컴파일
- import/export 가시성 검증
- provider 및 controller 등록
- singleton provider 인스턴스화
- 애플리케이션 쉘 빌드

저수준 헬퍼들이 존재하지만, 의도된 애플리케이션용 DX는 데코레이터 우선 방식입니다.
