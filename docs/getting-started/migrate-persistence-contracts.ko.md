# Persistence 계약 import 전환

<p><a href="./migrate-persistence-contracts.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 범위

공통 transaction boundary 타입·오류·rollback observation 선언의 canonical owner가
`@fluojs/persistence`로 이동합니다. 기존 public import는 제거하지 않으므로 consumer 수정은 필수가 아닙니다.
[트랜잭션 문맥 계약](../architecture/transactions.ko.md)이 공유 의미를,
각 ORM README가 실행 API와 driver 지원을 소유합니다.

## 선택적인 import 전환

```ts
// Existing imports remain valid.
import { AfterCommitError as ExistingAfterCommitError } from '@fluojs/core';
import { AfterCommitError, type TransactionBoundaryOptions } from '@fluojs/persistence';

const sameConstructor = ExistingAfterCommitError === AfterCommitError;
const boundary: TransactionBoundaryOptions<{ readonly ok: boolean }> = {
  shouldRollback: (result) => !result.ok,
};
```

Canonical package를 직접 import하면 `pnpm add @fluojs/persistence`로 직접 의존성을 선언합니다.
기존 core/ORM 오류 경로와 runtime root의 request-transaction helper 경로는 직접 재노출로 유지합니다.
Subclass wrapper나 경로별 오류 선언은 추가하지 않습니다.

## 유지되는 동작

Prisma/Drizzle native options와 마지막 Fluo boundary를 분리하고 Mongoose에는 native-options 인자를 추가하지 않습니다.
Strict/fail-open 기본값, nested owner 재사용, container·named registration·concurrent owner 격리는 그대로입니다.
Result 복구는 exact owner signal과 양의 native rollback 확인을 요구하며 native 오류 identity를 보존합니다.
Commit 및 cleanup 뒤 ALS 밖 FIFO hook drain, retry attempt 격리, cancellation과 shutdown drain도 그대로입니다.

## 소유권과 검증

Portable primitive의 Node builtin 부재는 ORM이나 driver의 새 host 지원 근거가 아닙니다.
Driver rollback observation·cleanup은 ORM에 남으며 Mongoose `connection?` 문맥과
직접 `AggregateError` 하위 클래스인 `AfterCommitCleanupError`도 유지됩니다.
`@fluojs/persistence/internal`은 first-party 조합 seam이며 application의 transaction runner가 아닙니다.
Diagnostics/status는 이 전환의 대상이 아니고 다른 신규 package를 요구하지 않습니다.

`packages/persistence/src/*.test.ts`와 `tooling/governance/after-commit-contract.test.ts`를 실행하세요.
실제 DB와 배포 import closure는 native fixture 및 `pnpm test:duplicate-module-safety`로 별도 확인합니다.
Local focused evidence, independent review, full local CI와 GitHub CI의 판정은 서로 대체하지 않습니다.
