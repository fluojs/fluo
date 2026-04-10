# 11장. 실전 CRUD 패턴

> **기준 소스**: [ex:realworld-api/README.md] [repo:docs/getting-started/first-feature-path.md]
> **주요 구현 앵커**: [ex:realworld-api/src/users/users.module.ts] [ex:realworld-api/src/users/users.service.ts] [ex:realworld-api/src/users/users.controller.ts]

이 장은 realworld-api 예제를 통해 fluo식 CRUD 구조가 어떻게 만들어지는지 보여준다. 여기서 중요한 것은 CRUD 메서드 개수보다, 기능 조각이 어떤 경계 위에 세워지는지다.

## 왜 realworld 예제가 중요한가

많은 프레임워크는 “간단한 todo app” 예제로 CRUD를 설명한다. 하지만 그런 예제는 대개 너무 단순해서, 실제로는 프레임워크가 가진 경계 관리 능력을 보여주지 못한다. `realworld-api`는 그보다 훨씬 낫다. config, DTO, validation, service, repo, 테스트가 함께 있기 때문이다 `[ex:realworld-api/README.md]`.

realworld-api README는 이 예제가 단순 샘플이 아니라 starter 경로를 실제 도메인 모듈로 확장한 형태라고 설명한다 `[ex:realworld-api/README.md]`. 따라서 이 장은 “실전으로 넘어가는 첫 문턱” 역할을 한다.

## 실전 CRUD를 읽는 기준

- module은 가시성과 export를 책임진다 `[ex:realworld-api/src/users/users.module.ts]`
- service는 도메인 로직을 모은다 `[ex:realworld-api/src/users/users.service.ts]`
- controller는 HTTP 경계를 담당한다 `[ex:realworld-api/src/users/users.controller.ts]`

이 세 층을 계속 분리해서 보면 코드가 커져도 길을 잃지 않는다.

```ts
// source: ex:realworld-api/src/users/users.module.ts
@Module({
  controllers: [UsersController],
  providers: [UsersRepo, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

이 코드는 CRUD 예제의 구조적 중심이다. users 기능이 어떤 HTTP 진입점을 가지는지, 어떤 내부 provider를 소유하는지, 그리고 외부에는 무엇을 contract로 공개하는지가 모두 이 짧은 module 안에 들어 있다 `[ex:realworld-api/src/users/users.module.ts]`.

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

service가 이 정도로 단순하다는 사실도 중요하다. CRUD 실전 예제의 핵심은 화려한 비즈니스 규칙이 아니라, **HTTP 경계와 도메인 조합이 얼마나 또렷한가**를 보여 주는 데 있다 `[ex:realworld-api/src/users/users.service.ts]`.

## 이 장에서 독자가 확인해야 할 것

실전 CRUD를 읽을 때는 “메서드가 몇 개인가”보다 다음을 봐야 한다.

- module이 외부에 무엇을 export하는가
- controller가 어디까지를 HTTP concern으로 남기는가
- service가 어떤 지점부터 domain concern을 맡는가
- DTO와 validation이 입력 경계를 어디서 끊는가

즉, CRUD는 기능의 종류가 아니라 **경계 설계 연습**이다.

## DTO가 실전 CRUD에서 맡는 역할

실전 CRUD 예제에서 DTO는 형식적 장식이 아니다. `CreateUserDto`는 body에서 어떤 필드를 어떤 규칙으로 받아들일지를 아주 명시적으로 선언한다 `[ex:realworld-api/src/users/create-user.dto.ts]`.

```ts
// source: ex:realworld-api/src/users/create-user.dto.ts
export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @FromBody('name')
  name!: string;

  @IsString()
  @IsNotEmpty()
  @FromBody('email')
  email!: string;
}
```

이 코드는 core/validation/http의 협업을 한 눈에 보여 준다. `@FromBody(...)`는 binding source를 정하고 `[pkg:http/src/adapters/binding.ts]`, `@IsString()`과 `@IsNotEmpty()`는 validation 규칙을 쌓는다 `[repo:docs/concepts/http-runtime.md]`. 즉, DTO 한 클래스 안에서 “입력 출처”와 “입력 유효성”이 동시에 명시된다.

## controller는 입력과 출력 계약을 모두 가진다

`UsersController`는 request DTO만 받는 것이 아니라, 반환 타입까지 `UserResponseDto`로 명시하고 있다 `[ex:realworld-api/src/users/users.controller.ts]`.

```ts
// source: ex:realworld-api/src/users/users.controller.ts
@Inject(UsersService)
@Controller('/users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get('/')
  list(): UserResponseDto[] {
    return this.service.listUsers();
  }

  @Post('/')
  @RequestDto(CreateUserDto)
  create(dto: CreateUserDto): UserResponseDto {
    return this.service.createUser(dto.name, dto.email);
  }
}
```

이 컨트롤러가 중요한 이유는 아주 단순한 CRUD surface 안에서도 **입력 계약**과 **출력 계약**이 모두 분명하다는 점이다. `CreateUserDto`는 input boundary고, `UserResponseDto`는 output shape를 드러낸다. 즉, CRUD 장은 “데이터를 넣고 꺼낸다”보다 **어떤 계약을 통과해 데이터가 오가는가**를 보여 주는 장이다.

## response DTO가 왜 필요한가

`UserResponseDto` 자체는 놀랄 만큼 단순하다 `[ex:realworld-api/src/users/user-response.dto.ts]`.

```ts
// source: ex:realworld-api/src/users/user-response.dto.ts
export class UserResponseDto {
  id!: string;
  name!: string;
  email!: string;
}
```

하지만 이 단순함이 오히려 중요하다. response DTO는 “무엇을 돌려줄 것인가”를 문서와 코드 양쪽에서 동시에 명확하게 해 준다. 나중에 persistence layer가 바뀌거나 내부 entity shape가 바뀌더라도, API surface는 이 DTO contract를 중심으로 유지될 수 있다.

## root app에서 CRUD 슬라이스가 어떤 자리에 놓이는가

`realworld-api/src/app.ts`는 CRUD 예제가 루트 앱에 어떤 위치로 들어가는지 보여 준다 `[ex:realworld-api/src/app.ts]`.

```ts
// source: ex:realworld-api/src/app.ts
@Module({
  imports: [ConfigModule.forRoot({ envFile: '.env', processEnv: process.env }), RuntimeHealthModule, UsersModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

이 코드가 보여 주는 것은, CRUD 예제가 장난감이 아니라는 점이다. UsersModule은 config와 health와 나란히 root imports 안에 들어간다. 즉, 이 책에서 CRUD 장은 “간단한 샘플 기능”이 아니라 **실제 앱 구조에 배치되는 feature slice**를 설명하는 장이다.

## repo는 왜 이 정도로 단순해야 하는가

`UsersRepo` 구현도 일부러 단순하다 `[ex:realworld-api/src/users/users.repo.ts]`.

```ts
// source: ex:realworld-api/src/users/users.repo.ts
export class UsersRepo {
  private readonly store = new Map<string, UserResponseDto>();
  private nextId = 1;

  create(name: string, email: string): UserResponseDto {
    const id = String(this.nextId++);
    const user: UserResponseDto = { id, name, email };
    this.store.set(id, user);
    return user;
  }
}
```

이 단순함은 오히려 교육적으로 중요하다. persistence 기술을 설명하기 전에, 저장소 경계가 먼저 보여야 하기 때문이다. 나중에 Prisma나 Drizzle로 바꾸더라도, 이 장이 전달해야 하는 핵심은 “Map을 Prisma로 바꾸는 법”이 아니라 **repo를 provider 경계로 유지하는 법**이다.

## 테스트가 이 구조를 어떻게 증명하는가

`examples/realworld-api/src/app.test.ts`는 이 장에서 매우 중요한 텍스트다 `[ex:realworld-api/src/app.test.ts]`. 이 파일 하나 안에 다음이 모두 들어 있다.

- plain class 수준의 `UsersRepo` unit test `[ex:realworld-api/src/app.test.ts#L11-L21]`
- `UsersService` unit test `[ex:realworld-api/src/app.test.ts#L23-L33]`
- `fluoFactory.create(...)` 기반 integration test `[ex:realworld-api/src/app.test.ts#L74-L103]`
- `createTestApp(...)` 기반 e2e 스타일 test `[ex:realworld-api/src/app.test.ts#L105-L147]`

이 구조는 CRUD 예제가 단순 샘플이 아니라, fluo의 testing ladder까지 함께 보여 주는 교육 자산이라는 뜻이다.

## realworld 예제를 읽는 추천 순서

1. `users.module.ts`로 기능 경계를 본다 `[ex:realworld-api/src/users/users.module.ts]`
2. `users.controller.ts`로 request/response 경계를 본다 `[ex:realworld-api/src/users/users.controller.ts]`
3. `users.service.ts`로 domain 로직 중심을 본다 `[ex:realworld-api/src/users/users.service.ts]`
4. 관련 DTO와 test를 읽으며 입력/출력 계약을 확인한다 `[ex:realworld-api/README.md]`

이 순서를 따르면 앞 장에서 배운 core, DI, HTTP가 실제 애플리케이션 구조에서 어떻게 협력하는지 보이기 시작한다.

## 왜 CRUD 챕터가 중요한가

CRUD는 단순해 보여도 core, DI, HTTP, DTO, config, testing이 모두 만나는 지점이다. 그래서 독자는 이 장을 통해 “앞 장에서 배운 개념이 실전에서 어떤 조합으로 쓰이는지”를 처음 체감하게 된다.

메인테이너 관점에서 이 장의 진짜 의미는 더 크다. 예제 하나가 잘 설계되어 있으면, 그것은 단순 샘플이 아니라 **문서와 설계 철학을 검증하는 실행 가능한 증거**가 되기 때문이다.
