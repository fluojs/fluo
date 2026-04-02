# @konekti/drizzle

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti 공식 Drizzle integration baseline — Drizzle database handle을 transaction-aware `current()` seam과 optional dispose hook으로 감싼다.

## 관련 문서

- `../../docs/concepts/transactions.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`

## 이 패키지가 하는 일

`@konekti/drizzle`는 Drizzle database handle을 Konekti의 모듈, DI, lifecycle 모델에 연결한다. Prisma와 달리 Drizzle은 `$connect`/`$disconnect` lifecycle 메서드를 노출하지 않기 때문에, 이 integration은 connection lifecycle 관리보다 **handle wrapping + optional cleanup** 위주로 설계되어 있다.

주요 역할:
- `current()` / `transaction()` / `requestTransaction()`을 가진 `DrizzleDatabase` wrapper 제공
- DI 컨테이너에 `DRIZZLE_DATABASE`, `DRIZZLE_DISPOSE`, `DRIZZLE_OPTIONS` 토큰 등록
- optional `dispose` hook을 `onApplicationShutdown`에 연결
- opt-in 자동 request-scoped transaction을 위한 `DrizzleTransactionInterceptor` 노출

## 설치

```bash
npm install @konekti/drizzle
```

## 빠른 시작

```typescript
import { Module } from '@konekti/core';
import { createDrizzleModule } from '@konekti/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

@Module({
  imports: [
    createDrizzleModule({
      database: db,
      dispose: async (database) => {
        await pool.end();
      },
    }),
  ],
})
export class AppModule {}
```

### 비동기 모듈 등록

```typescript
import { createDrizzleModuleAsync } from '@konekti/drizzle';

const DrizzleModule = createDrizzleModuleAsync({
  inject: [ConfigService],
  useFactory: async (config: ConfigService) => ({
    database: createDrizzleHandle(config.get('DATABASE_URL')),
    strictTransactions: true,
    dispose: async (database) => {
      await closeDrizzleHandle(database);
    },
  }),
});
```

### Repository에서 database 사용

```typescript
import { Inject } from '@konekti/core';
import { DrizzleDatabase } from '@konekti/drizzle';
import { users } from './schema';
import { eq } from 'drizzle-orm';

export class UserRepository {
  constructor(private db: DrizzleDatabase) {}

  async findById(id: string) {
    // current()는 transaction 안이면 tx handle을, 아니면 root db를 반환한다
    return this.db.current().select().from(users).where(eq(users.id, id));
  }
}
```

### 명시적 transaction

```typescript
import { DrizzleDatabase } from '@konekti/drizzle';
import { profiles, users } from './schema';

type NewUser = typeof users.$inferInsert;
type NewProfile = typeof profiles.$inferInsert;

export class UserService {
  constructor(private readonly db: DrizzleDatabase) {}

  async createWithProfile(user: NewUser, profile: NewProfile) {
    return this.db.transaction(async () => {
      const db = this.db.current();
      await db.insert(users).values(user);
      await db.insert(profiles).values(profile);
    });
  }
}
```

### 자동 request-scoped transaction (opt-in)

```typescript
import { UseInterceptors } from '@konekti/http';
import { DrizzleTransactionInterceptor } from '@konekti/drizzle';

@UseInterceptors(DrizzleTransactionInterceptor)
class UsersController {}
```

## 핵심 API

| Export | 위치 | 설명 |
|---|---|---|
| `DrizzleDatabase` | `src/database.ts` | `current()`, `transaction()`, `requestTransaction()`, `onApplicationShutdown()`을 가진 wrapper |
| `createDrizzleModule(options)` | `src/module.ts` | 모든 provider를 포함한 importable Konekti 모듈 생성 |
| `createDrizzleModuleAsync(options)` | `src/module.ts` | async 옵션을 1회 해석해 동일한 provider surface를 등록하는 비동기 변형 |
| `createDrizzleProviders(options)` | `src/module.ts` | 수동 등록을 위한 raw provider 배열 반환 |
| `createDrizzlePlatformStatusSnapshot(input)` | `src/status.ts` | ownership/readiness/health/details를 공통 플랫폼 스냅샷 형태로 매핑 |
| `DrizzleTransactionInterceptor` | `src/transaction.ts` | 자동 per-request transaction을 위한 opt-in interceptor |
| `DRIZZLE_DATABASE` | `src/tokens.ts` | raw Drizzle database handle을 위한 DI 토큰 |
| `DRIZZLE_DISPOSE` | `src/tokens.ts` | optional cleanup hook을 위한 DI 토큰 |
| `DRIZZLE_OPTIONS` | `src/tokens.ts` | 정규화된 Drizzle module option을 위한 DI 토큰 |
| `DrizzleDatabaseLike` | `src/types.ts` | seam 타입 — optional `transaction` callback을 가진 객체 |
| `DrizzleModuleOptions` | `src/types.ts` | `{ database, dispose?, strictTransactions? }` |
| `DrizzleHandleProvider` | `src/types.ts` | public transaction-aware handle 계약 |

## 구조

```
createDrizzleModule({ database, dispose?, strictTransactions? })
  → DRIZZLE_DATABASE, DRIZZLE_DISPOSE, DRIZZLE_OPTIONS 토큰 등록
  → DrizzleDatabase와 DrizzleTransactionInterceptor를 export provider로 등록

service/repository 코드
  → DrizzleDatabase.current()
  → transaction 안이면 tx handle, 아니면 root db 반환

DrizzleDatabase.transaction(fn)
  → 가능하면 database.transaction(callback) 호출
  → AsyncLocalStorage에 tx handle 저장
  → callback 안에서 current()가 tx handle 반환

DrizzleDatabase.requestTransaction(fn)
  → 같은 경계 시맨틱 + AbortSignal 지원
  → transaction runner가 없고 strict 모드가 꺼져 있으면 abort-aware 직접 실행으로 폴백

app.close()
  → onApplicationShutdown()
  → 활성 request transaction abort + settle 대기
  → dispose가 있으면 dispose(database) 호출
```

### DRIZZLE_DISPOSE가 별도 토큰인 이유

cleanup hook을 database value에서 분리하면:
- database 객체 자체가 오염되지 않는다
- handle을 건드리지 않고 shutdown cleanup을 선택적으로 연결할 수 있다
- 테스트에서 dispose 동작을 독립적으로 검증하기 쉬워진다

### Transaction 시맨틱

`DrizzleDatabase`는 활성 transaction context를 추적하기 위해 `AsyncLocalStorage`를 사용한다. service와 repository 코드는 transaction 안인지 아닌지를 알 필요 없이 `current()`를 호출하면 되고, ALS store가 전환을 투명하게 처리한다.

`strictTransactions`는 wrapped handle이 `transaction`을 제공하지 않을 때의 동작을 제어한다.

- `false`(기본값): `transaction()`은 `fn()` 직접 실행, `requestTransaction()`은 abort-aware 직접 실행으로 폴백
- `true`: `transaction()`과 `requestTransaction()` 모두 `Transaction not supported...` 예외 발생

이미 활성 transaction context 안에서는 중첩 transaction 옵션 오버라이드를 허용하지 않는다.

## 플랫폼 상태 스냅샷 시맨틱

`createDrizzlePlatformStatusSnapshot(...)` 또는 `drizzleDatabase.createPlatformStatusSnapshot()`을 사용하면, 공통 플랫폼 계약 형태의 ownership/readiness/health를 출력할 수 있습니다.

- `ownership`: Drizzle handle은 외부에서 공급되는 소유 모델입니다 (`ownsResources: false`, `externallyManaged: true`).
- `readiness`: strict transaction 모드에서 `database.transaction`이 없으면 명시적으로 `not-ready`입니다.
- `health`: shutdown 드레인 상태는 `degraded`, 중지/정리 완료 상태는 `unhealthy`로 보고합니다.
- `details`: ALS transaction context 사용 여부, strict/fallback 모드 신호, 활성 요청 트랜잭션 수를 포함합니다.

## 파일 읽기 순서 (기여자용)

1. `src/types.ts` — `DrizzleDatabaseLike`, `DrizzleModuleOptions`, `DrizzleHandleProvider`
2. `src/tokens.ts` — `DRIZZLE_DATABASE`, `DRIZZLE_DISPOSE`
3. `src/database.ts` — `DrizzleDatabase` wrapper, ALS 기반 tx context
4. `src/module.ts` — `createDrizzleProviders`, `createDrizzleModule`
5. `src/transaction.ts` — `DrizzleTransactionInterceptor`
6. `src/module.test.ts` — root handle 사용, callback 안의 tx handle, dispose hook

## 관련 패키지

- `@konekti/runtime` — 모듈 import/export와 shutdown lifecycle
- `@konekti/prisma` — Prisma 쪽에서 같은 문제를 어떻게 다르게 푸는지 비교
- `@konekti/cli` — Drizzle 선택 시 scaffold에 포함

## 한 줄 mental model

```text
@konekti/drizzle = Drizzle handle → tx-aware wrapper + optional cleanup hook → Konekti runtime
```
