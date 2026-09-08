# 트랜잭션 문맥 계약

<p><a href="./transactions.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>
<!-- fluo-mongoose-contract: application-owned-connection, ambient-session-merge, preserves-operation-options, strict-fail-open, explicit-target -->

이 문서는 `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose` 전반의 현재 트랜잭션 문맥 계약을 정의합니다.

## 지원되는 연동

| 패키지 | ambient 문맥 운반체 | 주요 접근 API | 요청 경계 API | 현재 지원 범위 |
| --- | --- | --- | --- | --- |
| `@fluojs/prisma` | `AsyncLocalStorage<TTransactionClient>` | 서비스의 `@Transaction()` | 명시적 `PrismaService.requestTransaction(...)` 또는 deprecated `PrismaTransactionInterceptor` 호환성 | `$transaction(...)`을 사용할 수 있을 때 활성 Prisma interactive transaction client를 공유합니다. |
| `@fluojs/drizzle` | `AsyncLocalStorage<TTransactionDatabase>` | 서비스의 `@Transaction()` | 명시적 `DrizzleDatabase.requestTransaction(...)` 또는 deprecated `DrizzleTransactionInterceptor` 호환성 | `database.transaction(...)`을 사용할 수 있을 때 활성 Drizzle transaction database handle을 공유합니다. |
| `@fluojs/mongoose` | `AsyncLocalStorage<MongooseSessionLike>` | 서비스의 `@Transaction()` | 명시적 `MongooseConnection.requestTransaction(...)` 또는 deprecated `MongooseTransactionInterceptor` 호환성 | `connection.startSession()` 또는 위임된 `connection.transaction(...)`을 사용할 수 있을 때 활성 Mongoose session을 공유합니다. |

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
| 이름 있는 Drizzle 핸들 | 이름 있는 Drizzle 핸들은 각각 분리된 ALS context를 소유합니다. multi-client service는 decorator target discovery에 의존하지 않고 `@Transaction((self) => self.analytics)`로 이름 있는 핸들을 명시적으로 선택합니다. | `packages/drizzle/src/named-registration.ts`, `packages/drizzle/src/transaction.ts` |
| Mongoose 문서 저장 helper | `MongooseConnection.saveDocument(document, options?)`는 기존 문서를 위한 opt-in 경로입니다. ambient session과 native save option을 병합하고 document identity를 보존하며, 누락되거나 충돌하는 session을 거부합니다. 직접 `doc.save()` 동작은 바꾸지 않습니다. | `packages/mongoose/src/connection.ts` |
| Mongoose 세션 자동 바인딩 | 지원되는 `MongooseConnection.model(...)` facade 작업(`create`, `find`, `findOne`, `aggregate`, `bulkWrite`)은 ambient 트랜잭션 세션을 자동으로 첨부합니다. 지원되지 않는 model 메서드, `doc.save()`, raw `conn.current().model(...)` 호출, 고급 교차 연결 시나리오에는 명시적인 세션 전달이 필요합니다. | `packages/mongoose/src/connection.ts` |
| Mongoose decorator 대상 선택 | Mongoose `@Transaction()`은 `this.conn`, transaction-capable한 decorated instance 자체, 또는 하나뿐인 중첩 `this.*.conn` collaborator를 해석합니다. 여러 중첩 후보 중 하나를 임의로 선택하지 않고 거부하므로, multi-connection service 또는 비표준 field에는 `@Transaction((self) => self.analytics.conn)` 같은 accessor를 전달하세요. | `packages/mongoose/src/transaction.ts` |
| 중첩 경계 재사용 | 이미 트랜잭션이 활성화되어 있으면 `@Transaction()`은 새 경계를 열지 않고 기존 경계를 재사용합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| 중첩 옵션 제한 | Prisma와 Drizzle은 ambient 트랜잭션이 이미 활성화된 상태에서 중첩 native 트랜잭션 옵션을 허용하지 않습니다. 별도 `boundary`의 `requireAfterCommit`은 native 옵션이 아니라 현재 경계의 capability 요구입니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts` |
| strict 모드 | 연동 패키지는 등록된 client/connection이 트랜잭션을 지원하지 않을 때 예외를 던지도록 설정할 수 있습니다. strict 모드가 아니면 트랜잭션 헬퍼는 직접 실행으로 폴백합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| Drizzle 데코레이터 대상 선택 | Drizzle `@Transaction()`은 데코레이터가 붙은 host에서 `this.db`, 직접 property, 중첩 `.db` property 순서로 `transaction(...)`을 노출하는 값을 찾고, 후보가 없으면 데코레이터가 붙은 인스턴스 자체로 폴백합니다. 대상이 둘 이상 가능하면 `@Transaction((self) => self.ordersDb)` 같은 명시적 accessor를 사용합니다. | `packages/drizzle/src/transaction.ts` |

## 경계 의미론

| 경계 | 현재 동작 | 소스 기준 |
| --- | --- | --- |
| `@Transaction()` 경계 | 메서드를 패키지별 트랜잭션 러너로 감싸고 결과 클라이언트/세션을 ALS에 바인딩합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| 수동 Prisma 경계 | `PrismaService.transaction(...)`은 `fn`을 `$transaction(...)` 내부에서 실행하고 트랜잭션 클라이언트를 ALS에 바인딩합니다. 인자와 반환값은 [Prisma API](../../packages/prisma/README.ko.md#공개-api-개요)가 소유합니다. | `packages/prisma/src/service.ts` |
| 수동 Drizzle 경계 | `DrizzleDatabase.transaction(...)`은 `fn`을 `database.transaction(...)` 내부에서 실행하고 트랜잭션 데이터베이스를 ALS에 바인딩합니다. 인자와 반환값은 [Drizzle API](../../packages/drizzle/README.ko.md#공개-api-개요)가 소유합니다. | `packages/drizzle/src/database.ts` |
| 수동 Mongoose 경계 | `MongooseConnection.transaction(...)`은 `connection.transaction(...)`에 위임하거나 수동 `startTransaction()` 사이클을 관리합니다. 인자와 반환값은 [Mongoose API](../../packages/mongoose/README.ko.md#공개-api)가 소유합니다. | `packages/mongoose/src/connection.ts` |

Drizzle fail-open fallback은 등록된 database handle이 `database.transaction(...)`을 노출하지 않고 `strictTransactions`가 `false`일 때만 적용됩니다. 이 모드에서 `transaction(...)`과 `requestTransaction(...)`은 callback을 root handle에서 직접 실행하므로 local fake나 점진적 migration 경로는 계속 사용할 수 있지만 rollback 원자성은 없습니다. Fallback callback에서도 root handle은 ALS에 바인딩됩니다. 따라서 중첩 boundary는 이 비원자적 context를 재사용하고, 중첩 request 작업은 ambient request abort signal을 관찰하며, 중첩 직접 callback은 `dispose(database)` 전에 소유 shutdown drain에 남습니다. transaction 보장이 필요한 production 흐름에서는 `strictTransactions: true`를 설정하세요. 그러면 `database.transaction(...)`을 사용할 수 없을 때 readiness가 `not-ready`가 되고 helper가 예외를 던집니다.

Mongoose connection ownership은 애플리케이션에 남아 있습니다. `MongooseModule.forRoot(...)`와 `forRootAsync(...)`는 concrete connection handle을 요구하며, 애플리케이션이 `dispose(connection)`을 제공하지 않는 한 raw Mongoose connection을 생성하거나, model을 compile하거나, 닫지 않습니다. Mongoose fail-open fallback은 등록된 connection에 `connection.transaction(...)`과 `startSession()`이 모두 없고 `strictTransactions`가 `false`일 때만 적용됩니다. 이 모드에서 `transaction(...)`과 `requestTransaction(...)`은 rollback 원자성 없이 callback을 직접 실행합니다. 열려 있는 fail-open 수동 `transaction(...)` callback은 종료 중에도 tracking되므로 `dispose(connection)`은 직접 실행이 settle될 때까지 기다립니다. MongoDB transaction 보장이 필요한 production 흐름에서는 `strictTransactions: true`를 설정하세요. 그러면 두 transaction API를 모두 사용할 수 없을 때 readiness가 `not-ready`가 되고 helper가 예외를 던집니다. `MongooseConnection.createPlatformStatusSnapshot()`은 health/readiness surface를 위해 export된 `createMongoosePlatformStatusSnapshot(...)` helper와 같은 진단을 노출합니다.

## 커밋 후 작업

이 절은 세 wrapper의 `afterCommit` 실행 순서·실패·수명 계약의 규범 원본입니다. 각 패키지 README는 공개 import, 호출 인자, decorator overload와 캐시 무효화 예제를 소유하며, Book과 웹사이트는 이 계약에서 파생됩니다.

| 계약 필드 | 동작 |
| --- | --- |
| 범위와 전제 | 지원되는 Node.js `>=24.0.0 <27`에서 등록된 Prisma, Drizzle, Mongoose wrapper가 직접 소유하는 native transaction에만 적용됩니다. Prisma interactive `$transaction`, Drizzle `database.transaction`, Mongoose delegated `connection.transaction` 또는 native session의 commit 경로가 필요합니다. |
| 입력과 기본값 | `afterCommit`은 인자 없는 동기/비동기 callback을 등록하고 즉시 `void`를 반환합니다. `boundary.requireAfterCommit` 생략 또는 `false`는 기존 native 옵션, `strictTransactions` 기본값과 fail-open fallback을 바꾸지 않습니다. |
| 사전 capability 검사 | `requireAfterCommit: true`이면 사용자 transaction callback을 호출하기 **전에** native commit 관찰 capability를 검사하고 미지원이면 `AfterCommitCapabilityError`로 거부합니다. 이 옵션을 생략했어도 미지원 또는 native transaction 없는 fallback에서 hook 등록은 거부됩니다. |
| 등록 수명 | 같은 wrapper의 열린 transaction callback scope 안에서만 등록할 수 있습니다. 바깥, 이미 닫힌 scope, drain 중의 늦은 등록은 거부됩니다. `afterCommit` 호출은 hook 실행이나 commit 자체가 아닙니다. |
| 완료와 반환 | 사용자 callback이 settle되면 native commit 시작 전에 등록 scope를 닫습니다. outer native commit 성공과 session 정리 시도 settlement 뒤 hook을 등록 순서(FIFO)대로 하나씩 await합니다. outer boundary는 drain까지 기다린 뒤 원래 callback 결과를 반환합니다. 중첩 boundary의 반환은 commit 또는 hook 완료를 뜻하지 않습니다. |
| 실패 | rollback, 실패한 commit, 폐기된 callback attempt의 hook은 실행하지 않습니다. hook 실패 뒤에도 나머지 hook을 모두 실행하고 `AfterCommitError`로 보고합니다. Mongoose의 확인된 commit 이후 수동 session cleanup 실패는 아래의 별도 `AfterCommitCleanupError`를 사용합니다. DB는 이미 committed이며 Fluo는 native transaction을 재시도하거나 rollback하지 않습니다. |
| 자원과 종료 | 등록 scope는 native commit 시작 전에 닫습니다. commit 성공과 Mongoose 소유 session의 `endSession()` 정리 시도 settlement 뒤, 종료된 transaction ALS 밖에서 hook을 실행합니다. 확인된 commit 이후 수동 cleanup 실패도 hook을 생략하지 않습니다. shutdown은 실행 중인 hook까지 기다린 뒤 `$disconnect()` 또는 설정된 `dispose(...)`를 진행합니다. shutdown의 새 transaction admission 제한은 그대로 유지됩니다. |

### 중첩 경계와 재시도

같은 wrapper의 중첩 `transaction`, `requestTransaction`, `@Transaction`은 outer queue를 공유하며 별도 commit이나 savepoint를 만들지 않습니다. 중첩 callback이 예외를 던졌지만 outer callback이 이를 잡고 최종 commit하면, 그 중첩 호출에서 이미 등록한 hook도 실행합니다. 최종 outer 결과가 rollback이면 모두 버립니다. 중첩 예외만으로 공유 queue의 일부를 rollback했다고 가정하지 마세요.

Mongoose에 위임된 `connection.transaction(...)`이 사용자 callback을 재시도할 때는 **callback attempt마다 별도 queue**를 소유합니다. 폐기된 attempt의 queue는 버리고 최종 성공한 attempt만 drain합니다. 같은 attempt의 commit만 재시도하는 native 동작은 callback을 다시 호출하지 않으므로 hook을 다시 등록하지 않습니다. 이 구분은 native retry 위임이며 Fluo가 hook 실패를 transaction 재시도 사유로 바꾸는 기능이 아닙니다.

Hook 안에서 현재 wrapper를 다시 읽으면 종료된 transaction handle/session을 받지 않습니다. Prisma/Drizzle은 root handle을, Mongoose는 root connection과 활성 session이 없는 상태를 사용합니다. lifecycle이 허용하는 동안 hook에서 명시적으로 연 새 transaction은 독립 queue를 소유합니다. 이전 callback에서 캡처한 native transaction handle을 hook에 넘기거나 재사용하지 마세요.

### 커밋 이후 실패 처리

각 패키지는 `AfterCommitError`를 `AggregateError`의 하위 클래스로 export합니다. `readonly committed = true`는 원래 DB write가 이미 commit되었음을 나타냅니다. `results: readonly PromiseSettledResult<void>[]`는 성공과 실패 **전체**를 등록 순서대로 담고, 상속한 `errors`는 모든 실패 이유를 같은 순서로 담습니다. 동기 throw와 비동기 rejection을 모두 수집하며 하나의 실패로 뒤 hook을 생략하지 않습니다.

Mongoose의 수동 session 경로의 hook이 등록되었거나 `requireAfterCommit: true`로 opt-in한 소유 경계(중첩 `requestTransaction`에서 요구한 경우 포함)에서 commit 성공을 확인한 뒤 `endSession()`이 실패하면, 모든 hook을 종료된 ALS 밖에서 시도한 후 root export `AfterCommitCleanupError`를 던집니다. `AggregateError`의 직접 하위 클래스이며 `AfterCommitError`의 하위 클래스는 아닙니다. `committed`는 `true`, `cause`는 cleanup 실패이고, `results: readonly PromiseSettledResult<void>[]`는 hook 결과만 FIFO로 담습니다. `errors`에는 cleanup 실패가 먼저, 그 뒤에 실패한 hook 이유가 등록 순서대로 들어갑니다. hook이 없어도 opt-in했다면, 또는 등록한 hook이 모두 성공해도 cleanup 오류는 남으며 cleanup을 가상의 hook 결과로 만들지 않습니다. 이는 확인된 commit 이후의 cleanup 실패이지 commit 실패나 DB rollback이 아닙니다. Hook도 없고 `requireAfterCommit`도 요구하지 않은 기존 경계는 원래 cleanup 오류 identity와 no-hook request cancellation 계약을 보존합니다.

호출자는 transaction callback/commit 실패와 `AfterCommitError`, Mongoose의 `AfterCommitCleanupError`를 각각 구분해야 합니다. 캐시 무효화나 commit 이후 cleanup이 실패했다면 원래 DB write를 다시 실행하지 말고 애플리케이션이 정한 idempotent 복구·재조정 경로를 사용하세요. 어느 post-commit 오류도 native transaction retry·rollback·abort의 사유가 아닙니다. drain을 기다리므로 오래 걸리는 hook은 boundary 응답과 shutdown도 늦춥니다.

### 캐시와 전달 보장의 한계

DB write callback 안에서 `CacheService.del(...)` 또는 Redis invalidation을 수행할 hook을 등록하면 rollback 때 캐시를 먼저 지우는 문제를 피할 수 있습니다. cache와 연결은 애플리케이션이 등록하고, TTL·복구·idempotency·의존 자원의 shutdown 순서도 애플리케이션이 설계합니다. DB commit과 cache 삭제 사이의 관찰 구간이나 concurrent stale cache refill까지 제거하는 보장은 아닙니다.

Raw-client 외부 transaction, 다른 wrapper 또는 다른 connection의 commit은 관찰하지 않습니다. Redis는 Fluo-owned commit tracking이 없으므로 이 API의 지원 대상이 아닙니다. 미래 `MULTI/EXEC` 지원은 별도 설계·검토가 필요하며, DB hook에서 Redis를 호출해도 DB+Redis 원자성은 생기지 않습니다.

이는 성공한 in-process owner invocation에 대한 실행 계약입니다. 분산 transaction, durable outbox, 프로세스 crash 이후 전달, network exactly-once를 보장하지 않습니다. Commit 이후 process가 종료되면 hook이 실행되지 않을 수 있고 외부 시스템의 응답 유실도 해결하지 못합니다. durable delivery가 필요하면 DB write와 outbox record를 같은 native transaction에 저장하고 별도의 idempotent dispatcher와 reconciliation을 설계하세요.

### 근거와 검증 범위

| 대상 | 구현·검증 경로 |
| --- | --- |
| Prisma | `packages/prisma/src/service.ts`, `packages/prisma/src/transaction.ts`, `packages/prisma/src/index.ts`, [패키지 회귀 테스트](../../packages/prisma/src/after-commit.test.ts) |
| Drizzle | `packages/drizzle/src/database.ts`, `packages/drizzle/src/transaction.ts`, `packages/drizzle/src/index.ts`, [패키지 회귀 테스트](../../packages/drizzle/src/after-commit.test.ts) |
| Mongoose | `packages/mongoose/src/connection.ts`, `packages/mongoose/src/transaction.ts`, `packages/mongoose/src/index.ts`, [패키지 회귀 테스트](../../packages/mongoose/src/after-commit.test.ts) |
| 실제 native commit fixture | [실행 안내](../../packages/prisma/fixtures/after-commit/README.ko.md#실행): 빌드된 세 패키지의 공개 import, PostgreSQL과 MongoDB manual/delegated 경로 |
| 공통 runtime 동작 matrix | [`tooling/governance/after-commit-contract.test.ts`](../../tooling/governance/after-commit-contract.test.ts) |

위 경로는 #3717의 계약 검증 대상이며 목록 자체가 실행 성공 증거는 아닙니다. 저장소 의존성을 설치한 지원 Node.js 환경에서 `pnpm vitest run --project packages packages/prisma/src/after-commit.test.ts packages/drizzle/src/after-commit.test.ts packages/mongoose/src/after-commit.test.ts`와 `pnpm vitest run --project tooling tooling/governance/after-commit-contract.test.ts`를 실행하세요. Native fixture의 환경·실행 명령·commit 관찰 결과는 fixture 안내와 lead의 검증 receipt에서 확인하세요. Wrapper double만 통과한 결과를 native DB 검증으로 간주하지 않습니다.

## 요청 범위 호환성

| 패턴 | 동작 |
| --- | --- |
| 명시적 요청 경계 | 전체 요청을 트랜잭션으로 감싸야 하는 경우 애플리케이션 코드가 controller, route adapter, request orchestration 경계에서 `requestTransaction(...)`을 직접 호출할 수 있습니다. |
| Deprecated 인터셉터 호환성 | `PrismaTransactionInterceptor`, `DrizzleTransactionInterceptor`, `MongooseTransactionInterceptor`는 기존 1.x import를 위해 복원되었으며 각 패키지의 `requestTransaction(...)` API에 위임합니다. 새 코드에는 서비스 `@Transaction()`과 명시적 request boundary를 우선 사용하세요. |

NestJS controller 또는 interceptor transaction 패턴을 마이그레이션할 때 일반적인 비즈니스 원자성은 서비스 `@Transaction()` 메서드에 두세요. 기존 Prisma, Drizzle 또는 Mongoose 애플리케이션은 migration 동안 deprecated 호환성 interceptor를 유지할 수 있지만, 새 request-wide boundary는 `requestTransaction(...)`을 명시적으로 호출해야 합니다. 가능한 경우 request `AbortSignal`을 전달하세요.

## 고급 / 탈출구 (Escape Hatch)

| API | 목적 |
| --- | --- |
| `current()` / `currentSession()` | ambient 트랜잭션 핸들에 대한 수동 접근. 표준 레포지토리 패턴 밖에서 원시 영속성 클라이언트 접근이 필요한 경우에만 사용하세요. |
| 명시적 클라이언트 선택 | `@Transaction((self) => self.analyticsPrisma)`를 통해 트랜잭션 경계의 대상이 될 특정 영속성 클라이언트 인스턴스를 지정할 수 있습니다. |

## 제약 사항

- 트랜잭션 관리의 기본 경로는 `@Transaction()`을 통한 서비스 계층입니다.
- `MongooseConnection.saveDocument(...)`는 opt-in이며 활성 ambient session이 필요합니다. 트랜잭션 밖에서는 fail-closed하고 충돌하는 명시적 `session`을 거부하며 native `doc.save()`는 수정하지 않습니다.
- 지원되는 Mongoose facade 작업은 자동으로 ambient 트랜잭션 세션에 참여합니다. 해당 표준 흐름에서는 명시적인 세션 전달이 권장되지 않으며, 지원되지 않는 model 메서드에는 여전히 명시적인 세션 전달이 필요합니다.
- 롤백은 commit 전 예외 기반입니다. `@Transaction()`의 callback에서 outer native boundary까지 전파된 예외는 트랜잭션을 중단합니다. 이미 commit한 뒤의 `AfterCommitError`나 Mongoose `AfterCommitCleanupError`는 rollback을 뜻하지 않습니다.
