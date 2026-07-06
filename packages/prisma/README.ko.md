# @fluojs/prisma

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 애플리케이션을 위한 Node.js 20+ Prisma lifecycle 및 ALS 기반 transaction context입니다. `PrismaClient`를 모듈 시스템에 연결하고 자동 연결 관리와 요청 범위 트랜잭션을 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [공통 패턴](#공통-패턴)
  - [서비스 트랜잭션 경계 (@Transaction)](#서비스-트랜잭션-경계-transaction)
  - [여러 클라이언트를 위한 이름 있는 등록](#여러-클라이언트를-위한-이름-있는-등록)
  - [수동 트랜잭션과 current()](#수동-트랜잭션과-current)
  - [종료와 status 계약](#종료와-status-계약)
  - [비동기 설정과 격리](#비동기-설정과-격리)
  - [수동 모듈 조합](#수동-모듈-조합)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/prisma
# @prisma/client도 함께 설치되어 있어야 합니다.
pnpm add @prisma/client
```

## 사용 시점

- Node.js 20+에서 Prisma를 ORM으로 사용하면서 fluo의 의존성 주입 및 라이프사이클 훅과 통합하고 싶을 때.
- 여러 서비스와 리포지토리 사이에서 `tx` 객체를 일일이 전달하지 않고도 트랜잭션 컨텍스트를 안정적으로 공유하고 싶을 때.
- 애플리케이션 시작 시 자동 `$connect`, 종료 시 자동 `$disconnect`가 필요할 때.

## 빠른 시작

루트 모듈에 `PrismaClient` 인스턴스를 전달하여 `PrismaModule`을 등록합니다.

```typescript
import { Module } from '@fluojs/core';
import { PrismaModule } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Module({
  imports: [
    PrismaModule.forRoot({ client: prisma }),
  ],
})
class AppModule {}
```

## 공통 패턴

### 서비스 트랜잭션 경계 (@Transaction)

`@Transaction()` 데코레이터는 서비스 레이어에서 트랜잭션 경계를 정의하는 권장 방법입니다. 이 데코레이터가 적용된 메서드 내부에서 발생하는 모든 리포지토리 호출은 동일한 Prisma 트랜잭션을 공유합니다.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService, Transaction, type PrismaServiceFacade } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';
import { UserRepository } from './user.repository';

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  @Transaction()
  async onboardUser(dto: CreateUserDto) {
    const user = await this.repo.create(dto);
    await this.repo.initProfile(user.id);
    return user;
  }
}

@Inject(PrismaService)
export class UserRepository {
  constructor(private readonly prisma: PrismaServiceFacade<PrismaClient>) {}

  async create(data: any) {
    // facade 타입은 표준 PrismaClient delegate를 노출합니다.
    // @Transaction() 내부에서 호출되면 자동으로 활성 트랜잭션에 참여합니다.
    return this.prisma.user.create({ data });
  }

  async initProfile(userId: string) {
    return this.prisma.profile.create({ data: { userId } });
  }
}
```

`@Transaction()` 메서드 호출은 재진입(reentrant)이 가능합니다. 데코레이터가 적용된 메서드가 다른 데코레이터 적용 메서드를 호출하더라도 하나의 동일한 Prisma 트랜잭션 안에서 실행됩니다.

### 여러 클라이언트를 위한 이름 있는 등록

하나의 애플리케이션 컨테이너 안에서 여러 Prisma Client가 필요하다면 각 등록에 명시적인 `name`을 부여하고 `getPrismaServiceToken(name)`으로 대응되는 토큰을 주입하세요. 이름 있는 클라이언트를 사용할 때는 `@Transaction()`에 해당 서비스로 접근할 수 있는 accessor를 전달하세요. 기본 `@Transaction()` 해석은 Prisma service/facade 형태의 속성만 선택합니다. 다른 persistence 통합의 transaction-like 객체는 무시되므로 모호한 host에서는 명시적 accessor를 사용해야 합니다.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaModule, PrismaService, getPrismaServiceToken, Transaction, type PrismaServiceFacade } from '@fluojs/prisma';

const usersPrismaModule = PrismaModule.forRoot({ name: 'users', client: usersPrisma });
const analyticsPrismaModule = PrismaModule.forRoot({ name: 'analytics', client: analyticsPrisma });

@Inject(getPrismaServiceToken('users'), getPrismaServiceToken('analytics'))
export class MultiDatabaseService {
  constructor(
    private readonly users: PrismaServiceFacade<typeof usersPrisma>,
    private readonly analytics: PrismaServiceFacade<typeof analyticsPrisma>,
  ) {}

  @Transaction((self) => self.users)
  async updateAndLog(userId: string, data: any) {
    const user = await this.users.user.update({ where: { id: userId }, data });
    // 이 호출은 'analytics'가 별도로 트랜잭션을 열지 않는 한 'users' 트랜잭션 밖에 있습니다.
    await this.analytics.report.create({ data: { event: 'update', userId } });
    return user;
  }
}
```

### 수동 트랜잭션과 current()

`PrismaService`는 트랜잭션 범위 내에 있으면 자동으로 트랜잭션용 클라이언트를, 그렇지 않으면 루트 클라이언트를 반환하는 `current()` 메서드를 제공합니다. 외부 라이브러리에 클라이언트를 전달하거나 복잡한 수동 트랜잭션 처리가 필요한 경우 escape hatch로 사용하세요.

```typescript
import { Inject } from '@fluojs/core';
import { PrismaService } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

@Inject(PrismaService)
export class AdvancedRepository {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async customOperation() {
    const tx = this.prisma.current();
    // fluo가 자동으로 감싸지 않는 작업을 수행하거나, 
    // PrismaClient를 직접 기대하는 외부 유틸리티에 전달할 때 tx를 사용하세요.
    return tx.user.findMany();
  }
}
```

수동 대화형 트랜잭션 블록에는 `prisma.transaction()`을 사용하세요:

```typescript
await this.prisma.transaction(async () => {
  const tx = this.prisma.current();
  const user = await tx.user.create({ data });
  await tx.profile.create({ data: { userId: user.id } });
});
```

이미 활성 트랜잭션 컨텍스트가 있는 상태에서 `transaction()`을 호출하면 `PrismaService`는 중첩 Prisma 트랜잭션을 새로 열지 않고 활성 트랜잭션 클라이언트를 재사용합니다. 중첩 호출에는 isolation level 같은 트랜잭션 옵션을 전달하면 안 됩니다. 활성 컨텍스트에서 옵션을 제공하면 ambient transaction을 재사용하는 동안 호출자의 의도를 조용히 버리지 않도록 예외로 거부합니다.

### 종료와 status 계약

`PrismaService.requestTransaction(...)`은 정상 serving 전과 중에는 사용할 수 있지만, 애플리케이션 shutdown이 시작된 뒤에는 새 요청 범위 트랜잭션을 거부합니다. 새 outer 수동 `transaction(...)` 및 서비스 `@Transaction()` boundary도 shutdown 시작 후에는 거부됩니다. 이미 열린 boundary는 `$disconnect()` 전에 drain되므로 shutdown이 활성 Prisma transaction과 경합하지 않습니다. 종료 중에는 열린 요청 트랜잭션을 abort하고, 가장 바깥 transaction boundary가 settle될 때까지 추적한 다음 `$disconnect()` 실행 전에 drain합니다. 기존 수동 `transaction(...)` boundary 안에서 열린 중첩 `requestTransaction(...)` 호출도 동일합니다. 해당 호출은 ambient Prisma transaction client를 재사용하고, 바깥 boundary가 끝날 때까지 `details.activeRequestTransactions`에 표시되며, 두 번째 Prisma transaction을 열지 않습니다.

`createPrismaPlatformStatusSnapshot(...)`와 `PrismaService.createPlatformStatusSnapshot()`은 같은 라이프사이클 계약을 진단 surface에 노출합니다.

- `readiness.status`는 `onModuleInit()`이 클라이언트를 연결하기 전, Prisma가 종료 중이거나 stopped 상태일 때, 그리고 `strictTransactions`가 켜져 있는데 `$transaction(...)`을 지원하지 않을 때 `not-ready`입니다.
- `health.status`는 종료 중 요청 트랜잭션을 drain하는 동안 `degraded`, disconnect 이후 `unhealthy`입니다.
- `details.activeRequestTransactions`, `details.lifecycleState`, `details.strictTransactions`, `details.supportsTransaction`, `details.transactionAbortSignalSupport`는 현재 요청 트랜잭션과 트랜잭션 capability 상태를 설명합니다.
- `details.transactionContext: 'als'`는 요청 및 서비스 트랜잭션 경계가 사용하는 async-local transaction context를 식별합니다.
- `ownership.externallyManaged: false`와 `ownership.ownsResources: true`는 패키지가 fluo 애플리케이션 라이프사이클 안에서 등록된 클라이언트의 `$connect()` / `$disconnect()` lifecycle hook을 소유한다는 의미입니다.

### 비동기 설정과 격리

주입된 설정이나 다른 비동기 소스에서 Prisma 클라이언트를 만들어야 할 때는 `PrismaModule.forRootAsync(...)`를 사용하세요. 비동기 factory는 애플리케이션 컨테이너마다 한 번 resolve되며, 테스트나 여러 앱을 띄우는 프로세스에서 같은 모듈 정의를 재사용하더라도 별도 bootstrap 사이에서 공유되지 않습니다.

```typescript
import { PrismaClient } from '@prisma/client';
import { PrismaModule } from '@fluojs/prisma';

PrismaModule.forRootAsync({
  inject: [DatabaseConfig],
  useFactory: (config: DatabaseConfig) => ({
    client: new PrismaClient({ datasources: { db: { url: config.url } } }),
    strictTransactions: true,
  }),
});
```

하나의 컴파일된 애플리케이션 안에서는 하위 provider가 동일하게 resolve된 `PrismaService`, ALS 트랜잭션 컨텍스트, 라이프사이클 관리 대상 클라이언트를 공유합니다. 서로 다른 애플리케이션 컨테이너는 독립된 factory 결과를 받으므로 `$connect` / `$disconnect` 소유권과 요청 트랜잭션 상태가 격리됩니다.

트랜잭션 경계에는 호스트가 제공하는 `AsyncLocalStorage` 지원이 필요합니다. 패키지 manifest는 `engines.node >=20.0.0`을 선언하며, root wrapper는 문서화된 Node.js 20+ Prisma 통합 경로입니다. `@fluojs/prisma`는 런타임이 노출하는 `globalThis.AsyncLocalStorage` 또는 Node.js의 `process.getBuiltinModule('node:async_hooks')` 호스트 경계를 통해 ALS를 resolve합니다. 두 경로 모두 사용할 수 없거나 host builtin lookup이 실패하면 동기 stack fallback으로 async boundary 사이의 `current()`를 잃는 대신, Prisma 트랜잭션을 열기 전에 `transaction()`과 `requestTransaction()`이 예외를 던집니다. 이 상태는 `createPlatformStatusSnapshot().details.transactionContext`에 `unavailable`로 보고됩니다.

### 수동 모듈 조합

`PrismaModule.forRoot(...)` / `forRootAsync(...)`를 사용해 Prisma를 등록합니다. 커스텀 `defineModule(...)` 등록 안에서 Prisma 지원을 조합해야 할 때도 동일한 모듈 entrypoint를 import해서 사용하세요.

```typescript
import { defineModule } from '@fluojs/runtime';
import { PrismaModule } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class ManualPrismaModule {}

defineModule(ManualPrismaModule, {
  imports: [PrismaModule.forRoot({ client: prisma })],
});
```

## 공개 API 개요

### `PrismaModule`

- `PrismaModule.forRoot(options)` / `PrismaModule.forRootAsync(options)`
- `forRoot(...)`와 `forRootAsync(...)`도 이름 있는/scoped 등록을 위해 `name`을 받을 수 있으며, 이름 없는 등록을 전역 provider로 export해야 할 때 `global?: boolean`을 받을 수 있습니다.
- `forRootAsync(...)`는 client와 transaction 설정을 factory에서 반환하는 DI-aware Prisma 옵션을 받습니다. 모듈 identity와 visibility가 factory 실행 전에 결정되도록 `name` 또는 `global`은 최상위 async 등록 옵션에 전달하세요.
- `forRootAsync(...)`는 애플리케이션 컨테이너마다 옵션을 한 번 resolve하여, 별도 bootstrap 사이에서 클라이언트 라이프사이클과 요청 트랜잭션 격리를 보존합니다.
- `strictTransactions: true` 설정 시 트랜잭션 미지원 환경에서 즉시 예외를 발생시킵니다.
- `strictTransactions`가 `false`이면 클라이언트가 interactive `$transaction`을 제공하지 않을 때 직접 실행으로 fallback합니다.
- sync 및 async 등록 모두에서 `client`는 실제 object/function handle이어야 하며, 누락된 handle은 모듈 등록 또는 async bootstrap 중 거부됩니다.
- 이름 있는 등록의 `name`은 public token 생성 전에 trim되며, 빈 이름은 거부됩니다.

### `PrismaService<TClient>`

- `current(): TClient | PrismaTransactionClient<TClient>`
  - 현재 컨텍스트에 맞는 트랜잭션 클라이언트 또는 루트 클라이언트를 반환합니다.
- `transaction(fn, options?): Promise<T>`
  - 대화형 트랜잭션 내에서 함수를 실행합니다. 이미 트랜잭션 컨텍스트가 활성화되어 있으면 callback은 그 컨텍스트를 재사용하며, 새 Prisma 트랜잭션 경계가 열리지 않기 때문에 중첩 트랜잭션 옵션은 거부됩니다. shutdown이 시작된 뒤에는 새 outer transaction boundary를 거부합니다.
- `requestTransaction(fn, signal?, options?): Promise<T>`
  - HTTP 요청 라이프사이클에 특화된 트랜잭션 경계를 실행합니다. Abort를 인식하고, shutdown 중에는 disconnect 전에 열린 요청 트랜잭션을 drain하며, Prisma client가 `signal` 옵션을 거부하면 해당 옵션 없이 재시도합니다. `transaction()`과 마찬가지로 중첩 호출은 활성 트랜잭션 컨텍스트를 재사용하고, 트랜잭션 설정을 조용히 무시하지 않도록 중첩 옵션을 거부합니다.

Provider가 `current()`, `transaction(...)`, `requestTransaction(...)`, `createPlatformStatusSnapshot()` 같은 wrapper 메서드만 필요로 한다면 `PrismaService<TClient>`를 사용하세요. 생성된 Prisma Client delegate를 직접 호출하는 repository 주입에는 `PrismaServiceFacade<TClient>`를 사용하세요. 이 facade는 활성 트랜잭션이 있으면 해당 트랜잭션 client로, 없으면 root client로 호출을 전달합니다. `PrismaService.createFacade(...)`는 module-provider wiring을 위한 저수준 compatibility helper로 유지되며, 애플리케이션 코드는 `PrismaModule.forRoot(...)` / `forRootAsync(...)`를 우선 사용해야 합니다.

### `Transaction`

- 서비스 계층 트랜잭션 경계를 위한 표준 TC39 method decorator입니다. 기본적으로 Prisma service/facade 형태의 속성을 resolve하고, 이름 있는 client나 모호한 host에는 accessor를 받을 수 있으며, 외부 경계에는 Prisma transaction option을 전달할 수 있습니다.

### `PRISMA_CLIENT` (Token)

원시 `PrismaClient` 인스턴스를 위한 주입 토큰입니다.

### `PRISMA_OPTIONS` (Token)

`PrismaService`가 소비하는 공개 런타임 옵션을 위한 주입 토큰이며, 현재 형태는 `{ strictTransactions: boolean }`입니다.
이는 등록 identity, client ownership, visibility metadata까지 담는 패키지 내부 정규화 모듈 옵션 토큰보다 의도적으로 좁은 표면이며, 그 내부 토큰은 공개 API가 아닙니다.

### 플랫폼 status

- `createPrismaPlatformStatusSnapshot(input)`: Prisma readiness, health, ownership, ALS 기반 transaction context를 보고하는 persistence platform status snapshot을 생성합니다.

### 이름 있는 Prisma 토큰 헬퍼

- `getPrismaClientToken(name?)`
- `getPrismaOptionsToken(name?)`
- `getPrismaServiceToken(name?)`

이 헬퍼들은 `name`이 없으면 기본 이름 없는 토큰을 반환하고, `name`이 있으면 해당 등록 전용 토큰을 반환합니다.
이 헬퍼가 이름 있는 등록을 대상으로 삼는 공개 방법이며, 정규화 모듈 옵션 토큰 같은 내부 구현 토큰은 의도적으로 export하지 않습니다.

### 관련 export 타입

- `PrismaModuleOptions`
- `PrismaClientLike`
- `PrismaHandleProvider`
- `PrismaServiceFacade<TClient>`
- `PrismaTransactionClient<TClient>`
- `InferPrismaTransactionClient<TClient>`
- `InferPrismaTransactionOptions<TClient>`

## 관련 패키지

- `@fluojs/runtime`: 애플리케이션 라이프사이클 훅을 관리합니다.
- `@fluojs/http`: 명시적 `requestTransaction(...)` 경계와 함께 사용할 수 있는 요청 라이프사이클 primitive를 제공합니다.
- `@fluojs/terminus`: Prisma를 위한 헬스 인디케이터를 제공합니다.

## 예제 소스

- `packages/prisma/src/vertical-slice.test.ts`: 표준 DTO → 서비스 → 리포지토리 → Prisma 흐름 예제.
- `packages/prisma/src/module.test.ts`: 모듈 라이프사이클, 이름 있는 클라이언트, async factory, strict transaction 동작, status snapshot 테스트.
