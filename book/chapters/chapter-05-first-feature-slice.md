# 5장. 첫 번째 기능 슬라이스

> **기준 소스**: [repo:docs/getting-started/first-feature-path.md] [ex:realworld-api/README.md]
> **주요 구현 앵커**: [ex:realworld-api/src/users/users.module.ts] [ex:realworld-api/src/users/users.service.ts] [ex:realworld-api/src/users/users.controller.ts]

이 장에서는 fluo가 기능을 어떻게 쪼개는지 살펴본다. 핵심은 폴더 구조가 아니라 **기능 경계가 코드에 어떻게 드러나는가**다.

## 왜 기능 슬라이스가 초반에 와야 하는가

많은 프레임워크 책은 controller를 먼저 만들고 service를 나중에 붙이며 module은 마지막에 다룬다. 하지만 fluo에서는 처음부터 **이 기능을 어떤 경계로 독립시킬 것인가**를 생각해야 한다 `[repo:docs/getting-started/first-feature-path.md]`. 왜냐하면 explicit DI와 module graph는 애초에 기능 단위의 조립을 전제로 하기 때문이다.

## 왜 “기능 슬라이스”로 설명하는가

첫 기능 경로 문서는 fluo를 단순한 controller 추가 과정이 아니라, **하나의 독립된 기능 조각을 앱에 붙이는 과정**으로 설명한다 `[repo:docs/getting-started/first-feature-path.md]`. 이 관점은 초반부터 중요하다. 왜냐하면 fluo의 `@Module`과 `exports`는 나중에 커질 구조를 미리 고려한 도구이기 때문이다.

## RealWorld 예제의 users 슬라이스

`realworld-api` 예제의 users 기능은 좋은 첫 슬라이스다 `[ex:realworld-api/README.md]`.

- `users.module.ts`는 경계를 선언한다.
- `users.service.ts`는 비즈니스 로직을 가진다.
- `users.controller.ts`는 HTTP 경계다.

이렇게 나뉘면 “웹 요청을 처리하는 코드”와 “도메인 로직”이 자연스럽게 분리된다.

이때 중요한 것은 단순히 역할이 분리된다는 사실이 아니다. **각 역할이 어떤 방향으로 의존하는가**가 더 중요하다. controller는 service를 알고, service는 repo를 안다. 반대로 repo가 controller를 아는 식의 역방향 결합은 허용되지 않는다.

## 슬라이스를 이루는 세 층

### 1. Module

module은 이 기능이 외부에 무엇을 드러내고 내부에 무엇을 감추는지 결정한다 `[ex:realworld-api/src/users/users.module.ts]`.

### 2. Service

service는 보통 business logic이 모이는 곳이다. 여기서는 repo를 주입받아 사용자 생성/조회 로직을 수행한다 `[ex:realworld-api/src/users/users.service.ts]`.

### 3. Controller

controller는 HTTP 요청과 service를 연결하는 어댑터 역할을 한다. DTO를 받고 service를 호출해 응답으로 바꾼다 `[ex:realworld-api/src/users/users.controller.ts]`.

## `UsersModule`을 실제로 읽는 법

`UsersModule`은 코드가 짧지만 경계를 선명하게 보여 준다 `[ex:realworld-api/src/users/users.module.ts]`.

```ts
// source: ex:realworld-api/src/users/users.module.ts
@Module({
  controllers: [UsersController],
  providers: [UsersRepo, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

이 코드를 읽을 때는 각 필드를 단순 목록으로 보면 안 된다.

- `controllers`는 이 기능의 HTTP 진입점이다.
- `providers`는 내부 구현 자산이다.
- `exports`는 외부에 공개하는 contract다.

특히 `UsersRepo`는 provider 목록에 있지만 exports에는 없다. 즉, 이 repo는 module 내부 구현으로 남고, 외부에서는 `UsersService`만 신뢰하면 된다는 뜻이다. 이 한 줄 차이가 나중에 구조 변경 비용을 크게 줄인다.

## service는 왜 중요한가

`UsersService`는 매우 단순해 보인다 `[ex:realworld-api/src/users/users.service.ts]`. 하지만 이 단순함이 오히려 중요하다.

```ts
// source: ex:realworld-api/src/users/users.service.ts
@Inject(UsersRepo)
export class UsersService {
  constructor(private readonly repo: UsersRepo) {}

  createUser(name: string, email: string): UserResponseDto {
    return this.repo.create(name, email);
  }
}
```

여기서 중요한 건 메서드 복잡도가 아니라, **의존성 방향이 HTTP에서 domain 쪽으로 깔끔하게 꺾인다**는 점이다. controller는 service를 보고, service는 repo를 본다. 이 흐름은 이후 auth, validation, testing이 붙어도 크게 흔들리지 않는다.

## controller는 단순 endpoint 선언이 아니다

controller는 흔히 라우트 파일처럼 보이지만, fluo에서는 request pipeline과 domain logic 사이의 번역층에 가깝다 `[ex:realworld-api/src/users/users.controller.ts]`. controller는 request DTO를 받고, validation이 끝난 값을 service로 넘기고, service 결과를 response DTO로 돌려준다.

즉, controller는 “로직을 쓰는 곳”이라기보다, **외부 입력을 내부 세계로 들어오게 만드는 통제 지점**이다.

## 왜 이 구조가 중급자에게 중요한가

JavaScript 중급자는 이미 “함수 몇 개로도 서버는 만들 수 있다”는 사실을 안다. 그래서 여기서 중요한 것은 “할 수 있느냐”가 아니라 **“성장 가능한 경계를 어떻게 처음부터 심을 것이냐”**다.

fluo는 슬라이스를 통해 다음을 가능하게 한다.

- 기능 단위로 모듈을 떼어내기 쉽다.
- 테스트 범위를 기능별로 잡기 쉽다.
- 다른 모듈이 무엇을 가져다 쓸 수 있는지 통제할 수 있다.

그리고 이 세 가지는 모두 규모가 커질수록 중요해진다. 작은 프로젝트에서는 지나치게 엄격하게 느껴질 수 있지만, 팀과 코드베이스가 커질수록 이 엄격함이 결국 개발 속도를 지켜 준다.

## 다음 장으로 이어지는 질문

기능 슬라이스를 만들 때 결국 가장 중요한 것은 “이 클래스들이 서로를 어떻게 아는가?”다. 다음 장에서는 표준 데코레이터와 메타데이터가 바로 그 연결의 출발점이라는 점을 본다.
