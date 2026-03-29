# @konekti/prisma

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Prisma를 Konekti의 라이프사이클과 트랜잭션 모델에 연결합니다 — Prisma 자체는 숨기지 않고요.

## 관련 문서

- `../../docs/concepts/transactions.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`

## 이 패키지가 하는 일

`@konekti/prisma`는 Prisma 클라이언트를 Konekti 모듈 시스템에 연결하는 얇은 통합 레이어입니다. 커넥션 라이프사이클(`$connect` / `$disconnect`)을 자동으로 처리하고, ALS(AsyncLocalStorage) 기반의 요청 범위 트랜잭션 컨텍스트를 제공하며, `current()` 메서드를 통해 항상 현재 활성화된 트랜잭션 클라이언트 또는 루트 클라이언트를 반환하는 `PrismaService`를 노출합니다. 덕분에 리포지토리는 어떤 클라이언트와 통신하는지 신경 쓸 필요가 없습니다.

이 패키지는 Prisma를 추상화하지 **않습니다**. Prisma를 Konekti의 일급 시민으로 만들어 줄 뿐입니다.

## 설치

```bash
npm install @konekti/prisma
# 이 패키지와 함께 직접 생성한 Prisma 클라이언트를 설치하세요
npm install @prisma/client
```

## 빠른 시작

### 1. 모듈 등록

```typescript
import { createPrismaModule } from '@konekti/prisma';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 루트 모듈 정의에서:
const AppModule = createPrismaModule({ client: prisma });
```

### 2. 리포지토리에서 `PrismaService` 사용

```typescript
import { PrismaClient } from '@prisma/client';
import { Inject } from '@konekti/core';
import { PrismaService } from '@konekti/prisma';

@Inject([PrismaService])
export class UserRepository {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>
  ) {}

  async findById(id: string) {
    // current()는 트랜잭션 안에 있으면 tx 클라이언트를,
    // 아니면 루트 PrismaClient를 반환합니다
    return this.prisma.current().user.findUnique({ where: { id } });
  }
}
```

### 3. 서비스 메서드를 트랜잭션으로 감싸기

```typescript
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '@konekti/prisma';

export class UserService {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async createWithProfile(data: CreateUserDto) {
    return this.prisma.transaction(async () => {
      const user = await this.prisma.current().user.create({ data });
      await this.prisma.current().profile.create({
        data: { userId: user.id },
      });
      return user;
    });
  }
}
```

### 4. 요청 수준 자동 트랜잭션을 위한 인터셉터 적용

```typescript
import { UseInterceptors } from '@konekti/http';
import { PrismaTransactionInterceptor } from '@konekti/prisma';

@UseInterceptors(PrismaTransactionInterceptor)
class UserController {}
```

## 핵심 API

### `PrismaService<TClient>`

| 메서드 | 시그니처 | 설명 |
|---|---|---|
| `current()` | `() => TClient \| TTransactionClient` | 활성 트랜잭션 클라이언트(ALS에서)를 반환하거나, 트랜잭션이 없으면 루트 클라이언트를 반환 |
| `transaction()` | `(fn: () => Promise<T>) => Promise<T>` | Prisma 인터랙티브 트랜잭션 안에서 `fn`을 실행하고, tx 클라이언트를 ALS에 저장 |
| `requestTransaction()` | `(fn: () => Promise<T>, signal?: AbortSignal) => Promise<T>` | `transaction()`과 동일하나, 인터셉터가 요청 경계에서 사용하도록 설계됨 |

### `PRISMA_CLIENT`

DI 토큰(`src/tokens.ts`). 원시 `PrismaClient` 인스턴스를 직접 주입받고 싶을 때 사용합니다.

```typescript
import { Inject } from '@konekti/core';
import { PRISMA_CLIENT } from '@konekti/prisma';

@Inject([PRISMA_CLIENT])
class RawClientConsumer {
  constructor(private readonly client: PrismaClient) {}
}
```

### `createPrismaProviders(options)`

DI 프로바이더 배열을 반환합니다. `createPrismaModule` 대신 프로바이더를 수동으로 구성할 때 사용합니다.

```typescript
import { createPrismaProviders } from '@konekti/prisma';

const providers = createPrismaProviders({ client: prisma });
```

### `createPrismaModule(options)`

`createPrismaProviders`를 호출하고 결과를 Konekti 모듈 정의로 감싸는 편의 함수입니다.

`PrismaModuleOptions`는 `strictTransactions?: boolean`도 지원하며, public package는 `PRISMA_OPTIONS`, `PrismaTransactionClient`, `PrismaModuleOptions`, `PrismaHandleProvider`도 export합니다.

### `PrismaTransactionInterceptor`

HTTP 인터셉터(`src/transaction.ts`). 각 요청을 `prismaService.requestTransaction()`으로 감쌉니다. 요청 내에서 호출되는 모든 핸들러와 리포지토리가 동일한 Prisma 트랜잭션 클라이언트를 자동으로 공유합니다.

### `PrismaClientLike`

`PrismaService`가 제네릭으로 받는 seam 인터페이스입니다. `$connect`, `$disconnect`, `$transaction`만 요구하므로, 전체 `PrismaClient` 대신 최소한의 테스트 스텁으로 대체할 수 있습니다.

```typescript
interface PrismaClientLike {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}
```

## 구조

```
HTTP 요청
    │
    ▼
PrismaTransactionInterceptor
    │  requestTransaction() 열기
    ▼
AsyncLocalStorage (ALS)
    │  요청 범위로 tx 클라이언트 저장
    ▼
PrismaService.current()
    │  ALS에서 읽기 → tx 클라이언트 반환 (없으면 루트 클라이언트)
    ▼
리포지토리 / 핸들러
    │  prisma.current().model.operation() 호출
    ▼
Prisma Client
```

**라이프사이클 훅:**
- `OnModuleInit` → `$connect()` — Konekti 모듈이 초기화될 때 호출
- `OnApplicationShutdown` → `$disconnect()` — 그레이스풀 셧다운 시 호출

## 파일 읽기 순서 (기여자용)

약 15분 안에 전체 패키지를 파악하려면 다음 순서로 읽으세요:

1. `src/tokens.ts` — 단일 `PRISMA_CLIENT` 토큰; DI 주입 키가 어떻게 설정되는지 이해
2. `src/types.ts` — `PrismaClientLike` seam; 최소 계약(contract) 확인
3. `src/service.ts` — `PrismaService`: `current()`, `transaction()`, `requestTransaction()`, ALS 사용 방식
4. `src/transaction.ts` — `PrismaTransactionInterceptor`: 트랜잭션을 여는 요청 경계
5. `src/module.ts` — `createPrismaProviders()`와 `createPrismaModule()`: 모든 것이 어떻게 연결되는지
6. `src/vertical-slice.test.ts` — 통합 테스트: DTO → 검증 → 서비스 → 리포지토리 → Prisma 경로; 표준 201 / 400 / 404 계약

## 관련 패키지

| 패키지 | 관계 |
|---|---|
| `@konekti/runtime` | `PrismaService`가 구현하는 라이프사이클 훅(`OnModuleInit`, `OnApplicationShutdown`) |
| `@konekti/di` | `PrismaService`와 `PRISMA_CLIENT`를 resolve하는 DI 컨테이너 |
| `@konekti/http` | `PrismaTransactionInterceptor`가 연결되는 인터셉터 시스템 |
| `@konekti/testing` | `overrideProvider(PRISMA_CLIENT, fakePrisma)`로 테스트 더블 주입 |
| `@konekti/dto-validator` | vertical slice에서 서비스 레이어에 도달하기 전에 요청 DTO를 검증 |

## 한 줄 mental model

> `@konekti/prisma` = Prisma를 숨기지 않고, Konekti lifecycle/transaction 모델에 자연스럽게 꽂아 주는 integration baseline — `current()`는 요청 트랜잭션 안이든 밖이든 항상 올바른 클라이언트를 돌려줍니다.
