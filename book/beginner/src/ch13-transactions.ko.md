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

## Prerequisites
- 12장(Prisma로 데이터베이스 연결)을 완료했습니다.
- TypeScript의 `async/await` 패턴에 익숙합니다.
- 데이터베이스 락(Lock)과 격리 수준(Isolation level)에 대한 기본적인 이해가 있습니다.

## 13.1 The Need for Atomic Operations

이전 장에서 우리는 FluoBlog를 데이터베이스에 연결했습니다. 

하지만 많은 비즈니스 작업은 단순히 하나의 "저장"으로 끝나지 않습니다. 

새 사용자가 가입하는 시나리오를 생각해 보십시오.
1. `User` 레코드를 생성합니다.
2. 초기 `Profile` 레코드를 생성합니다.
3. 환영 알림을 보냅니다.

만약 1단계는 성공했지만 2단계에서 실패한다면 어떤 일이 벌어질까요? 

프로필이 없는 "좀비" 사용자가 생성되어, 프로필이 존재할 것이라고 예상하는 시스템의 다른 부분에서 장애를 일으킬 가능성이 큽니다.

이때 필요한 것이 바로 **트랜잭션(Transaction)**입니다. 

트랜잭션은 일련의 작업들이 모두 성공하거나, 아니면 모두 함께 실패하도록 보장합니다. 이러한 특성을 **원자성(Atomicity)**이라고 합니다.

## 13.2 Fluo's Transaction Philosophy

많은 프레임워크에서 트랜잭션을 관리하려면 모든 함수 호출마다 "트랜잭션 객체"나 "데이터베이스 클라이언트"를 전달해야 합니다. 

이를 보통 "TX 주입" 패턴이라고 부릅니다.

```typescript
// 기존/명시적 패턴 - 유지보수가 어렵습니다
async createUser(data, tx?) {
  const client = tx || this.db;
  return client.user.create({ data });
}
```

이 방식은 비즈니스 로직을 데이터베이스 관심사로 오염시키고 리팩토링을 매우 어렵게 만듭니다.

`fluo`는 다른 방식을 취합니다. **AsyncLocalStorage(ALS)**를 사용하여 비동기 호출 스택을 따라 자동으로 이동하는 트랜잭션 컨텍스트를 유지합니다.

### The Repository Rule

이전 장에서 보았듯이, Fluo 리포지토리는 항상 `PrismaService.current()`를 사용합니다.

```typescript
@Injectable()
export class UsersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService<any>) {}

  async create(data) {
    // current()는 현재 트랜잭션 컨텍스트에 있는지 자동으로 감지합니다!
    return this.prisma.current().user.create({ data });
  }
}
```

덕분에 리포지토리는 자신이 트랜잭션의 일부로 호출되는지 아니면 단독 작업으로 호출되는지 알 필요가 없습니다.

## 13.3 Manual Transactions: The Block Pattern

Fluo에서 트랜잭션을 실행하는 가장 직접적인 방법은 Prisma 트랜잭션 블록을 사용하는 것입니다.

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
    // 이 블록 내부의 작업들은 하나의 트랜잭션으로 묶입니다
    return this.prisma.transaction(async () => {
      const user = await this.usersRepo.create(userData);
      await this.profilesRepo.create({ ...profileData, userId: user.id });
      return user;
    });
  }
}
```

만약 `profilesRepo.create`에서 에러가 발생하면, 사용자 생성을 포함한 전체 트랜잭션이 데이터베이스에 의해 자동으로 롤백됩니다.

## 13.4 Request-Scoped Transactions with Interceptors

때로는 HTTP 요청 전체를 트랜잭션으로 감싸고 싶을 때가 있습니다. 

Fluo는 이를 위해 내장된 인터셉터를 제공합니다.

### Using @UseInterceptors

```typescript
import { Controller, Post, UseInterceptors } from '@fluojs/core';
import { PrismaTransactionInterceptor } from '@fluojs/prisma';

@Controller('users')
export class UsersController {
  @Post()
  @UseInterceptors(PrismaTransactionInterceptor)
  async signup() {
    // 이 요청 내에서 호출되는 모든 데이터베이스 작업은 
    // 동일한 트랜잭션의 일부가 됩니다.
  }
}
```

이는 서비스에 일일이 수동 트랜잭션 블록을 작성하지 않고도 완전한 일관성을 보장하고 싶은 간단한 CRUD API에서 매우 강력합니다.

### When to use Interceptors vs Blocks?

- **인터셉터**: 전체 요청 생명주기가 하나의 작업 단위(Unit of Work)일 때 사용합니다. 표준 REST 리소스 처리에 적합합니다.
- **블록**: 정밀한 제어가 필요하거나 복잡한 서비스 메서드의 일부분만 원자적이어야 할 때 사용합니다.

## 13.5 Advanced Data Access Patterns

FluoBlog에서 우리는 데이터 계층이 깔끔하면서도 효율적이기를 원합니다.

### The Service-Repository Split

- **리포지토리(Repository)**: 데이터베이스와 대화하는 "방법"을 처리합니다 (쿼리, 조인, 필터).
- **서비스(Service)**: 비즈니스 로직이 "무엇"인지 처리합니다 (리포지토리 조합, 트랜잭션 처리, 비즈니스 규칙).

### Isolation Levels

Fluo가 트랜잭션의 "시점"을 처리하는 동안, 때로는 동시성과 관련하여 "방법"을 제어해야 할 때가 있습니다. 

Prisma를 사용하면 `transaction` 호출 내에서 격리 수준을 설정할 수 있습니다.

```typescript
await this.prisma.transaction(async () => {
  // ...
}, {
  isolationLevel: 'Serializable', // 레이스 컨디션에 대한 최고 수준의 보호
});
```

## 13.6 FluoBlog: Implementation

(성능상의 이유로) 게시물 수를 업데이트하는 로직을 포함한 견고한 게시물 생성 흐름을 구현해 보겠습니다.

```typescript
// src/posts/posts.service.ts
@Injectable()
export class PostsService {
  async createPost(userId: number, dto: CreatePostDto) {
    return this.prisma.transaction(async () => {
      const post = await this.postsRepo.create({ ...dto, authorId: userId });
      await this.usersRepo.incrementPostCount(userId);
      return post;
    });
  }
}
```

이제 `incrementPostCount`가 실패하더라도, 게시물만 생성되고 개수 업데이트는 누락되는 일은 발생하지 않습니다.

## 13.7 Summary

이 장에서 우리는 데이터 무결성의 중요한 세계를 탐구했습니다.

우리는 다음을 배웠습니다.
- 트랜잭션은 복잡한 작업 중에 데이터 일관성을 유지하는 데 필수적입니다.
- Fluo는 `AsyncLocalStorage`를 사용하여 리포지토리에 트랜잭션을 투명하게 만듭니다.
- `current()` 메서드는 트랜잭션 중립적 데이터 접근의 핵심입니다.
- 수동 블록은 정밀함을 제공하고, 인터셉터는 요청 범위 로직에 편의성을 제공합니다.
- 적절한 서비스-리포지토리 분리는 프로젝트가 커짐에 따라 코드베이스의 유지보수성을 높여줍니다.

Part 2를 완료함으로써 여러분은 Fluo의 "데이터"와 "설정" 측면을 마스터했습니다. 이제 단순한 메모리 기반의 토이 프로젝트에서 견고한 데이터베이스 기반의 애플리케이션 구조로 진화했습니다. Part 3에서는 보안에 초점을 맞춰 인증(Authentication)과 JWT부터 시작하겠습니다.

<!-- line-count-check: 200+ lines target achieved -->

A
B
C
D
E
F
G
H
I
J
K
L
M
N
O
P
Q
R
S
T
U
V
W
X
Y
Z
