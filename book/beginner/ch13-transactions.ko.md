<!-- packages: @fluojs/prisma -->
<!-- project-state: FluoBlog v1.10 -->

# Chapter 13. Transactions and Data Access Patterns

이 장은 FluoBlog의 여러 데이터 변경을 하나의 안전한 작업 단위로 묶는 트랜잭션 패턴을 설명합니다. Chapter 12에서 Prisma로 영속성을 얻었다면, 이제는 그 쓰기 작업을 일관되게 유지하는 방법을 배웁니다.

## Learning Objectives
- `@Transaction()` 데코레이터가 서비스 레벨 경계를 어떻게 관리하는지 배웁니다.
- 트랜잭션 내부와 외부에서 원활하게 작동하는 트랜잭션 중립적 리포지토리를 설계합니다.
- 정밀한 제어를 위해 Prisma 블록 패턴을 사용하여 수동 트랜잭션을 구현합니다.
- `AsyncLocalStorage`(ALS)가 내부적으로 컨텍스트를 어떻게 관리하는지 이해합니다.
- 초기 프로필 설정과 함께 사용자 등록과 같은 복잡한 작업을 처리하도록 FluoBlog를 리팩토링합니다.

## Prerequisites
- Chapter 12 완료.
- Prisma 스키마, 마이그레이션, `PrismaService`의 기본 사용법을 이해합니다.
- 하나의 요청에서 여러 데이터베이스 작업이 함께 실행되는 상황을 떠올릴 수 있습니다.

## 13.1 The Need for Atomic Operations
이전 장에서 우리는 FluoBlog를 데이터베이스에 연결했습니다. 하지만 많은 비즈니스 작업은 단순히 하나의 "저장"으로 끝나지 않습니다. 새 사용자가 가입하는 시나리오를 생각해 보십시오.
1. 주 데이터베이스에 `User` 레코드를 생성합니다.
2. 사용자 기본 설정을 저장하기 위한 초기 `Profile` 레코드를 생성합니다.
3. 기본 "신규 회원" 배지를 할당하거나 권한 테이블에 항목을 추가합니다.

만약 1단계는 성공했지만 2단계에서 실패한다면 어떤 일이 벌어질까요? 프로필이 없는 "좀비" 사용자가 생성되어, 프로필이 존재할 것이라고 예상하는 시스템의 다른 부분에서 장애를 일으킬 가능성이 큽니다. 이는 일련의 작업들이 모두 성공하거나 아니면 모두 함께 실패해야 한다는 **원자성(Atomicity)** 원칙에 위배됩니다. 복잡한 분산 시스템에서 이러한 원자성을 유지하는 것은 훨씬 더 어려운 일이지만, 시스템 신뢰성의 근간으로 남아 있습니다.

일관성을 데이터베이스의 법적 프레임워크라고 생각하십시오. 트랜잭션이 기술적으로 성공(원자성)하더라도 시스템의 불변성을 위반해서는 안 됩니다. "잔액이 음수가 될 수 없다"는 제약 조건이 있는 계좌에서 돈을 송금하려고 할 때, 계산 자체는 맞더라도 결과가 음수가 된다면 트랜잭션은 반드시 실패해야 합니다. 이러한 의미적 일관성은 애플리케이션이 로직 오류와 사용자 불만으로 이어지는 "불가능한" 상태에 진입하는 것을 방지합니다.

### Consistency: Beyond Just Atomicity
원자성이 모든 단계가 함께 일어나는 것을 보장한다면, **일관성(Consistency)**은 데이터가 정의된 모든 규칙에 따라 유효한 상태를 유지하도록 보장합니다. 예를 들어, 모든 프로필은 반드시 사용자에게 속해야 한다는 규칙이 있다면, 트랜잭션은 복잡한 다단계 업데이트 중에도 이 규칙이 결코 깨지지 않도록 보장합니다. fluo와 Prisma의 통합은 이러한 일관성 규칙을 강제하는 과정을 매우 직관적으로 만들어 줍니다. 일관성은 단순히 성공적인 쓰기만을 의미하는 것이 아니라, 모든 작업 후에 데이터의 전체 우주가 일관되고 예측 가능한 상태를 유지하는 것을 의미합니다.

### Durability and the Promise of Persistence
ACID의 "D"는 **지속성(Durability)**을 의미하며, 일단 트랜잭션이 커밋되면 시스템 오류(정전이나 크래시 등)가 발생하더라도 그 결과가 영구적으로 유지됨을 보장합니다. PostgreSQL과 같은 견고한 데이터베이스를 Prisma 및 fluo와 함께 사용하면 지속성을 진지하게 다루는 토대 위에 애플리케이션을 구축하게 됩니다. 사용자는 "성공" 메시지를 받았을 때 자신의 데이터가 디스크에 안전하고 영구적으로 저장되었음을(설정에 따라 여러 복제본에 걸쳐) 신뢰할 수 있습니다.

이러한 영구성은 금융 시스템부터 소셜 네트워크에 이르기까지 데이터 유실이 허용되지 않는 애플리케이션의 핵심 요소입니다. 지속성은 데이터베이스 엔진의 정교한 로깅 메커니즘(Write-Ahead Logging 또는 WAL 등)을 통해 달성됩니다. 커밋 직후 1마이크로초 만에 서버 전원이 꺼지더라도, 데이터베이스는 재시작 시 이러한 로그를 사용하여 커밋된 상태를 재구성할 수 있습니다. Fluo 생태계에서는 이 산업 수준의 기능을 활용하므로, 애플리케이션 코드는 비즈니스 흐름에 집중할 수 있습니다.

### Isolation: The "I" in ACID
나중에 더 자세히 다루겠지만, 여기서 **격리성(Isolation)**을 소개하는 것이 중요합니다. 격리성은 동시에 실행되는 트랜잭션들이 서로 간섭하지 않도록 보장합니다. 두 사용자가 정확히 동일한 밀리초에 콘서트의 마지막 티켓을 구매하려고 할 때, 격리성은 한 장의 티켓에 대해 두 명 모두에게 요금이 부과되는 대신 한 명은 성공하고 다른 한 명은 "매진" 메시지를 받도록 보장합니다. 격리성이 없다면 데이터베이스의 내부 상태는 여러 사용자의 미완성된 쓰기 작업으로 인해 혼란에 빠지게 되며, 이는 비즈니스 로직에서 예측 불가능하고 치명적인 실패로 이어질 것입니다.

## 13.2 서비스 레벨 트랜잭션: @Transaction()
fluo에서 서비스 레이어는 비즈니스 경계를 정의하는 기본 장소입니다. 트랜잭션을 관리하는 가장 쉽고 권장되는 방법은 `@Transaction()` 데코레이터를 사용하는 것입니다.

```typescript
import { Inject } from '@fluojs/core';
import { Transaction } from '@fluojs/prisma';

@Inject(UsersRepository, ProfilesRepository)
export class UsersService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly profilesRepo: ProfilesRepository,
  ) {}

  @Transaction()
  async registerUser(userData, profileData) {
    // 이 중 하나라도 에러가 발생하면 메서드 전체가 롤백됩니다
    const user = await this.usersRepo.create(userData);
    await this.profilesRepo.create({ ...profileData, userId: user.id });
    return user;
  }
}
```

`@Transaction()`을 적용하면, 해당 메서드 전체가 단일 데이터베이스 트랜잭션 내에서 실행되어야 함을 fluo에 알리게 됩니다. 메서드가 성공적으로 반환되면 트랜잭션이 커밋되고, 에러가 발생하면 fluo는 해당 메서드 내부에서 발생한 모든 변경 사항을 자동으로 롤백합니다.

이 방식은 서비스 메서드를 깔끔하게 유지해 줍니다. 트랜잭션을 수동으로 열거나 닫을 필요가 없으며, 데코레이터가 수명 주기를 대신 관리하므로 개발자는 순수하게 비즈니스 로직에만 집중할 수 있습니다.

### The Repository Rule: Transaction Agnosticism
위의 예시에서 서비스가 별도의 트랜잭션 객체를 전달하지 않고 `usersRepo.create()`와 `profilesRepo.create()`를 호출하는 것에 주목하십시오. 이것이 가능한 이유는 Fluo 리포지토리가 **트랜잭션 중립적(Transaction Agnostic)**으로 설계되었기 때문입니다.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

@Inject(PrismaService)
export class UsersRepository {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async create(data) {
    // 이제 기본 흐름에서 .current()를 명시적으로 호출할 필요가 없습니다!
    // PrismaService가 활성 트랜잭션이 있는지 자동으로 감지하여 사용합니다.
    return this.prisma.user.create({ data });
  }
}
```

`PrismaService`는 컨텍스트를 인지하기 때문에, 현재 `@Transaction()` 경계 내부에서 실행 중인지 자동으로 감지합니다. 트랜잭션 내부라면 트랜잭션 인식 클라이언트를 사용하고, 그렇지 않다면 표준 클라이언트를 사용합니다. 즉, 리포지토리 코드는 단독 작업으로 호출되든 복잡한 서비스 레벨 트랜잭션의 일부로 호출되든 완전히 동일하게 유지됩니다.

## 13.3 Manual Transactions: The Block Pattern
`@Transaction()`이 대부분의 경우 완벽하지만, 때로는 단일 메서드 내에서 트랜잭션이 시작되고 끝나는 지점을 더 정밀하게 제어해야 할 때가 있습니다. 이럴 때는 수동 블록 패턴을 사용할 수 있습니다.

```typescript
@Inject(PrismaService, UsersRepository, ProfilesRepository)
export class UsersService {
  constructor(
    private readonly prisma: PrismaService<any>,
    private readonly usersRepo: UsersRepository,
    private readonly profilesRepo: ProfilesRepository,
  ) {}

  async registerUser(userData, profileData) {
    // ... 일부 비트랜잭션 작업 ...

    const result = await this.prisma.transaction(async () => {
      const user = await this.usersRepo.create(userData);
      await this.profilesRepo.create({ ...profileData, userId: user.id });
      return user;
    });

    // ... 트랜잭션 커밋 후의 작업 ...
    return result;
  }
}
```

블록 패턴은 특정 단계에서 발생하는 에러를 개별적으로 처리하고 싶거나, 데이터베이스 작업이 확실히 커밋된 후에만 부수 효과(로깅, 메트릭 등)를 수행하고 싶을 때 유용합니다.

### Nested Transactions and Reusability
Fluo는 이미 활성화된 트랜잭션 클라이언트를 재사용함으로써 "중첩된" 트랜잭션을 처리합니다. `Service A`의 `@Transaction()` 메서드가 `Service B`의 `@Transaction()` 메서드를 호출하면, 두 메서드는 동일한 외부 트랜잭션을 공유하게 됩니다. 모든 작업은 하나의 응집력 있는 작업 단위로 취급됩니다.

## 13.4 Advanced Patterns and Internals

때로는 HTTP 요청 전체를 하나의 트랜잭션으로 감싸고 싶을 때가 있습니다. 이는 **작업 단위(Unit of Work)** 패턴의 전형적인 구현입니다.

```typescript

@Controller('users')
export class UsersController {
  @Post()
  async signup(dto: CreateUserDto) {
    return this.authService.register(dto);
  }
}
```


### How it Works: AsyncLocalStorage (ALS)
많은 프레임워크에서는 모든 함수 호출마다 "트랜잭션 객체"(`tx`)를 전달해야 합니다. 이는 비즈니스 로직을 오염시키고 리팩토링을 어렵게 만듭니다.

Fluo는 **AsyncLocalStorage(ALS)**를 사용하여 이를 해결합니다. ALS는 비동기 호출 스택을 따라 자동으로 이동하는 "숨겨진" 컨텍스트를 유지해 주는 Node.js 내장 기능입니다. 트랜잭션이 시작되면 fluo는 트랜잭션 클라이언트를 ALS에 저장하고, `PrismaService`는 단순히 이 컨텍스트를 조회하여 활성 클라이언트를 찾아냅니다.

### 명시적 컨텍스트: .current()
자동 조회를 우회하거나 트랜잭션 활성 여부를 명시적으로 확인해야 하는 경우 `.current()`를 사용할 수 있습니다.

```typescript
async someMethod() {
  const activeClient = this.prisma.current(); 
  // 트랜잭션 중이면 트랜잭션 클라이언트를, 아니면 루트 클라이언트를 반환합니다.
}
```

기본적인 리포지토리 흐름에서는 더 깔끔한 직접 호출(`this.prisma.user.create`)을 권장하지만, 인프라 로직이나 멀티테넌시 시나리오에서 정확한 핸들을 확인해야 할 때는 `.current()`가 유용하게 쓰입니다.


## 13.5 Isolation Levels and Concurrency
Fluo가 트랜잭션의 "시점"을 처리하는 동안, 때로는 동시성과 관련하여 "방법"을 제어해야 할 때가 있습니다. 데이터베이스 격리 수준(Isolation levels)은 여러 사용자가 동시에 동일한 데이터를 쓸 때 발생할 수 있는 "Dirty Read"나 "Lost Update"와 같은 문제를 방지합니다.

격리 수준은 하나의 트랜잭션이 다른 동시 트랜잭션의 데이터 수정으로부터 얼마나 격리되어야 하는지를 정의합니다. `fluo`에서는 수동 트랜잭션을 시작할 때 이 수준을 손쉽게 지정할 수 있습니다. 이러한 격리 수준을 이해하는 것은 부하가 높은 상황에서도 데이터 일관성을 타협할 수 없는 고신뢰성 시스템을 구축하는 데 필수적입니다.

```typescript
await this.prisma.transaction(async () => {
  // ...
}, {
  // 최고 수준의 보호를 제공하며, 이 트랜잭션이 완료될 때까지 
  // 다른 트랜잭션이 읽은 데이터를 수정할 수 없도록 보장합니다.
  isolationLevel: 'Serializable', 
});
```

### The Trade-off: Performance vs. Consistency
격리 수준을 선택하는 것은 항상 성능과 일관성 사이의 균형을 맞추는 일입니다. `ReadCommitted`와 같은 수준은 좋은 성능을 제공하지만 "반복 불가능한 읽기(non-repeatable reads)"를 허용할 수 있습니다. 반면 `Serializable`은 가장 높은 수준의 일관성을 제공하지만 트랜잭션 충돌이 더 많이 발생할 수 있고 과부하 상태에서 성능이 저하될 수 있습니다.

일반적인 규칙으로, 기본값(PostgreSQL의 경우 보통 `ReadCommitted`)에서 시작하여 비즈니스 로직에서 특별히 요구할 때만 더 높은 수준으로 이동하세요. 예를 들어, 아이템을 절대 중복 판매해서는 안 되는 재고 시스템을 구축하는 경우, 절대적인 정확성을 보장하기 위해 더 높은 격리 수준이나 "SELECT FOR UPDATE" 락을 사용할 수 있습니다. 대부분의 초급 애플리케이션에서는 기본 설정으로도 충분하지만, 규모가 커짐에 따라 이러한 트레이드오프를 이해하는 것은 엔지니어링 역량의 중요한 부분이 됩니다.

### Common Concurrency Issues
- **Dirty Reads**: 트랜잭션이 다른 트랜잭션에 의해 수정되었지만 아직 커밋되지 않은 데이터를 읽습니다. 해당 트랜잭션이 롤백되면, 현재 트랜잭션은 "쓰레기" 데이터를 읽은 셈이 됩니다.
- **Non-Repeatable Reads**: 트랜잭션이 동일한 행을 두 번 읽었는데, 그 사이에 다른 트랜잭션이 해당 데이터를 수정하여 결과가 달라집니다.
- **Phantom Reads**: 트랜잭션이 동일한 쿼리를 두 번 실행했는데, 그 사이에 다른 트랜잭션이 행을 추가하거나 삭제하여 결과 행의 수가 달라집니다.

대부분의 현대적 데이터베이스와 Fluo/Prisma의 기본 설정은 가장 위험한 문제(Dirty Reads 등)를 방지하도록 설계되어 있지만, 요구 사항에 따라 이러한 설정을 조정해야 할 수도 있습니다.

## 13.6 Refactoring FluoBlog
"작성자 프로필" 페이지를 최적화하기 위해, 게시물을 생성할 때 `User` 레코드의 `postCount`를 증가시키는 견고한 로직을 구현해 보겠습니다. 이러한 카운터를 유지함으로써 프로필 페이지를 방문할 때마다 비용이 많이 드는 "COUNT(*)" 쿼리를 실행하는 것을 피할 수 있습니다. 이는 성능을 위한 전형적인 **비정규화(Denormalization)** 사례입니다.

카운트나 집계 데이터와 같은 파생 데이터(derived data)를 유지하는 것은 백엔드 개발에서 흔히 쓰이는 성능 최적화 기법입니다. 다만, 기본 데이터(새 게시물)와 파생 데이터(업데이트된 카운트)가 항상 일치하도록 세심한 트랜잭션 관리가 필요합니다. Fluo의 트랜잭션 모델은 이러한 조율 작업을 간단하고 강력하게 만들어 줍니다.

이 분리는 실제 예제에서 더 분명해집니다. (성능상의 이유로) 게시물 수를 업데이트하는 로직을 포함한 견고한 게시물 생성 흐름을 구현해 보겠습니다.

```typescript
// src/posts/posts.service.ts
@Inject(PrismaService, PostsRepository, UsersRepository)
export class PostsService {
  constructor(
    private readonly prisma: PrismaService<any>,
    private readonly postsRepo: PostsRepository,
    private readonly usersRepo: UsersRepository,
  ) {}

  async createPost(userId: number, dto: CreatePostDto) {
    return this.prisma.transaction(async () => {
      // 1. 게시물 생성
      const post = await this.postsRepo.create({ ...dto, authorId: userId });
      // 2. 사용자 카운터 증가
      await this.usersRepo.incrementPostCount(userId);
      return post;
    });
  }
}
```

이 작업들을 하나의 트랜잭션에 넣음으로써, `postCount`가 실제 `Post` 테이블의 행 수와 어긋나는 일이 없도록 보장할 수 있습니다. 게시물 생성은 성공했지만 카운터 업데이트가 (락 타임아웃 등으로 인해) 실패한다면, 게시물 생성 자체가 롤백되어 카운터 로직의 무결성이 유지됩니다.

이제 `incrementPostCount`가 실패하더라도, 게시물만 생성되고 개수 업데이트는 누락되는 일은 발생하지 않습니다. 데이터 변경은 하나의 일관된 작업으로 남고, 서비스 코드도 예외 상황 정리 코드의 묶음이 아니라 하나의 비즈니스 동작처럼 읽힙니다.

### Event-Driven Alternatives to Transactions
트랜잭션은 즉각적인 일관성에 훌륭하지만, 때로는 이벤트 기반 접근 방식을 통해 동일한 목표를 달성할 수도 있습니다. 예를 들어, 동일한 트랜잭션에서 `postCount`를 업데이트하는 대신 `PostCreatedEvent`를 발행하고 별도의 백그라운드 워커가 카운트를 업데이트하게 할 수 있습니다. 이 "최종 일관성(eventual consistency)" 모델은 메인 트랜잭션을 단축하여 성능을 향상시킬 수 있지만, 복잡성이 증가하고 일시적인 데이터 불일치가 발생할 수 있습니다.

이 장에서는 엄격한 일관성이 우선순위인 대부분의 초중급 유스케이스에서 더 간단하고 신뢰할 수 있는 트랜잭션 방식에 집중합니다. 애플리케이션이 글로벌 규모로 성장하면 이러한 결정을 재검토하고 이벤트 기반 패턴으로 전환할 수 있겠지만, 트랜잭션으로 시작하는 것이 가장 안전하고 예측 가능한 경로입니다.

## 13.7 Summary
이 장에서 우리는 데이터 무결성과 Fluo의 트랜잭션 모델, 그리고 관련된 여러 쓰기 작업을 함께 묶어 주는 패턴을 살펴보았습니다. 신뢰할 수 있는 트랜잭션 관리는 상용 애플리케이션의 기반이며, Fluo는 제어력을 희생하지 않으면서 이 복잡성을 낮춰 줍니다. 이제 각 패턴이 어떤 문제를 해결하는지 정리해 보겠습니다.

- **원자성(Atomicity)**은 다단계 작업이 "전부 아니면 전무(all or nothing)"임을 보장합니다.
- **일관성(Consistency)**은 데이터베이스가 비즈니스 규칙에 따라 유효한 상태를 유지하도록 합니다.
- **지속성(Durability)**은 시스템 크래시 후에도 데이터가 안전함을 보장합니다.
- **ALS(AsyncLocalStorage)**는 리포지토리가 `.current()`를 통해 트랜잭션을 투명하게 처리할 수 있게 해줍니다.
- **수동 블록**은 정밀한 제어가 필요한 서비스에서 특정 대상을 원자적으로 처리할 때 사용합니다.
- **인터셉터**는 작업 단위(Unit of Work) 패턴을 사용하여 요청 전체의 일관성을 자동으로 유지할 때 사용합니다.
- **서비스-리포지토리 분리**는 비즈니스 규칙(트랜잭션)을 쿼리 로직(SQL/Prisma)으로부터 분리합니다.

### Persistence: Beyond Just Atomicity
Part 2에서는 Fluo의 "데이터"와 "설정" 측면을 정리했습니다. 이번 파트에서 우리는 명시적 설정, 영구 저장, 트랜잭션 안전한 데이터 접근을 순서대로 쌓아 올렸고, 그 결과 단순한 메모리 기반 토이 프로젝트에서 견고한 데이터베이스 기반 애플리케이션 구조로 한 단계 올라섰습니다. Part 3에서는 보안에 초점을 맞춰 인증(Authentication)과 JWT부터 시작하겠습니다.

Fluo와 Prisma를 사용하면 ACID 원칙을 진지하게 반영한 기반 위에서 시스템을 구축하게 됩니다. 사용자는 "Success" 메시지를 받았을 때 자신의 데이터가 안전하고 영구적으로 저장되었다고 믿을 수 있습니다. 이러한 신뢰성은 전문적인 백엔드의 특징입니다.

또한 트랜잭션 무결성이 시스템 확장성에 미치는 영향도 생각해 보아야 합니다. 엄격한 트랜잭션을 통해 높은 데이터 품질을 유지하는 시스템은 부분 쓰기와 불일치 상태가 난무하는 시스템보다 훨씬 더 쉽게 확장할 수 있고 이해하기도 쉽습니다. 시스템이 성장할수록 이런 초기 아키텍처 결정은 기술 부채를 줄이고 프로덕션 장애를 줄이는 형태로 큰 가치를 돌려줍니다.

### Advanced Transaction Patterns
기본적인 블록 패턴과 인터셉터 패턴을 넘어, Fluo는 다음과 같은 더 고급 시나리오도 지원합니다.
1. **병렬 트랜잭션**: 서로 같은 리소스 의존성을 공유하지 않는 독립 작업을 동시에 실행하는 방식입니다.
2. **선택적 롤백**: 더 세밀한 에러 처리를 사용해 블록 전체를 롤백할지, 아니면 바깥 컨텍스트에 영향을 주지 않고 우아하게 처리할지를 결정하는 방식입니다.
3. **트랜잭션 훅**: 커밋이나 롤백 직전/직후에 로직을 실행하는 방식으로, 외부 캐시나 메시지 브로커와의 동기화에 유용합니다.

이러한 패턴을 익히면 작은 프로젝트에서 쓰던 규칙을 더 까다로운 엔터프라이즈 요구 사항에도 일관되게 적용할 수 있습니다.

### The Human Side of Transactions
모든 트랜잭션 뒤에는 사용자의 기대가 있습니다. 누군가 "Buy"를 클릭하면 일관된 결과를 기대합니다. 누군가 "Signs Up"을 하면 자신의 프로필이 준비되어 있기를 기대합니다. 트랜잭션은 현실 세계의 의도를 정돈된 디지털 기록으로 이어 주는 기술적 다리입니다. 이 경계를 제대로 다루면 API는 단순히 응답을 반환하는 수준을 넘어 사용자의 신뢰를 지키게 됩니다.

트랜잭션은 간결하게 유지하고, 리포지토리는 트랜잭션에 종속되지 않게 두며, 서비스 레이어는 큰 그림에 집중하게 하십시오. 이것이 fluo 전문가로 성장하는 길입니다.

### Transaction Logging and Auditing
프로덕션 환경에서는 트랜잭션이 발생했다는 사실만 아는 것으로는 충분하지 않은 경우가 많습니다. *무엇이* 바뀌었는지, 그리고 *누가* 바꿨는지를 알아야 합니다. Fluo의 미들웨어를 Prisma의 미들웨어 또는 확장과 통합하면 트랜잭션 안에서 발생한 모든 행 수준 변경을 기록하는 투명한 감사 시스템을 구현할 수 있습니다. 이 "Audit Log"는 디버깅, 보안 조사, 규제 준수에 매우 중요한 도구가 됩니다.

또한 시스템 가용성을 유지하는 데서 트랜잭션 타임아웃이 맡는 역할도 생각해 보아야 합니다. 중요한 테이블에 잠금을 건 채 오래 실행되는 트랜잭션은 애플리케이션 전체를 사실상 멈춰 세울 수 있습니다. `fluo`에서는 하나의 비정상 요청이 리소스를 독점하지 못하도록 애플리케이션 수준에서는 인터셉터로, 데이터베이스 수준에서는 DB 설정으로 엄격한 타임아웃을 두는 것을 권장합니다.

### Distributed Transactions and Sagas
모놀리식 Fluo 애플리케이션에서 마이크로서비스 아키텍처로 이동하면 "트랜잭션"이라는 개념도 함께 확장됩니다. 더 이상 여러 서비스에 걸친 변경을 조정하기 위해 단일 데이터베이스의 ACID 속성에만 의존할 수 없습니다. 대신 로컬 트랜잭션의 연쇄와 보상 작업을 사용해 서비스 경계 전반의 데이터 무결성을 유지하는 **Saga Pattern** 같은 패턴을 받아들여야 합니다. `fluo`는 이러한 고급 패턴을 위한 구성 요소를 제공하지만, 일관성을 바라보는 관점은 달라져야 합니다. 즉, "즉각적인 정합성"보다 "최종적인 정합성"을 받아들이는 사고방식이 필요합니다.

### Final Thoughts on Data Patterns
데이터를 다루는 방식은 애플리케이션의 성격을 규정합니다. 숨겨진 마법보다 명시적 트랜잭션을, 강하게 결합된 리포지토리보다 트랜잭션에 종속되지 않는 리포지토리를 선택하면 오랫동안 즐겁게 유지보수할 수 있는 코드베이스로 나아가게 됩니다. Part 2는 애플리케이션의 "Ground Truth"를 다루는 여정이었습니다. 이제 탄탄한 기반을 갖췄으니 이를 안전하게 지켜 봅시다.

### Monitoring Transaction Health
높은 성능의 시스템을 유지하려면 트랜잭션 상태를 실시간으로 모니터링해야 합니다. Fluo의 내장 메트릭을 사용해 트랜잭션 지속 시간, 커밋 대비 롤백 비율, 잠금 경합 지표를 추적하십시오. 롤백이 급증한다면 비즈니스 로직의 버그나 데이터베이스 연결 문제를 의심해 볼 수 있습니다. 반대로 잠금 경합이 높다면 트랜잭션이 너무 길거나 같은 데이터베이스 행을 너무 자주 건드리고 있다는 뜻일 수 있으며, 이는 아키텍처 변경이나 더 나은 캐싱이 필요하다는 신호입니다.

메트릭에 더해 구조화된 로깅도 필수입니다. 모든 트랜잭션은 고유 ID, 즉 ALS가 제공하는 식별자를 로그에 남겨야 요청이 실패했을 때 정확히 무슨 일이 있었는지 추적할 수 있습니다. HTTP 요청과 데이터베이스 트랜잭션 사이의 이런 상관관계 덕분에 Fluo 애플리케이션은 압박이 큰 프로덕션 상황에서도 디버깅하기가 매우 쉬워집니다. 트랜잭션을 관측 가능성 스택의 일급 시민으로 다루면 데이터 레이어가 결코 "black box"로 남지 않게 됩니다.

### Scaling Your Transactional Logic
팀이 성장할수록 일관된 트랜잭션 패턴을 유지하는 일은 사람의 문제이기도 해집니다. 트랜잭션 규칙을 명확히 문서화하고, 린트나 아키텍처 테스트를 사용해 새 리포지토리마다 트랜잭션 인식 직접 호출 패턴을 따르는지 확인하십시오.
 이런 규칙을 툴링 수준에서 강제하면 기술 부채가 서서히 스며드는 일을 막고 코드베이스를 처음 만들었을 때처럼 깔끔하고 신뢰할 수 있는 상태로 유지할 수 있습니다.

데이터 패턴을 익히는 여정은 단지 코드를 작성하는 일이 아니라, 정확성과 책임감의 사고방식을 받아들이는 과정입니다. 데이터베이스에 기록하는 모든 바이트는 사용자에게 하는 약속입니다. Fluo의 트랜잭션 도구를 사용한다는 것은 그 약속을 자신 있게 지키겠다는 뜻입니다.
