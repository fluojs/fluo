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
await this.db.transaction(async () => {
  // 이 callback 안에서 db.current()는 tx handle을 반환한다
  await userRepo.create(data);
  await auditRepo.log(data.id);
});
```

### 자동 request-scoped transaction (opt-in)

```typescript
import { UseInterceptor } from '@konekti/http';
import { DrizzleTransactionInterceptor } from '@konekti/drizzle';

@UseInterceptor(DrizzleTransactionInterceptor)
class UsersController {}
```

## 핵심 API

| Export | 위치 | 설명 |
|---|---|---|
| `DrizzleDatabase` | `src/database.ts` | `current()`, `transaction()`, `requestTransaction()`, `onApplicationShutdown()`을 가진 wrapper |
| `createDrizzleModule(options)` | `src/module.ts` | 모든 provider를 포함한 importable Konekti 모듈 생성 |
| `createDrizzleProviders(options)` | `src/module.ts` | 수동 등록을 위한 raw provider 배열 반환 |
| `DrizzleTransactionInterceptor` | `src/transaction.ts` | 자동 per-request transaction을 위한 opt-in interceptor |
| `DRIZZLE_DATABASE` | `src/tokens.ts` | raw Drizzle database handle을 위한 DI 토큰 |
| `DRIZZLE_DISPOSE` | `src/tokens.ts` | optional cleanup hook을 위한 DI 토큰 |
| `DRIZZLE_OPTIONS` | `src/tokens.ts` | 정규화된 Drizzle module option을 위한 DI 토큰 |
| `DrizzleDatabaseLike` | `src/types.ts` | seam 타입 — `transaction` callback이 있는 임의의 객체 |
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

app.close()
  → onApplicationShutdown()
  → dispose가 있으면 dispose(database) 호출
```

### DRIZZLE_DISPOSE가 별도 토큰인 이유

cleanup hook을 database value에서 분리하면:
- database 객체 자체가 오염되지 않는다
- handle을 건드리지 않고 shutdown cleanup을 선택적으로 연결할 수 있다
- 테스트에서 dispose 동작을 독립적으로 검증하기 쉬워진다

### Transaction 시맨틱

`DrizzleDatabase`는 활성 transaction context를 추적하기 위해 `AsyncLocalStorage`를 사용한다. service와 repository 코드는 transaction 안인지 아닌지를 알 필요 없이 `current()`를 호출하면 되고, ALS store가 전환을 투명하게 처리한다.

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
