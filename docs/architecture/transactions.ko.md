# 트랜잭션 문맥 계약

<p><a href="./transactions.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 `@fluojs/prisma`, `@fluojs/drizzle`, `@fluojs/mongoose` 전반의 현재 트랜잭션 문맥 계약을 정의합니다.

## 지원되는 연동

| 패키지 | ambient 문맥 운반체 | 주요 접근 API | 요청 인터셉터 | 현재 지원 범위 |
| --- | --- | --- | --- | --- |
| `@fluojs/prisma` | `AsyncLocalStorage<TTransactionClient>` | 서비스의 `@Transaction()` | `PrismaTransactionInterceptor` | `$transaction(...)`을 사용할 수 있을 때 활성 Prisma interactive transaction client를 공유합니다. |
| `@fluojs/drizzle` | `AsyncLocalStorage<TTransactionDatabase>` | 서비스의 `@Transaction()` | `DrizzleTransactionInterceptor` | `database.transaction(...)`을 사용할 수 있을 때 활성 Drizzle transaction database handle을 공유합니다. |
| `@fluojs/mongoose` | `AsyncLocalStorage<MongooseSessionLike>` | 서비스의 `@Transaction()` | `MongooseTransactionInterceptor` | `connection.startSession()` 또는 위임된 `connection.transaction(...)`을 사용할 수 있을 때 활성 Mongoose session을 공유합니다. |

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
| Mongoose 세션 자동 바인딩 | Mongoose 연산은 자동으로 ambient 트랜잭션 세션을 첨부합니다. 명시적인 세션 전달은 고급 교차 연결 시나리오에서만 필요합니다. | `packages/mongoose/src/connection.ts` |
| 중첩 경계 재사용 | 이미 트랜잭션이 활성화되어 있으면 `@Transaction()`은 새 경계를 열지 않고 기존 경계를 재사용합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| 중첩 옵션 제한 | Prisma와 Drizzle은 ambient 트랜잭션이 이미 활성화된 상태에서 중첩 트랜잭션 옵션을 허용하지 않습니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts` |
| strict 모드 | 연동 패키지는 등록된 client/connection이 트랜잭션을 지원하지 않을 때 예외를 던지도록 설정할 수 있습니다. strict 모드가 아니면 트랜잭션 헬퍼는 직접 실행으로 폴백합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |

## 경계 의미론

| 경계 | 현재 동작 | 소스 기준 |
| --- | --- | --- |
| `@Transaction()` 경계 | 메서드를 패키지별 트랜잭션 러너로 감싸고 결과 클라이언트/세션을 ALS에 바인딩합니다. | `packages/prisma/src/service.ts`, `packages/drizzle/src/database.ts`, `packages/mongoose/src/connection.ts` |
| 수동 Prisma 경계 | `PrismaService.transaction(fn, options?)`는 `fn`을 `$transaction(...)` 내부에서 실행하고 트랜잭션 클라이언트를 ALS에 바인딩합니다. | `packages/prisma/src/service.ts` |
| 수동 Drizzle 경계 | `DrizzleDatabase.transaction(fn, options?)`는 `fn`을 `database.transaction(...)` 내부에서 실행하고 트랜잭션 데이터베이스를 ALS에 바인딩합니다. | `packages/drizzle/src/database.ts` |
| 수동 Mongoose 경계 | `MongooseConnection.transaction(fn)`은 `connection.transaction(...)`에 위임하거나 수동 `startTransaction()` 사이클을 관리합니다. | `packages/mongoose/src/connection.ts` |

## 요청 범위 호환성

| 패턴 | 동작 |
| --- | --- |
| 요청 범위 경계 | 트랜잭션 인터셉터는 요청 abort signal을 사용하여 downstream HTTP 핸들러를 `requestTransaction(...)`으로 감쌉니다. |
| 인터셉터 사용 | 레거시 호환성이 필요하거나, 서비스 수준의 제어 없이 모든 요청이 기본적으로 트랜잭션으로 동작해야 하는 경우에 유용합니다. |

## 고급 / 탈출구 (Escape Hatch)

| API | 목적 |
| --- | --- |
| `current()` / `currentSession()` | ambient 트랜잭션 핸들에 대한 수동 접근. 표준 레포지토리 패턴 밖에서 원시 영속성 클라이언트 접근이 필요한 경우에만 사용하세요. |
| 명시적 클라이언트 선택 | `@Transaction((self) => self.analyticsPrisma)`를 통해 트랜잭션 경계의 대상이 될 특정 영속성 클라이언트 인스턴스를 지정할 수 있습니다. |

## 제약 사항

- 트랜잭션 관리의 기본 경로는 `@Transaction()`을 통한 서비스 계층입니다.
- Mongoose 연산은 자동으로 ambient 트랜잭션 세션에 참여합니다. 표준 흐름에서 명시적인 세션 전달은 권장되지 않습니다.
- 롤백은 예외 기반입니다. `@Transaction()`으로 감싸진 메서드가 예외를 던지면 트랜잭션이 중단됩니다.
