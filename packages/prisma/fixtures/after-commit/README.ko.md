# Native afterCommit 수용 검증 (#3717)

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 private fixture는 Node.js 24에서 빌드된 `@fluojs/prisma`,
`@fluojs/drizzle`, `@fluojs/mongoose`의 공개 import를 실행합니다. 패키지를
빌드하거나 소스 alias를 사용하거나 workspace 의존성을 변경하지 않습니다.
Fluo 패키지 링크가 이 worktree의 `dist/index.js`를 가리키는지 테스트에서 검증합니다.
진입 파일 이름은 `acceptance.ts`이므로 일반 workspace Vitest 탐색이 DB 없이
실행하지 않습니다. `run.mjs`가 Node의 `--test` runner에 파일을 명시적으로 전달합니다.
Fixture typecheck는 workspace와 동일한 TypeScript 6.0.2를 사용하고, 로컬
`skipLibCheck` override 없이 저장소의 `tsconfig.base.json`을 상속합니다.
NodeNext 해석과 ES2024/Web API 타입은 native consumer 환경에 맞춥니다.

## 실행

먼저 worktree 담당자가 세 통합 패키지와 workspace 의존성을 빌드해야 합니다.
이 fixture의 고정 버전 의존성만 설치하고 Prisma client를 생성합니다.

```sh
cd packages/prisma/fixtures/after-commit
pnpm install --ignore-workspace --ignore-scripts --frozen-lockfile
pnpm run generate
pnpm run typecheck
docker pull postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685
docker pull mongo:8.0.20@sha256:098862b1339f031900ca66cf8fef799e616d6324fa41b9a263f2ec899552c1ef
pnpm test
```

별도의 upstream 선언 검사는
`pnpm exec tsc --noEmit --pretty false --skipLibCheck false`로 실행합니다.
이는 canonical consumer 검사가 아니며 native 실행을 차단해서는 안 됩니다.
Drizzle 0.45.2의 전체 dialect 선언 그래프에는 optional `gel` 타입 누락과
class/interface 선언 불일치가 있습니다. 이 검사의 0이 아닌 종료 코드와 전체
진단을 별도로 보존합니다. 관련 없는 driver를 설치하거나 canonical consumer
검사가 통과했다는 이유로 선언 검사도 통과했다고 처리하지 않습니다.

Runner에는 동작 중인 Docker server가 필요합니다. PostgreSQL 컨테이너 하나와
단일 멤버 Mongo replica set 하나를 생성하며, UUID 이름, 고유 DB,
loopback 전용 임시 host port, tmpfs 데이터 디렉터리를 사용합니다.
연결된 Docker 출력으로 readiness를 구독하고, replica set 초기화 전에
Mongo의 primary 전환 로그를 구독합니다. Readiness에는 실패 제한 시간이
있으며 sleep이나 probe polling을 사용하지 않습니다. 별도 DB 환경 변수나
공유 fixture 변경은 필요하지 않습니다.

Mongoose manual 경로는 실제 connection의 `startSession`과 `model`을 바인딩해
공개 manual-session 경계를 선택합니다. Native 메서드를 대체하거나 connection을
변경하지 않습니다. Delegated 경로는 native `connection.transaction`을 사용합니다.

## 수용 검증 항목

Prisma, Drizzle, Mongoose manual, Mongoose delegated 각각에서 다음을 검증합니다.

- 커밋 전 데이터는 root 읽기에 보이지 않습니다. Hook은 커밋 후 영속 데이터를
  확인하며 ambient transaction/session 없이 실행됩니다.
- 중첩 경계는 native handle을 공유하고 hook을 바깥 커밋까지 지연합니다.
  Hook 안에서 새 transaction과 그 transaction의 hook을 실행하고 커밋할 수 있습니다.
- Callback rollback과 바깥으로 전파된 중첩 실패는 쓰기와 hook을 폐기합니다.
- 바깥 owner가 중첩 애플리케이션 예외를 잡고 커밋하면 공유 쓰기와 등록된 hook은
  유지됩니다. 중첩 재사용은 savepoint가 아닙니다.
- 요청 성공은 hook 완료를 기다립니다. 명시적 callback barrier로 요청 취소를
  조율하고 타이밍에 의존하지 않고 native rollback을 확인합니다.
- Hook 실패는 패키지별 `AfterCommitError`를 반환합니다. 이는 `committed=true`와
  모든 settled 결과를 담은 `AggregateError`이며, 이후 hook도 실행되고
  커밋된 데이터는 남습니다.
- Callback 성공 뒤 native COMMIT이 실패하면 hook과 쓰기를 폐기합니다.
  PostgreSQL은 지연 외래 키 제약을, Mongo는 non-transient 오류 코드 2를 반환하는
  일회성 서버 `commitTransaction` failpoint를 사용합니다.
  Failpoint는 runner가 만든 private Mongo 컨테이너에서만 활성화합니다.

추가 delegated Mongoose 사례 두 개는 native `failCommand`와 command 이벤트를
사용합니다. Insert의 WriteConflict/TransientTransactionError에서는 callback을
두 번 실행하지만 성공한 시도의 hook만 실행합니다. UnknownTransactionCommitResult에서는
COMMIT을 두 번 실행하지만 callback과 hook은 각각 한 번만 실행합니다.
각 사례는 root 읽기로 영속 데이터를 확인하고 실제 시도 횟수를 출력하며,
sleep이나 driver 대체 없이 `finally`에서 failpoint를 해제합니다.

더 넓은 동시성, lifecycle, retry, 오류 행렬은 결정적인 unit suite가 담당합니다.
이 fixture는 실제 driver와 native commit 경계의 실행 증거를 제공합니다.

## 증거와 정리

`pnpm test`는 고유한 `.omo/issue-3717-native/run-*` receipt 경로, 실제 port/DB,
공개 import 경로, Node TAP 결과를 출력합니다. `commands.json`에는 각 명령,
출력, 종료 코드가 기록됩니다. 컨테이너 로그와 `result.json`에는 readiness,
이미지 식별 정보, 정리 결과가 보존됩니다. 성공하려면 테스트 프로세스와 정리가
모두 성공해야 합니다. Docker가 없다고 검증을 건너뛰지는 않습니다.

Runner는 자신이 생성에 성공한 컨테이너 이름과 해당 anonymous volume만
`finally`에서 제거합니다. 공유 컨테이너, 이미지, workspace 파일, 다른 실행의
receipt는 제거하지 않습니다. Fixture의 `generated/`와 `node_modules/`는
private ignored 산출물이며 fixture lockfile은 root lockfile과 분리됩니다.
