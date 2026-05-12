# 트랜잭션 문맥 계약

<p><a href="./transactions.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose` 전반의 현재 트랜잭션 문맥 계약을 정의합니다.

## 지원되는 연동

| 패키지 | ambient 문맥 운반체 | 주요 접근 API | 요청 인터셉터 | 현재 지원 범위 |
| --- | --- | --- | --- | --- |
| `@fluojs/prisma` | `AsyncLocalStorage<TTransactionClient>` | `PrismaService.current()` | `PrismaTransactionInterceptor` | `$transaction(...)`을 사용할 수 있을 때 활성 Prisma interactive transaction client를 공유합니다. |
| `@fluojs/drizzle` | `AsyncLocalStorage<TTransactionDatabase>` | `DrizzleDatabase.current()` | `DrizzleTransactionInterceptor` | `database.transaction(...)`을 사용할 수 있을 때 활성 Drizzle transaction database handle을 공유합니다. |
| `@fluojs/mongoose` | `AsyncLocalStorage<MongooseSessionLike>` | `MongooseConnection.currentSession()` 및 루트 연결용 `current()` | `MongooseTransactionInterceptor` | `connection.startSession()` 또는 위임된 `connection.transaction(...)`을 사용할 수 있을 때 활성 Mongoose session을 공유합니다. |

## 문맥 해석 규칙

| 규칙 | 현재 계약 | 소스 기준 |
| --- | --- | --- |
| 루트 vs ambient 핸들 | Prisma와 Drizzle은 `current()`를 통해 활성 트랜잭션 핸들이 있으면 그 값을, 없으면 루트 client/database를 반환합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts` |
| Mongoose 세션 접근 | Mongoose는 `current()`로 루트 연결을 유지하고, `currentSession()`으로 ambient 트랜잭션을 노출합니다. | `packages/mongoose/src/connection.ts` |
| 중첩 경계 재사용 | 이미 트랜잭션이 활성화되어 있으면 Prisma와 Drizzle은 새 경계를 열지 않고 현재 ALS 문맥을 재사용합니다. Mongoose도 같은 방식으로 현재 세션을 재사용합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| 중첩 옵션 제한 | Prisma와 Drizzle은 ambient 트랜잭션이 이미 활성화된 상태에서 중첩 트랜잭션 옵션을 허용하지 않습니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts` |
| strict 모드 | Prisma, Drizzle, Mongoose는 등록된 client/connection이 트랜잭션을 지원하지 않을 때 예외를 던지도록 설정할 수 있습니다. strict 모드가 아니면 트랜잭션 헬퍼는 직접 실행으로 폴백합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |

## 경계 의미론

| 경계 | 현재 동작 | 소스 기준 |
| --- | --- | --- |
| 수동 Prisma 경계 | `PrismaService.transaction(fn, options?)`는 `fn`을 `$transaction(...)` 내부에서 실행하고, `current()`가 사용할 트랜잭션 client를 ALS에 바인딩합니다. | `packages/prisma/src/service.ts` |
| 수동 Drizzle 경계 | `DrizzleDatabase.transaction(fn, options?)`는 `fn`을 `database.transaction(...)` 내부에서 실행하고, `current()`가 사용할 트랜잭션 database를 ALS에 바인딩합니다. | `packages/drizzle/src/database.ts` |
| 수동 Mongoose 경계 | `MongooseConnection.transaction(fn)`은 사용할 수 있으면 `connection.transaction(...)`에 위임합니다. 그렇지 않으면 session을 시작하고, `startTransaction()`을 호출하며, 성공 시 commit하고, 오류 시 abort하며, `finally`에서 session을 종료합니다. | `packages/mongoose/src/connection.ts` |
| 요청 범위 경계 | 세 가지 트랜잭션 인터셉터는 `requestTransaction(...)`으로 downstream HTTP 핸들러를 감싸며, `context.requestContext.request.signal`의 request abort signal을 사용합니다. | `packages/prisma/src/transaction.ts`, `packages/drizzle/src/transaction.ts`, `packages/mongoose/src/transaction.ts` |
| abort 처리 | Prisma와 Drizzle은 요청 범위 작업을 `raceWithAbort(...)`로 감싸고, 종료 정리를 위해 활성 request transaction을 추적합니다. Mongoose도 session 획득, 위임된 `connection.transaction(...)` 시작, session 기반 작업 주변에 같은 request-abort race를 적용합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| 종료 동작 | 활성 request transaction은 애플리케이션 종료 시 abort되고, settlement를 기다린 후 패키지별 disconnect 또는 dispose hook이 실행됩니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| 종료 진입 gate | Prisma와 Drizzle은 종료가 시작된 뒤 새 `requestTransaction(...)` 호출을 거부하여 disconnect/dispose가 늦게 시작된 요청 작업에 추월되지 않도록 합니다. Mongoose는 종료가 시작된 뒤 새 수동 `transaction(...)` 및 `requestTransaction(...)` 경계를 거부합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| 중첩 요청 추적 | Prisma는 기존 수동 트랜잭션 안에서 실행되는 중첩 `requestTransaction(...)` 호출을 바깥 수동 경계가 settle될 때까지 shutdown tracking에 남겨 둡니다. Drizzle도 중첩 수동 트랜잭션 request handle을 바깥 수동 경계가 settle될 때까지 shutdown settlement tracking에 남겨 두므로, shutdown은 `dispose(database)`를 실행하기 전에 그 바깥 경계까지 drain합니다. 단, platform status activity count는 더 좁게 계산됩니다. 중첩 request callback이 settle되는 즉시, 바깥 수동 경계가 계속 실행 중이어도 `details.activeRequestTransactions`는 감소합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts` |
| 중첩 요청 abort 전파 | Drizzle은 기존 요청 경계 안의 중첩 `requestTransaction(...)` 호출이 활성 transaction handle을 재사용하면서도 ambient request abort signal을 관찰하도록 합니다. | `packages/drizzle/src/database.ts` |

## 제약 사항

- 트랜잭션 참여가 필요한 경우, 레포지토리와 서비스 코드는 루트 client를 직접 고정하지 말고 `current()` 또는 `currentSession()`으로 persistence handle을 읽어야 합니다.
- Prisma 트랜잭션 지원은 `$transaction(...)`을 구현한 client에 의존합니다. 연결 라이프사이클 훅은 `$connect()`와 `$disconnect()`로 선택적으로 제공됩니다.
- Drizzle 트랜잭션 지원은 `transaction(...)`을 구현한 database 객체에 의존합니다. 정리는 등록된 `dispose` hook으로 선택적으로 수행됩니다.
- Mongoose 트랜잭션 지원은 위임된 `connection.transaction(...)` 또는 `startSession()`에 의존합니다. Mongoose 코드는 세션 조회가 ambient라 하더라도 모델 연산에 session을 명시적으로 전달해야 합니다.
- 롤백은 예외 기반입니다. Prisma와 Drizzle은 하위 transaction runner 의미론에 따르고, Mongoose는 `fn`이 예외를 던질 때 `abortTransaction()`을 명시적으로 호출합니다.
