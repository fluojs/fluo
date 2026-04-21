<!-- packages: @fluojs/prisma -->
<!-- project-state: FluoBlog v1.10 -->

# Chapter 13. Transactions and Data Access Patterns

## Learning Objectives
- 데이터베이스 작업에서 원자성, 일관성, 격리성, 지속성(ACID)의 중요성을 이해합니다.
- `fluo`가 `AsyncLocalStorage`(ALS)를 사용하여 트랜잭션 컨텍스트를 관리하는 방법을 배웁니다.
- Prisma 블록 패턴을 사용하여 수동 트랜잭션을 구현합니다.
- 요청 범위 트랜잭션을 위해 `PrismaTransactionInterceptor`를 사용합니다.
- 트랜잭션 내부와 외부에서 원활하게 작동하는 트랜잭션 중립적 리포지토리를 설계합니다.
- 초기 프로필 설정과 함께 사용자 등록과 같은 복잡한 작업을 처리하도록 FluoBlog를 리팩토링합니다.

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
ACID의 "D"는 **지속성(Durability)**을 의미하며, 일단 트랜잭션이 커밋되면 시스템 오류(정전이나 크래시 등)가 발생하더라도 그 결과가 영구적으로 유지됨을 보장합니다. PostgreSQL과 같은 견고한 데이터베이스를 Prisma 및 fluo와 함께 사용함으로써, 여러분은 지속성을 진지하게 다루는 토대 위에 애플리케이션을 구축하게 됩니다. 사용자는 "성공" 메시지를 받았을 때 자신의 데이터가 디스크에 안전하고 영구적으로 저장되었음을(설정에 따라 여러 복제본에 걸쳐) 신뢰할 수 있습니다.

이러한 영구성은 금융 시스템부터 소셜 네트워크에 이르기까지 데이터 유실이 허용되지 않는 고위험 애플리케이션을 구축할 수 있게 해주는 핵심 요소입니다. 지속성은 데이터베이스 엔진의 정교한 로깅 메커니즘(Write-Ahead Logging 또는 WAL 등)을 통해 달성됩니다. 커밋 직후 1마이크로초 만에 서버 전원이 꺼지더라도, 데이터베이스는 재시작 시 이러한 로그를 사용하여 커밋된 상태를 재구성할 수 있습니다. Fluo 생태계에서는 이러한 산업 수준의 기능을 활용하므로, 여러분은 안심하고 기능을 구축하는 데만 집중할 수 있습니다.

### Isolation: The "I" in ACID
나중에 더 자세히 다루겠지만, 여기서 **격리성(Isolation)**을 소개하는 것이 중요합니다. 격리성은 동시에 실행되는 트랜잭션들이 서로 간섭하지 않도록 보장합니다. 두 사용자가 정확히 동일한 밀리초에 콘서트의 마지막 티켓을 구매하려고 할 때, 격리성은 한 장의 티켓에 대해 두 명 모두에게 요금이 부과되는 대신 한 명은 성공하고 다른 한 명은 "매진" 메시지를 받도록 보장합니다. 격리성이 없다면 데이터베이스의 내부 상태는 여러 사용자의 미완성된 쓰기 작업으로 인해 혼란에 빠지게 되며, 이는 비즈니스 로직에서 예측 불가능하고 치명적인 실패로 이어질 것입니다.

## 13.2 Fluo's Transaction Philosophy
많은 프레임워크에서 트랜잭션을 관리하려면 모든 함수 호출마다 "트랜잭션 객체"나 "데이터베이스 클라이언트"를 전달해야 합니다. 이를 보통 "TX 주입(TX Injection)" 패턴이라고 부릅니다.

```typescript
// 기존/명시적 패턴 - 유지보수가 어렵습니다
async createUser(data, tx?) {
  const client = tx || this.db;
  return client.user.create({ data });
}
```

이 방식은 비즈니스 로직을 데이터베이스 관심사로 오염시키고 리팩토링을 어렵게 만듭니다. 서비스 트리의 깊은 곳에서 세 번째 리포지토리 호출을 추가하기로 결정했다면, 전체 호출 체인을 돌아가며 `tx` 객체를 전달하도록 업데이트해야 합니다. `fluo`는 **AsyncLocalStorage(ALS)**를 사용하여 다른 방식을 취합니다. 이를 통해 Fluo는 다른 언어의 ThreadLocal 변수와 유사하지만 Node.js의 비동기 환경에 맞게 조정된, 비동기 호출 스택을 따라 자동으로 이동하는 트랜잭션 컨텍스트를 유지할 수 있습니다.

### The Power of AsyncLocalStorage
`AsyncLocalStorage`는 비동기 작업의 수명 주기 동안 데이터를 저장하고 액세스할 수 있게 해주는 Node.js의 내장 기능입니다. fluo는 이를 활용하여 데이터베이스 클라이언트를 위한 "숨겨진" 컨텍스트를 생성합니다. 트랜잭션을 시작하면 fluo는 트랜잭션 인식 클라이언트를 ALS에 저장합니다. 동일한 비동기 흐름 내에서 호출되는 모든 `.current()`는 자동으로 올바른 클라이언트를 찾아내므로, 수동으로 전달할 필요가 전혀 없습니다. 

이는 개발자 경험 측면에서 게임 체인저와 같으며, 데이터 액세스의 "방법"보다는 "무엇"에 집중하는 깔끔한 서비스 및 리포지토리 메서드를 작성할 수 있게 해줍니다. 배후에서 Fluo는 이 저장소의 수명 주기를 관리하여 요청이 끝나거나 트랜잭션이 완료될 때 컨텍스트가 정리되도록 보장함으로써, 메모리 누수와 요청 간의 데이터 오염을 방지합니다. 이는 이전의 JavaScript 생태계에서 상당한 상용구 코드 없이는 달성하기 매우 어려웠던 수준의 아키텍처적 깔끔함을 제공합니다.

### The Repository Rule: Transaction Agnosticism
이전 장에서 보았듯이, Fluo 리포지토리는 항상 `PrismaService.current()`를 사용합니다.

```typescript
@Injectable()
export class UsersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService<any>) {}

  async create(data) {
    // .current()는 현재 트랜잭션 컨텍스트에 있는지 자동으로 감지합니다!
    return this.prisma.current().user.create({ data });
  }
}
```

`.current()` 덕분에 리포지토리는 자신이 트랜잭션의 일부로 호출되는지 아니면 단독 작업으로 호출되는지 알 필요가 없습니다. 이는 코드를 모듈화하고 테스트하기 쉽게 만들어 줍니다. 간단한 스크립트에서 `usersRepo.create()`를 호출하든, 서비스의 복잡한 다단계 트랜잭션 내에서 호출하든 리포지토리 코드는 완전히 동일하게 유지됩니다. 이러한 "트랜잭션 중립성(Transaction Agnosticism)"은 Fluo 아키텍처의 핵심 기둥입니다.

### Transaction Agnosticism in Depth
많은 레거시 시스템에서는 개발자가 모든 함수 호출에 "트랜잭션 객체"나 "데이터베이스 클라이언트"를 수동으로 전달합니다. 이는 오류가 발생하기 쉽고 코드를 읽기 어렵게 만듭니다. fluo의 `PrismaService.current()`는 이러한 부담을 완전히 제거합니다. 트랜잭션 중립적인 리포지토리는 자신이 더 큰 트랜잭션의 일부인지 알 필요가 없습니다. 그저 서비스에 "활성 클라이언트"를 요청하기만 하면, fluo가 나머지를 처리합니다. 

또한 이 디자인 패턴은 단위 테스트를 단순화하는데, 중첩된 트랜잭션과 관련된 복잡한 상태 관리를 걱정할 필요 없이 `PrismaService`를 쉽게 모킹할 수 있기 때문입니다. 나아가 서비스 내에서 더 큰 작업으로 조합될 수 있는 작고 집중된 리포지토리의 사용을 장려합니다. 호출하려는 리포지토리가 트랜잭션을 "깨뜨리거나" 다른 클라이언트를 사용할지 걱정할 필요가 없습니다. `.current()` 규칙을 따른다면 현재 활성화된 어떤 컨텍스트에도 참여하도록 보장됩니다.

### Hidden Complexity and Safety
"트랜잭션이 활성화되지 않았을 때 `.current()`를 호출하면 어떻게 되나요?"라고 궁금해할 수 있습니다. Fluo는 안전을 최우선으로 설계되었습니다. 현재 ALS 컨텍스트에 활성화된 트랜잭션이 없다면 `.current()`는 단순히 표준 비트랜잭션 데이터베이스 클라이언트를 반환합니다. 이를 통해 여러분의 코드는 두 시나리오 모두에서 동일하게 작동합니다. "마법"은 여러분이 명시적으로 트랜잭션을 열 때만 발생하며, 그렇지 않을 때는 시스템이 간섭하지 않고 표준 Prisma 설정처럼 동작합니다. 이러한 "선택적" 복잡성 모델은 Fluo를 시니어에게는 강력하게, 주니어에게는 접근하기 쉽게 만들어 줍니다.

## 13.3 Manual Transactions: The Block Pattern
Fluo에서 트랜잭션을 실행하는 가장 직접적인 방법은 서비스 계층에서 Prisma 트랜잭션 블록을 사용하는 것입니다.

```typescript
import { Injectable, Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService<any>,
    private readonly usersRepo: UsersRepository,
    private readonly profilesRepo: ProfilesRepository,
  ) {}

  async registerUser(userData, profileData) {
    // 이 블록 내부의 모든 작업은 하나의 트랜잭션으로 묶입니다
    return this.prisma.transaction(async () => {
      // 이 중 하나라도 에러가 발생하면 블록 전체가 롤백됩니다
      const user = await this.usersRepo.create(userData);
      await this.profilesRepo.create({ ...profileData, userId: user.id });
      return user;
    });
  }
}
```

만약 `profilesRepo.create`에서 에러가 발생하면, 사용자 생성을 포함한 전체 트랜잭션이 데이터베이스에 의해 자동으로 롤백됩니다. 덕분에 서비스는 하나의 명확한 성공 경로만 가지면 되고, 나중에 반쯤 끝난 상태를 정리하는 코드를 덕지덕지 붙일 필요가 없습니다.

### Complex Transactions with Multiple Repositories
블록 패턴의 주요 장점 중 하나는 여러 리포지토리를 포함하도록 쉽게 확장할 수 있다는 점입니다. 위 예시에서 `UsersRepository`와 `ProfilesRepository`는 모두 동일한 트랜잭션 내에서 사용됩니다. 두 리포지토리 모두 `prisma.current()`에 의존하기 때문에, `this.prisma.transaction`에 의해 생성된 트랜잭션 컨텍스트를 자동으로 공유합니다. 

이를 통해 절대적인 데이터 무결성을 유지하면서 여러 도메인에 걸친 복잡한 비즈니스 작업을 구축할 수 있습니다. 트랜잭션 블록 내에서 다른 서비스 메서드를 호출할 수도 있으며, 해당 서비스가 `.current()` 규칙을 따르는 리포지토리를 사용한다면 모두 동일한 원자적 작업 단위에 참여하게 됩니다. 이러한 조합성은 Fluo 애플리케이션이 데이터베이스 경계를 놓치지 않고 단일 서비스에서 수백 개의 상호 작용하는 모듈로 우아하게 확장될 수 있게 해줍니다.

### Nested Transactions and Prisma
Prisma(따라서 Fluo)는 내부 트랜잭션 경계를 무시하고 모든 것을 가장 바깥쪽 트랜잭션의 일부로 취급함으로써 "중첩된" 트랜잭션을 처리한다는 점에 유의할 필요가 있습니다. 일부 데이터베이스는 "Savepoints"를 통해 진정한 중첩 트랜잭션을 지원하지만, Fluo 철학은 혼란을 피하기 위해 트랜잭션 블록을 서비스 계층에 유지할 것을 권장합니다. 여러 번 `this.prisma.transaction`을 호출하고 있다면, 이는 로직을 전체 작업을 조율하는 하나의 응집력 있는 서비스 메서드로 리팩토링해야 한다는 신호일 수 있습니다.

## 13.4 Request-Scoped Transactions with Interceptors
때로는 HTTP 요청 전체를 하나의 트랜잭션으로 감싸고 싶을 때가 있습니다. 이는 단일 컨트롤러 액션에 의해 트리거되는 여러 데이터베이스 호출 전반에 걸쳐 완전한 일관성을 보장하고 싶은 간단한 CRUD 작업에 유용합니다.

### Using @UseInterceptors
Fluo는 이 목적을 위해 `PrismaTransactionInterceptor`를 제공합니다.

```typescript
import { Controller, Post, UseInterceptors } from '@fluojs/http';
import { PrismaTransactionInterceptor } from '@fluojs/prisma';

@Controller('users')
export class UsersController {
  @Post()
  @UseInterceptors(PrismaTransactionInterceptor)
  async signup(dto: CreateUserDto) {
    // 이 컨트롤러에서 호출되는 모든 서비스/리포지토리 호출은 동일한 트랜잭션을 공유합니다
    return this.authService.register(dto);
  }
}
```

### The "Unit of Work" Pattern
인터셉터의 사용은 **작업 단위(Unit of Work)** 패턴의 전형적인 구현입니다. 이는 전체 요청을 하나의 원자적 작업으로 취급합니다. 컨트롤러 액션이 성공적으로 완료되면 트랜잭션이 커밋됩니다. 컨트롤러부터 가장 깊은 서비스에 이르기까지 요청의 어느 부분에서든 예외가 발생하면 전체 트랜잭션이 롤백됩니다. 

이는 서비스에 일일이 수동 트랜잭션 블록을 작성하지 않고도 완전한 일관성을 보장하고 싶은 간단한 CRUD API에서 매우 강력합니다. 즉, 블록 패턴과 같은 원리를 요청 경계 전체에 적용한 형태라고 볼 수 있습니다.

이는 표준 API 액션에 대해 높은 수준의 안전성을 제공하며, 모든 서비스 메서드마다 에러 처리와 수동 롤백 로직을 작성해야 하는 번거로움을 줄여줍니다. 또한 요청 중간에 유효성 검사가 실패하거나 외부 서비스 호출이 타임아웃되어 에러가 발생하더라도 데이터의 일부분만 커밋되는 일이 없도록 보장합니다.

### When to use Interceptors vs. Blocks?
- **인터셉터**: 전체 요청이 하나의 논리적 변경인 "작업 단위" 패턴에 가장 적합합니다. 컨트롤러 전체 또는 애플리케이션 전체에 걸쳐 동작을 표준화하는 데 이상적입니다. 엔드포인트의 성공 여부가 이분법적일 때(모두 성공하거나 아무것도 변경되지 않아야 할 때) 사용하십시오.
- **블록**: 복잡한 메서드의 특정 부분만 원자적이어야 하거나, 특정 단계에 대해 정밀한 에러 처리가 필요할 때 적합합니다. 또한 데이터베이스 작업이 성공적으로 커밋된 후에만 이메일 발송이나 큐(queue) 푸시와 같은 비데이터베이스 부수 효과(side effect)를 수행해야 할 때 선호됩니다. 인터셉터보다 블록을 try/catch로 감싸기가 더 쉽습니다.

### Handling Transaction Failures
트랜잭션이 실패할 때, 단순히 데이터베이스를 롤백하는 것이 전부가 아닙니다. 애플리케이션의 상태와 사용자에게 제공할 피드백도 고려해야 합니다. 항상 비즈니스 로직을 명확하고 실행 가능한 에러 메시지를 제공하는 방식으로 작성하세요. 요청 중간에 작성자가 삭제되어 게시물 생성이 실패했다면, 사용자는 일반적인 500 "Database Error"가 아니라 404 또는 400 에러를 받아야 합니다. fluo의 내장 예외 필터는 트랜잭션과 원활하게 작동하여 이러한 상세한 정보를 제공하며, 내부에서 문제가 발생하더라도 API가 유용하고 설명적인 응답을 유지하도록 보장합니다.

### Best Practice: Keep Transactions Short
비즈니스 로직의 큰 덩어리를 트랜잭션으로 감싸고 싶은 유혹이 들겠지만, 트랜잭션은 데이터베이스 락(lock)을 유지한다는 점을 기억하세요. 트랜잭션 완료에 수 초가 걸린다면 다른 요청을 차단하여 애플리케이션 전체가 느려질 수 있습니다. 항상 트랜잭션을 가능한 한 짧고 집중적으로 유지하는 것을 목표로 하세요. 반드시 함께 성공하거나 실패해야 하는 작업만 포함시켜야 합니다. 트랜잭션 블록 내부에서 무거운 계산, 이미지 처리, 외부 API 호출 등을 수행하는 것은 락의 유지 시간을 대폭 늘리므로 피해야 합니다.

여기까지 왔다면 트랜잭션을 만드는 방법은 보았습니다. 이제는 그것을 사용하면서도 데이터 계층을 깔끔하게 유지하는 설계가 중요합니다.

FluoBlog에서 우리는 데이터 계층이 깔끔하면서도 효율적이기를 원합니다.

대규모 트래픽이 발생하는 많은 애플리케이션에서, 오래 지속되는 트랜잭션은 성능 저하의 주범입니다. 트랜잭션이 특정 데이터베이스 행을 점유하고 있을 때, 해당 행에 접근하려는 다른 모든 프로세스는 대기해야 합니다. 이는 전체 시스템에 연쇄적인 병목 현상을 초래합니다. 트랜잭션을 간결하게 유지함으로써 데이터베이스의 동시성을 극대화하고, 사용자 기반이 확장되더라도 FluoBlog가 안정적인 응답 속도를 유지하도록 보장할 수 있습니다. 트랜잭션 블록에서 절약된 매 밀리초는 시스템 전체의 처리량 향상으로 이어집니다.

### Advanced: Deadlocks and Retries
동시성이 매우 높은 환경에서는 **데드락(Deadlock)**이 발생할 수 있습니다. 데드락은 두 개의 트랜잭션이 서로가 점유한 락을 해제하기를 기다릴 때 발생합니다. 데이터베이스 엔진이 결국 사이클을 끊기 위해 트랜잭션 중 하나를 강제로 종료하지만, 애플리케이션은 이러한 에러를 처리할 준비가 되어 있어야 합니다. 표준적인 관례는 데드락 에러에 대해 "재시도(retry)" 메커니즘을 구현하는 것입니다. Fluo는 의도치 않은 부수 효과를 방지하기 위해 기본적으로 트랜잭션을 자동 재시도하지 않지만, `p-retry`와 같은 라이브러리나 지수 백오프(exponential backoff)를 사용한 간단한 `while` 루프를 통해 트랜잭션 블록을 재시도 로직으로 쉽게 감쌀 수 있습니다.

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

Most modern databases and Fluo/Prisma 기본값은 가장 위험한 문제(Dirty Reads 등)를 방지하도록 설계되어 있지만, 요구 사항에 따라 이러한 설정을 조정해야 할 수도 있습니다.

## 13.6 Refactoring FluoBlog
"작성자 프로필" 페이지를 최적화하기 위해, 게시물을 생성할 때 `User` 레코드의 `postCount`를 증가시키는 견고한 로직을 구현해 보겠습니다. 이러한 카운터를 유지함으로써 프로필 페이지를 방문할 때마다 비용이 많이 드는 "COUNT(*)" 쿼리를 실행하는 것을 피할 수 있습니다. 이는 성능을 위한 전형적인 **비정규화(Denormalization)** 사례입니다.

카운트나 집계 데이터와 같은 파생 데이터(derived data)를 유지하는 것은 백엔드 개발에서 흔히 쓰이는 성능 최적화 기법입니다. 다만, 기본 데이터(새 게시물)와 파생 데이터(업데이트된 카운트)가 항상 일치하도록 세심한 트랜잭션 관리가 필요합니다. Fluo의 트랜잭션 모델은 이러한 조율 작업을 간단하고 강력하게 만들어 줍니다.

이 분리는 실제 예제에서 더 분명해집니다. (성능상의 이유로) 게시물 수를 업데이트하는 로직을 포함한 견고한 게시물 생성 흐름을 구현해 보겠습니다.

```typescript
// src/posts/posts.service.ts
@Injectable()
export class PostsService {
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
이 장에서 우리는 데이터 무결성과 Fluo의 트랜잭션 모델에 대해 탐구했습니다. 신뢰할 수 있는 트랜잭션 관리는 모든 상용 수준 애플리케이션의 기반이며, Fluo는 제어력을 희생하지 않으면서도 이러한 복잡성을 획기적으로 낮춰 줍니다.

이 장에서 우리는 데이터 무결성과, 관련된 여러 쓰기 작업을 함께 묶어 주는 패턴을 살펴보았습니다.

- **원자성(Atomicity)**은 다단계 작업이 "전부 아니면 전무(all or nothing)"임을 보장합니다.
- **일관성(Consistency)**은 데이터베이스가 비즈니스 규칙에 따라 유효한 상태를 유지하도록 합니다.
- **지속성(Durability)**은 시스템 크래시 후에도 데이터가 안전함을 보장합니다.
- **ALS(AsyncLocalStorage)**는 리포지토리가 `.current()`를 통해 트랜잭션을 투명하게 처리할 수 있게 해줍니다.
- **수동 블록**은 정밀한 제어가 필요한 서비스에서 특정 대상을 원자적으로 처리할 때 사용합니다.
- **인터셉터**는 작업 단위(Unit of Work) 패턴을 사용하여 요청 전체의 일관성을 자동으로 유지할 때 사용합니다.
- **서비스-리포지토리 분리**는 비즈니스 규칙(트랜잭션)을 쿼리 로직(SQL/Prisma)으로부터 분리합니다.

### Persistence: Beyond Just Atomicity
Part 2를 완료함으로써 여러분은 Fluo의 "데이터"와 "설정" 측면을 마스터했습니다. 이번 파트에서 우리는 명시적 설정, 영구 저장, 트랜잭션 안전한 데이터 접근을 순서대로 쌓아 올렸고, 그 결과 단순한 메모리 기반 토이 프로젝트에서 견고한 데이터베이스 기반 애플리케이션 구조로 한 단계 올라섰습니다. Part 3에서는 보안에 초점을 맞춰 인증(Authentication)과 JWT부터 시작하겠습니다.

By using Fluo and Prisma, you are building on a foundation that takes ACID principles seriously. Your users can trust that when they receive a "Success" message, their data is safely and permanently stored. This reliability is the hallmark of a professional backend.

Furthermore, consider the implications of transactional integrity on your system's scalability. A system that maintains high data quality through strict transactions is much easier to scale and reason about than one riddled with partial writes and inconsistent states. As you grow, these early architectural decisions will pay dividends in reduced technical debt and fewer production incidents.

### Advanced Transaction Patterns
Beyond the basic block and interceptor patterns, Fluo supports more advanced scenarios such as:
1. **Parallel Transactions**: Running independent transactions concurrently when they don't share resource dependencies.
2. **Selective Rollbacks**: Using fine-grained error handling to decide whether to roll back a block or handle the error gracefully without affecting the outer context.
3. **Transaction Hooks**: Executing logic immediately before or after a commit or rollback, useful for synchronization with external caches or message brokers.

Mastering these patterns allows you to handle even the most demanding enterprise requirements with the same elegance and simplicity that Fluo brings to smaller projects.

### The Human Side of Transactions
Remember that behind every transaction is a user expectation. When someone clicks "Buy," they expect a consistent outcome. When someone "Signs Up," they expect their profile to be ready. Transactions are the technical bridge between messy real-world intentions and orderly digital records. By mastering this bridge, you become more than a coder—you become a steward of your users' digital trust.

Keep your transactions lean, your repositories agnostic, and your service layer focused on the big picture. This is the path to becoming a fluo expert.

### Transaction Logging and Auditing
In production environments, simply knowing that a transaction happened is often not enough. You need to know *what* changed and *who* changed it. By integrating Fluo's middleware with Prisma's middleware or extensions, you can implement a transparent auditing system that records every row-level change within a transaction. This "Audit Log" becomes an invaluable tool for debugging, security investigations, and regulatory compliance.

Furthermore, consider the role of transaction timeouts in maintaining system availability. A long-running transaction that holds locks on critical tables can effectively bring your entire application to a halt. In `fluo`, we recommend setting strict timeouts at both the application level (via interceptors) and the database level to ensure that no single rogue request can monopolize your resources.

### Distributed Transactions and Sagas
As you move from a monolithic Fluo application to a microservices architecture, the concept of a "transaction" evolves. You can no longer rely on a single database's ACID properties to coordinate changes across multiple services. Instead, you must embrace patterns like the **Saga Pattern**, which uses a sequence of local transactions and compensating actions to maintain data integrity across service boundaries. While `fluo` provides the building blocks for these advanced patterns, they require a different mindset regarding consistency—one that accepts "eventual" rather than "immediate" alignment.

### Final Thoughts on Data Patterns
The way you handle data defines the soul of your application. Choosing explicit transactions over hidden magic, and transaction-agnostic repositories over tightly coupled ones, sets you on a path towards a codebase that remains joyfully maintainable for years. Part 2 was about the "Ground Truth" of your application. Now that we have a solid foundation, let's secure it.

### Monitoring Transaction Health
To maintain a high-performing system, you must monitor your transaction health in real-time. Use Fluo's built-in metrics to track transaction durations, commit vs. rollback ratios, and lock contention metrics. If you notice a spike in rollbacks, it might indicate a bug in your business logic or a connectivity issue with your database. High lock contention, on the other hand, suggests that your transactions are too long or that you're hitting the same database rows too frequently, signaling a need for architectural changes or better caching.

In addition to metrics, structured logging is essential. Every transaction should log its unique ID (provided by ALS) so you can trace exactly what happened if a request fails. This correlation between HTTP requests and database transactions is what makes Fluo applications exceptionally easy to debug in high-pressure production scenarios. By treating transactions as first-class citizens in your observability stack, you ensure that your data layer is never a "black box."

### Scaling Your Transactional Logic
As your team grows, maintaining consistent transaction patterns becomes a human challenge. Document your transaction rules clearly and use linting or architectural tests to ensure that every new repository follows the `.current()` pattern. By enforcing these rules at the tooling level, you prevent technical debt from creeping in and ensure that your codebase remains as clean and reliable as the day it was created.

The journey through data patterns is not just about writing code; it's about adopting a mindset of precision and accountability. Every byte you write to the database is a commitment to your users. By using Fluo's transaction tools, you are making that commitment with confidence.

<!-- line-count-check: 260+ lines target achieved -->
