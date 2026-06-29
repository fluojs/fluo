# 트랜잭션 문맥 계약

<p><a href="./transactions.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose` 전반의 현재 트랜잭션 문맥 계약을 정의합니다.

## 지원되는 연동

| 패키지 | ambient 문맥 운반체 | 주요 접근 API | 요청 경계 API | 현재 지원 범위 |
| --- | --- | --- | --- | --- |
| `@fluojs/prisma` | `AsyncLocalStorage<TTransactionClient>` | 서비스의 `@Transaction()` | 명시적 `PrismaService.requestTransaction(...)` | `$transaction(...)`을 사용할 수 있을 때 활성 Prisma interactive transaction client를 공유합니다. |
| `@fluojs/drizzle` | `AsyncLocalStorage<TTransactionDatabase>` | 서비스의 `@Transaction()` | 명시적 `DrizzleDatabase.requestTransaction(...)` | `database.transaction(...)`을 사용할 수 있을 때 활성 Drizzle transaction database handle을 공유합니다. |
| `@fluojs/mongoose` | `AsyncLocalStorage<MongooseSessionLike>` | 서비스의 `@Transaction()` | 명시적 `MongooseConnection.requestTransaction(...)` | `connection.startSession()` 또는 위임된 `connection.transaction(...)`을 사용할 수 있을 때 활성 Mongoose session을 공유합니다. |

## 서비스 트랜잭션 경계 (기본)

fluo에서 트랜잭션을 관리하는 가장 권장되는 방법은 서비스 계층에서 `@Transaction()` 데코레이터를 사용하는 것입니다. 이는 영속성 작업이 하나의 원자적 단위로 그룹화되는 명확한 경계를 정의합니다.

```ts
// 서비스 (기본 경계)
@Transaction()
async createUser(dto) { 
  // 여기의 모든 레포지토리 호출은 동일한 ambient 트랜잭션을 공유합니다
  return this.repo.create(dto); 
}

// 레포지토리 (current-less)
async create(dto) { 
  // 영속성 클라이언트는 자동으로 ambient 트랜잭션을 해석합니다
  return this.prisma.user.create({ data: dto }); 
}
```

### 미래의 ORM 어댑터
fluo 에코시스템에 추가되는 모든 새로운 ORM 연동 패키지는 이 서비스 경계 계약을 충족하는 `@Transaction()` 데코레이터를 노출해야 합니다.

## 문맥 해석 규칙

| 규칙 | 현재 계약 | 소스 기준 |
| --- | --- | --- |
| 서비스 -> 레포지토리 흐름 | 서비스의 데코레이터가 경계를 설정하며, 레포지토리는 세션을 전달하거나 `current()`에 명시적으로 접근할 필요 없이 클라이언트를 사용합니다. | `packages/core/src/decorators/transaction.ts` (추상), `packages/mongoose/src/connection.ts` (자동 세션) |
| 루트 vs ambient 핸들 | Prisma와 Drizzle 영속성 핸들은 활성 트랜잭션 핸들이 있으면 그 값을, 없으면 루트 client/database를 해석합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts` |
| Mongoose 세션 자동 바인딩 | 지원되는 `MongooseConnection.model(...)` facade 작업(`create`, `find`, `findOne`, `aggregate`, `bulkWrite`)은 ambient 트랜잭션 세션을 자동으로 첨부합니다. 지원되지 않는 model 메서드, `doc.save()`, raw `conn.current().model(...)` 호출, 고급 교차 연결 시나리오에는 명시적인 세션 전달이 필요합니다. | `packages/mongoose/src/connection.ts` |
| 중첩 경계 재사용 | 이미 트랜잭션이 활성화되어 있으면 `@Transaction()`은 새 경계를 열지 않고 기존 경계를 재사용합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| 중첩 옵션 제한 | Prisma와 Drizzle은 ambient 트랜잭션이 이미 활성화된 상태에서 중첩 트랜잭션 옵션을 허용하지 않습니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts` |
| strict 모드 | 연동 패키지는 등록된 client/connection이 트랜잭션을 지원하지 않을 때 예외를 던지도록 설정할 수 있습니다. strict 모드가 아니면 트랜잭션 헬퍼는 직접 실행으로 폴백합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| Drizzle 데코레이터 대상 선택 | Drizzle `@Transaction()`은 데코레이터가 붙은 host에서 `this.db`, 직접 property, 중첩 `.db` property 순서로 `transaction(...)`을 노출하는 값을 찾습니다. 대상이 둘 이상 가능하면 `@Transaction((self) => self.ordersDb)` 같은 명시적 accessor를 사용합니다. | `packages/drizzle/src/transaction.ts` |

## 경계 의미론

| 경계 | 현재 동작 | 소스 기준 |
| --- | --- | --- |
| `@Transaction()` 경계 | 메서드를 패키지별 트랜잭션 러너로 감싸고 결과 클라이언트/세션을 ALS에 바인딩합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| 수동 Prisma 경계 | `PrismaService.transaction(fn, options?)`는 `fn`을 `$transaction(...)` 내부에서 실행하고 트랜잭션 클라이언트를 ALS에 바인딩합니다. | `packages/prisma/src/service.ts` |
| 수동 Drizzle 경계 | `DrizzleDatabase.transaction(fn, options?)`는 `fn`을 `database.transaction(...)` 내부에서 실행하고 트랜잭션 데이터베이스를 ALS에 바인딩합니다. | `packages/drizzle/src/database.ts` |
| 수동 Mongoose 경계 | `MongooseConnection.transaction(fn)`은 `connection.transaction(...)`에 위임하거나 수동 `startTransaction()` 사이클을 관리합니다. | `packages/mongoose/src/connection.ts` |

Drizzle fail-open fallback은 등록된 database handle이 `database.transaction(...)`을 노출하지 않고 `strictTransactions`가 `false`일 때만 적용됩니다. 이 모드에서 `transaction(...)`과 `requestTransaction(...)`은 callback을 root handle에서 직접 실행하므로 local fake나 점진적 migration 경로는 계속 사용할 수 있지만 rollback 원자성은 없습니다. 열려 있는 fail-open 수동 `transaction(...)` callback은 종료 중에도 tracking되므로 `dispose(database)`는 직접 실행이 settle될 때까지 기다립니다. transaction 보장이 필요한 production 흐름에서는 `strictTransactions: true`를 설정하세요. 그러면 `database.transaction(...)`을 사용할 수 없을 때 readiness가 `not-ready`가 되고 helper가 예외를 던집니다.

Mongoose connection ownership은 애플리케이션에 남아 있습니다. `MongooseModule.forRoot(...)`와 `forRootAsync(...)`는 concrete connection handle을 요구하며, 애플리케이션이 `dispose(connection)`을 제공하지 않는 한 raw Mongoose connection을 생성하거나, model을 compile하거나, 닫지 않습니다. Mongoose fail-open fallback은 등록된 connection에 `connection.transaction(...)`과 `startSession()`이 모두 없고 `strictTransactions`가 `false`일 때만 적용됩니다. 이 모드에서 `transaction(...)`과 `requestTransaction(...)`은 rollback 원자성 없이 callback을 직접 실행합니다. MongoDB transaction 보장이 필요한 production 흐름에서는 `strictTransactions: true`를 설정하세요. 그러면 두 transaction API를 모두 사용할 수 없을 때 readiness가 `not-ready`가 되고 helper가 예외를 던집니다. `MongooseConnection.createPlatformStatusSnapshot()`은 health/readiness surface를 위해 export된 `createMongoosePlatformStatusSnapshot(...)` helper와 같은 진단을 노출합니다.

## 요청 범위 호환성

| 패턴 | 동작 |
| --- | --- |
| 명시적 요청 경계 | 전체 요청을 트랜잭션으로 감싸야 하는 경우 애플리케이션 코드가 controller, route adapter, request orchestration 경계에서 `requestTransaction(...)`을 직접 호출할 수 있습니다. |
| 인터셉터 상태 | `*TransactionInterceptor` export는 제거되었습니다. 비즈니스 작업에는 서비스 `@Transaction()`을 우선 사용하고, 드문 요청 전체 경계에는 명시적 `requestTransaction(...)`을 사용하세요. controller-level `@Transaction()`은 controller가 명시적 persistence 대상을 소유할 때의 호환성 경로로만 유지됩니다. |

NestJS controller 또는 interceptor transaction 패턴을 마이그레이션할 때는 대체 Drizzle 또는 Mongoose interceptor를 찾지 마세요. 일반적인 비즈니스 원자성은 서비스 `@Transaction()` 메서드에 두고, 전체 request lifecycle이 하나의 persistence transaction을 공유해야 하는 경우에만 controller에서 `requestTransaction(...)`으로 감싸세요. 가능한 경우 request `AbortSignal`을 전달하면 실제 transaction 실행과 fail-open fallback 모두에서 cancellation이 보입니다.

## 고급 / 탈출구 (Escape Hatch)

| API | 목적 |
| --- | --- |
| `current()` / `currentSession()` | ambient 트랜잭션 핸들에 대한 수동 접근. 표준 레포지토리 패턴 밖에서 원시 영속성 클라이언트 접근이 필요한 경우에만 사용하세요. |
| 명시적 클라이언트 선택 | `@Transaction((self) => self.analyticsPrisma)`를 통해 트랜잭션 경계의 대상이 될 특정 영속성 클라이언트 인스턴스를 지정할 수 있습니다. |

## 제약 사항

- 트랜잭션 관리의 기본 경로는 `@Transaction()`을 통한 서비스 계층입니다.
- 지원되는 Mongoose facade 작업은 자동으로 ambient 트랜잭션 세션에 참여합니다. 해당 표준 흐름에서는 명시적인 세션 전달이 권장되지 않으며, 지원되지 않는 model 메서드에는 여전히 명시적인 세션 전달이 필요합니다.
- 롤백은 예외 기반입니다. `@Transaction()`으로 감싸진 메서드가 예외를 던지면 트랜잭션이 중단됩니다.
