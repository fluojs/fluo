# @fluojs/drizzle

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Node.js 전용 트랜잭션 인지형 데이터베이스 래퍼와 선택적 dispose hook을 제공하는 fluo용 Drizzle ORM 통합 패키지입니다.

## 목차

- [설치](#설치)
- [런타임 지원](#런타임-지원)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
  - [서비스 트랜잭션 경계 (@Transaction)](#서비스-트랜잭션-경계-transaction)
  - [수동 트랜잭션과 current()](#수동-트랜잭션과-current)
  - [요청 전체 컨트롤러 경계](#요청-전체-컨트롤러-경계)
  - [종료와 상태 계약](#종료와-상태-계약)
- [수동 모듈 구성](#수동-모듈-구성)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/drizzle drizzle-orm
# 사용하는 Drizzle adapter에 맞는 driver도 함께 설치하세요. 예:
npm install pg
```

## 런타임 지원

루트 `@fluojs/drizzle` 패키지는 현재 Node.js 20+ 통합입니다. ambient transaction context를 유지하기 위해 Node의 `node:async_hooks` 모듈을 import하고, package manifest는 `engines.node >=20.0.0`을 선언합니다.

Drizzle ORM 자체는 Bun SQL이나 Cloudflare D1 같은 driver도 대상으로 할 수 있지만, 비 Node transaction-context adapter가 문서화되기 전까지 해당 driver runtime은 이 fluo wrapper 범위 밖입니다.

## 사용 시점

- Node.js 20+ 애플리케이션에서 Drizzle을 다른 fluo 모듈과 같은 DI·모듈·라이프사이클 모델 안에 넣고 싶을 때
- repository 코드가 root handle과 현재 트랜잭션 handle 사이를 `current()` 하나로 다루고 싶을 때
- 애플리케이션 종료 시 underlying driver 정리 로직도 함께 실행해야 할 때

## 빠른 시작

```ts
import { ConfigService } from '@fluojs/config';
import { Module } from '@fluojs/core';
import { DrizzleModule } from '@fluojs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
        });

        return {
          database: drizzle(pool),
          dispose: async () => {
            await pool.end();
          },
        };
      },
    }),
  ],
})
export class AppModule {}
```

## 주요 패턴

### 서비스 트랜잭션 경계 (@Transaction)

`@Transaction()` 데코레이터는 서비스 레이어에서 트랜잭션 경계를 정의하는 권장 방법입니다. 이 데코레이터가 적용된 메서드 내부에서 발생하는 모든 리포지토리 호출은 동일한 Drizzle 트랜잭션을 공유합니다.

```ts
import { Transaction, DrizzleDatabase, type DrizzleDatabaseFacade } from '@fluojs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { users, profiles } from './schema';

type AppDatabase = ReturnType<typeof drizzle>;

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  @Transaction()
  async onboardUser(dto: any) {
    const user = await this.repo.create(dto);
    await this.repo.initProfile(user.id);
    return user;
  }
}

export class UserRepository {
  constructor(private readonly db: DrizzleDatabaseFacade<AppDatabase>) {}

  async create(data: any) {
    // facade 타입은 표준 Drizzle 메서드를 노출합니다.
    // @Transaction() 내부에서 호출되면 자동으로 활성 트랜잭션에 참여합니다.
    return this.db.insert(users).values(data);
  }

  async initProfile(userId: string) {
    return this.db.insert(profiles).values({ userId });
  }
}
```

`@Transaction()` 메서드 호출은 재진입(reentrant)이 가능합니다. 데코레이터가 적용된 메서드가 다른 데코레이터 적용 메서드를 호출하더라도 하나의 동일한 Drizzle 트랜잭션 안에서 실행됩니다.

기본적으로 `@Transaction()`은 작은 host-object heuristic으로 대상을 고릅니다. 먼저 `this.db`를 확인하고, 그다음 데코레이터가 붙은 인스턴스의 직접 property, 마지막으로 그 값들의 중첩 `.db` property 중 `transaction(...)` 메서드를 노출하는 첫 값을 사용합니다. 이 덕분에 `constructor(private readonly db: DrizzleDatabase<...>)` 같은 일반 서비스는 간결하게 유지할 수 있지만, 하나의 서비스가 Drizzle wrapper를 둘 이상 소유한다면 property 순서에 의존하지 마세요. 데코레이터가 붙은 host가 여러 transaction-capable client를 갖거나 `.db`를 노출하는 repository를 감싸는 경우에는 `@Transaction((self) => self.ordersDb)` 또는 `@Transaction((self) => self.analyticsDb, options)`처럼 명시적 accessor를 전달하세요.

### 수동 트랜잭션과 current()

`DrizzleDatabase`는 트랜잭션 범위 내에 있으면 자동으로 활성 트랜잭션 handle을, 그렇지 않으면 root handle을 반환하는 `current()` 메서드를 제공합니다. 외부 유틸리티에 handle을 전달하거나 복잡한 수동 트랜잭션 처리가 필요한 경우 escape hatch로 사용하세요.

```ts
import { DrizzleDatabase } from '@fluojs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { users } from './schema';

type AppDatabase = ReturnType<typeof drizzle>;

export class AdvancedRepository {
  constructor(private readonly db: DrizzleDatabase<AppDatabase>) {}

  async customOperation() {
    const tx = this.db.current();
    // fluo가 자동으로 감싸지 않는 작업을 수행하거나,
    // Drizzle handle을 직접 기대하는 외부 유틸리티에 전달할 때 tx를 사용하세요.
    return tx.select().from(users);
  }
}
```

수동 트랜잭션 블록에는 `db.transaction()`을 사용하세요:

```ts
await this.db.transaction(async () => {
  const current = this.db.current();

  await current.insert(users).values(user);
  await current.insert(profiles).values(profile);
});
```

중첩 호출은 활성 transaction boundary를 재사용합니다. 이미 boundary가 활성화되어 있는데 중첩 호출이 transaction option을 전달하면, 기존 transaction을 조용히 바꾸지 않고 해당 중첩 option을 거부합니다.

`database.transaction(...)`을 사용할 수 없고 `strictTransactions`가 `false`(기본값)이면 `transaction()`과 `requestTransaction()`은 의도적으로 fail-open(fail-open fallback)하여 callback을 root handle에서 직접 실행합니다. 이는 local fake, read-only adapter, 점진적 migration에는 유용하지만 원자적이지 않으므로 실제 데이터베이스 transaction으로 취급하면 안 됩니다. rollback 보장이 필요한 production 경로에서는 `strictTransactions: true`를 설정하세요. 그러면 startup 및 readiness 진단에서 누락된 `database.transaction(...)` 지원을 드러내고, transaction helper는 트랜잭션 없이 조용히 실행하는 대신 예외를 던집니다. 요청 범위 fallback은 그래도 `AbortSignal`을 존중하므로, Drizzle transaction runner가 없어도 취소된 요청은 직접 실행 전이나 도중에 중단될 수 있습니다.

### 요청 전체 컨트롤러 경계

비즈니스 작업에는 서비스 레벨 `@Transaction()`을 우선 사용하세요. 전체 요청을 하나의 transaction으로 감싸던 NestJS controller/interceptor 패턴을 마이그레이션해야 한다면 controller, route adapter, request orchestration 경계에서 `requestTransaction(...)`을 명시적으로 호출하고 가능한 경우 request `AbortSignal`을 전달하세요.

```ts
import { Controller, Post } from '@fluojs/http';
import { DrizzleDatabase } from '@fluojs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';

type AppDatabase = ReturnType<typeof drizzle>;

@Controller('/checkout')
export class CheckoutController {
  constructor(
    private readonly db: DrizzleDatabase<AppDatabase>,
    private readonly checkout: CheckoutService,
  ) {}

  @Post()
  create(input: CheckoutInput, requestSignal?: AbortSignal) {
    return this.db.requestTransaction(
      () => this.checkout.createOrder(input),
      requestSignal,
    );
  }
}
```

import할 수 있는 Drizzle `*TransactionInterceptor` export는 없습니다. 기존 NestJS interceptor 설계는 대부분의 transaction boundary를 서비스로 옮기고, 전체 request 작업이 서비스 메서드 하나가 아니라 같은 boundary를 공유해야 하는 드문 controller-level 호환성 사례에만 명시적 `requestTransaction(...)`을 남기세요.

### 종료와 상태 계약

애플리케이션 종료 중에는 `DrizzleDatabase`가 아직 활성 상태인 요청 트랜잭션을 abort하고, 열린 요청 및 수동 transaction callback이 settle되거나 rollback될 때까지 기다린 뒤 선택적 `dispose(database)` hook을 실행합니다. 이 순서는 pool이나 외부 관리 리소스를 닫기 전에 driver가 commit/rollback/cleanup 작업을 끝낼 수 있게 보장합니다.
기존 요청 boundary 안에서 열린 중첩 `requestTransaction(...)` 호출은 활성 Drizzle transaction을 재사용하면서도 ambient request abort signal을 관찰합니다. 기존 수동 transaction boundary 안에서 열린 중첩 `requestTransaction(...)` 호출도 두 번째 Drizzle transaction을 열지 않고 shutdown settlement tracking에 참여하며, 해당 settlement handle은 바깥 수동 transaction이 settle될 때까지 tracking에 남아 shutdown이 `dispose(database)`를 실행하기 전에 그 바깥 경계까지 drain하게 합니다. 단, platform status activity count는 더 짧게 유지됩니다. 중첩 request callback이 settle되는 즉시, 바깥 수동 transaction이 계속 실행 중이어도 `details.activeRequestTransactions`는 감소합니다.
종료가 시작된 뒤 새 `transaction(...)` 및 `requestTransaction(...)` 호출은 거부되므로, 종료 boundary를 지난 뒤 시작되는 늦은 트랜잭션보다 dispose가 먼저 실행되는 상황을 방지합니다.
요청 callback이 완료된 뒤 underlying Drizzle transaction runner가 commit 또는 rollback을 끝내기 전에 request signal이 abort되면, `requestTransaction(...)`은 먼저 해당 runner가 settle될 때까지 기다린 다음 abort reason으로 reject합니다. 이 동작은 Drizzle cleanup을 request cancellation과 직렬화하면서, 완료된 callback 결과를 반환하는 대신 늦은 request abort를 caller에게 드러냅니다.

`createDrizzlePlatformStatusSnapshot(...)`과 `DrizzleDatabase.createPlatformStatusSnapshot()`은 같은 계약을 진단 surface에 노출합니다.

- Drizzle이 종료 중이거나 중지된 상태이면, 또는 `strictTransactions`가 켜져 있는데 `database.transaction(...)` 지원이 없으면 `readiness.status`는 `not-ready`입니다.
- 요청 트랜잭션을 drain하는 종료 중에는 `health.status`가 `degraded`이고, dispose 이후에는 `unhealthy`입니다.
- `details.activeRequestTransactions`, `details.lifecycleState`, `details.strictTransactions`, `details.supportsTransaction`은 현재 요청 트랜잭션과 트랜잭션 지원 상태를 설명합니다.
- `details.transactionContext: 'als'`는 요청 및 service transaction boundary가 사용하는 async-local transaction context를 나타냅니다.
- `ownership.externallyManaged: true`와 `ownership.ownsResources: false`는 이 패키지가 설정된 dispose hook은 실행하지만 underlying driver resource의 소유권을 주장하지 않는다는 뜻입니다.

## 수동 모듈 구성

`DrizzleModule.forRoot(...)` / `forRootAsync(...)`를 사용해 Drizzle을 등록합니다. 커스텀 `defineModule(...)` 안에서 Drizzle 지원을 조합해야 할 때도 동일한 모듈 entrypoint를 import해서 사용하세요.

```ts
import { defineModule } from '@fluojs/runtime';
import { DrizzleModule } from '@fluojs/drizzle';

const database = {
  transaction: async <T>(callback: (tx: typeof database) => Promise<T>) => callback(database),
};

class ManualDrizzleModule {}

defineModule(ManualDrizzleModule, {
  imports: [DrizzleModule.forRoot({ database })],
});
```

## 공개 API 개요

- `DrizzleModule.forRoot(options)` / `DrizzleModule.forRootAsync(options)`
- `DrizzleDatabase`
- `DrizzleDatabaseFacade<TDatabase>`
- `Transaction`
- `DRIZZLE_DATABASE`, `DRIZZLE_DISPOSE`, `DRIZZLE_HANDLE_PROVIDER`, `DRIZZLE_OPTIONS`
- `DrizzleDatabase.createFacade(...)` (호환성 전용 provider wiring helper; 애플리케이션 등록은 `DrizzleModule.forRoot(...)` / `forRootAsync(...)`를 우선 사용)
- `createDrizzlePlatformStatusSnapshot(...)`
- `DrizzleDatabaseLike`
- `DrizzleModuleOptions`
- `DrizzleHandleProvider`

`DRIZZLE_HANDLE_PROVIDER`는 lifecycle-aware `DrizzleDatabase` wrapper를 가리키는 alias token입니다. `@fluojs/terminus` 같은 health integration은 이 token을 통해 raw database ping으로 fallback하기 전에 `createPlatformStatusSnapshot()`을 읽습니다.

provider가 `current()`, `transaction(...)`, `requestTransaction(...)`, `createPlatformStatusSnapshot()` 같은 wrapper 메서드만 필요로 하면 `DrizzleDatabase<TDatabase>`를 사용하세요. 리포지토리 주입에서 Drizzle query 메서드를 직접 호출해야 한다면 `DrizzleDatabaseFacade<TDatabase>`를 사용합니다. 이 facade는 활성 트랜잭션 handle이 있으면 그 handle로, 없으면 root handle로 호출을 전달합니다. `DrizzleDatabase.createFacade(...)`는 module provider wiring을 위한 low-level compatibility helper로 유지됩니다. 애플리케이션 코드는 `DrizzleModule.forRoot(...)` / `forRootAsync(...)`를 우선 사용하세요.

`Transaction`은 서비스 계층 트랜잭션 경계를 위한 표준 TC39 method decorator입니다. 데코레이터가 붙은 host에서 `this.db`, 직접 property, 중첩 `.db` property 순서로 transaction-capable 대상을 resolve하고, 명시적 client 선택에는 accessor를 받을 수 있으며, 외부 경계에는 Drizzle transaction option을 전달할 수 있습니다.

### `DrizzleModule`

- `DrizzleModule.forRoot(options)` / `DrizzleModule.forRootAsync(options)`
- `forRootAsync(...)`는 database/dispose/transaction 설정을 factory에서 반환하는 DI-aware Drizzle 옵션을 받습니다. provider를 전역으로 노출해야 할 때는 최상위 async 등록 옵션에 `global`을 전달하세요.
- `forRootAsync(...)`는 애플리케이션 container마다 옵션을 한 번 resolve합니다. 테스트나 multi-app process에서 같은 module definition을 재사용해도 memoized factory result를 공유하지 않고 각 container가 독립적인 database/dispose 결과를 받습니다.
- `strictTransactions: true`를 설정하면 transaction 지원이 없는 database handle에서 예외를 던집니다.
- sync 및 async 등록 모두에서 `database`는 실제 object/function handle이어야 하며, 누락된 handle은 모듈 등록 또는 async bootstrap 중 거부됩니다.

## 관련 패키지

- `@fluojs/runtime`: 모듈 시작과 종료 순서를 관리합니다.
- `@fluojs/http`: 명시적 `requestTransaction(...)` 경계와 함께 사용할 수 있는 요청 라이프사이클 primitive를 제공합니다.
- `@fluojs/prisma`, `@fluojs/mongoose`: 같은 런타임 모델 위에서 동작하는 다른 데이터 통합 패키지입니다.

## 예제 소스

- `packages/drizzle/src/vertical-slice.test.ts`
- `packages/drizzle/src/module.test.ts`
- `packages/drizzle/src/public-api.test.ts`
