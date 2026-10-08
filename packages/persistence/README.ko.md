# @fluojs/persistence

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

구체 ORM과 독립적인 트랜잭션 boundary 계약과 조합 가능한 policy primitive입니다.
이 패키지는 connection, session, ALS, native transaction을 생성하지 않습니다.
공통 트랜잭션 의미의 owner는 [트랜잭션 문맥 계약](../../docs/architecture/transactions.ko.md)입니다.

## 설치

```bash
pnpm add @fluojs/persistence
```

Core, runtime, HTTP, diagnostics, ORM 또는 driver 의존성과 eager Node builtin이 없습니다.
Package-wide `engines.node`를 선언하지 않는 portable primitive이며, 구체 ORM의 host·driver 지원 범위를 넓히지 않습니다.

## 공개 API

| Export | 계약 |
| --- | --- |
| `AfterCommitCallback` | `() => void \| Promise<void>`인 commit 후 작업 |
| `TransactionBoundaryOptions<T>` | 선택적인 `requireAfterCommit`과 application-owned `shouldRollback(value)` |
| `AfterCommitCapabilityError`, `AfterCommitError` | native commit capability 부재와 commit 뒤 hook 실패; 후자는 `committed=true` 및 모든 FIFO `results` 보존 |
| `TransactionRollbackCapabilityError`, `TransactionRollbackOnlyError`, `TransactionRollbackUnconfirmedError` | capability 부재, 첫 nested failure의 `result`, 양의 native rollback 확인 부재 |
| `TransactionRollbackObservation`, `TransactionRollbackObserver` | `confirmRollback()`의 양의 확인, `run(callback)`, `beginAttempt(transaction, connection?)` |
| `RequestAbortContext`, `ActiveRequestTransaction`, `ActiveRequestTransactionHandle` | caller signal 연결과 owner별 active-work settlement |
| `createRequestAbortContext`, `trackActiveRequestTransaction`, `untrackActiveRequestTransaction` | 이유 identity를 보존한 abort forwarding, listener cleanup, set 등록·제거 및 promise settlement |

`@fluojs/persistence/internal`은 first-party ORM 조합용 `ResultBoundary`,
`RollbackOwner`, `evaluateResult`, `observeRollback`, `settleAfterCommitCallbacks`를 제공합니다.
Application의 transaction 실행 API는 각 ORM 패키지에 남습니다.

## 사용 예

기존 Prisma wrapper를 전달받는 service fragment입니다. 구체 client 및 rollback observer 등록은
[Prisma API](../prisma/README.ko.md#반환값으로-롤백-선택)를 따릅니다.

```ts
import type { TransactionBoundaryOptions } from '@fluojs/persistence';

type PublishResult = { readonly ok: boolean };
const boundary: TransactionBoundaryOptions<PublishResult> = {
  requireAfterCommit: true,
  shouldRollback: (result) => !result.ok,
};
```

이 boundary는 Prisma/Drizzle의 마지막 인자이고 Mongoose에서는 native-options 인자 없이
`transaction(fn, boundary)` 또는 `requestTransaction(fn, signal, boundary)`로 전달합니다.
Callback과 반환 타입·native option 위치는 바뀌지 않습니다.

## 기본값과 소유권

두 option은 기본적으로 생략됩니다. Failure-shaped 값만으로 rollback을 추론하지 않습니다.
Predicate가 실패값을 선택하면 nested owner는 첫 실패값을 sticky rollback-only로 유지합니다.
Root 실패값 복구에는 정확한 owner signal과 양의 native rollback 확인이 모두 필요합니다.
Native commit·rollback·cleanup 오류는 원래 identity로 전파합니다.

After-commit 등록은 열린 동일 native callback scope에서 동기적으로 이루어집니다.
성공한 outer commit과 해당 cleanup settlement 뒤, 종료된 ALS 밖에서 FIFO 순서로 모든 hook을 await합니다.
Rollback·실패한 commit·폐기된 retry attempt의 hook은 실행하지 않습니다.
Hook 실패는 commit을 취소하거나 native retry를 유발하지 않습니다.

ORM은 native observer, callback attempt 수명, connection/session, shutdown admission과 drain을 소유합니다.
Mongoose observer의 `connection?`은 session-owning connection 문맥이며
`AfterCommitCleanupError`는 Mongoose-owned `AggregateError` 직접 하위 클래스입니다.
Drizzle status 활동 수명과 shutdown settlement를 합치지 않습니다.
새 savepoint, retry, durability, outbox, exactly-once 또는 DB+Redis atomicity를 제공하지 않습니다.

## 기존 import 호환

Core 및 ORM root의 기존 공통 오류·boundary 타입은 이 패키지 원본을 직접 재노출합니다.
동일 dependency instance의 constructor equality와 `instanceof`는 유지됩니다.
Runtime root의 기존 request-transaction helper도 그대로 재노출됩니다.
[Migration 안내](../../docs/getting-started/migrate-persistence-contracts.ko.md)는 선택적인 canonical import 전환을 설명합니다.
사본 호환 인식은 각 wrapper의 transaction state를 병합하지 않습니다.

## 검증 근거

`src/result-rollback.test.ts`, `src/request-transaction.test.ts`, `src/after-commit.test.ts`는 공통 primitive를 검증합니다.
`tooling/governance/after-commit-contract.test.ts`는 기존 root와 canonical constructor identity를 비교합니다.
실제 DB 관찰은 [native fixture](../prisma/fixtures/after-commit/README.ko.md)가 담당합니다.
목표 파일이나 명령을 나열한 것만으로 실행 통과를 주장하지 않습니다. 각 실행 로그와 receipt를 확인하세요.
