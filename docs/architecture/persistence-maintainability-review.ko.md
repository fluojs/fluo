# Persistence 유지보수성 판정 기록

<p><a href="./persistence-maintainability-review.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 범위와 기준

[#3950](https://github.com/fluojs/fluo/issues/3950)의 공통 transaction 정책과 ORM 실행 책임을
`d34494e9f6c00a29bd63c6dbb71dc722bdd695d0`에서 확인했다. 이 문서는 해당 checkout의
유지보수성 판정과 실행 근거이며, 새 행동 계약이나 API 안내가 아니다.
기준은 [CONTRIBUTING](../../CONTRIBUTING.md), [행동 계약 정책](../contracts/behavioral-contract-policy.ko.md),
[트랜잭션 문맥 계약](./transactions.ko.md), [import migration](../getting-started/migrate-persistence-contracts.ko.md),
네 패키지의 README/README.ko.md이다.

모든 대상 패키지는 **유지** 판정이다. 확인한 공통 정책은 이미 persistence 원본을
사용한다. 추가로 옮길 동일 정책의 잔여 중복을 확인하지 못했으므로 source/test 변경을
만들지 않았다. 개선은 흩어진 구현·회귀·실행 근거를 아래의 package별 판정으로 연결해
후속 수정 시 공통 정책 owner와 adapter 자원 owner를 구분할 수 있게 한 것이다.
정책의 수정 지점 수가 줄었다거나 성능이 향상되었다고 주장하지 않는다.

이 기록은 전수 감사나 최신 registry 배포 검증이 아니다. Deno 전용 경로, 지원 제거
#3938, 새 runtime/driver 지원, Foundation 변경은 범위 밖이다.
기존 계약 설명·package README·Book은 바뀌지 않으므로 Book 수정도 필요하지 않다.

## Package별 판정과 근거

### @fluojs/persistence: 공통 정책 owner 유지

`packages/persistence/src/transaction.ts`는 공통 boundary 타입과 오류 constructor 원본,
`src/result-rollback.ts`는 `evaluateResult`, `ResultBoundary`, `observeRollback`,
`src/after-commit.ts`는 순차 FIFO settlement,
`src/request-transaction.ts`는 abort forwarding과 active-work 등록·제거·settlement를 소유한다.
`src/index.ts`와 `src/internal.ts`, `package.json`은 portable root/internal 경계를 분리하고
production dependency나 eager Node builtin을 요구하지 않는다.

`src/result-rollback.test.ts`는 predicate 생략, 첫 nested 실패의 sticky 상태, root/nested
값 identity, exact owner signal과 양의 rollback 확인, native 실패 identity, attempt 격리를
검증한다. `src/after-commit.test.ts`는 실패 뒤에도 모든 FIFO hook을 settle하고,
`src/request-transaction.test.ts`는 abort reason identity, listener 제거, 등록 제거 후 settlement를 검증한다.

공통 policy의 수정 위치는 이미 하나다. ALS, connection/session, native runner, ORM brand,
diagnostics와 cleanup을 여기에 추가하면 portable policy가 adapter 실행 수명에 결합된다.
이 패키지는 자원이나 transaction을 생성하지 않으며 그 경계를 유지한다.

### @fluojs/drizzle: adapter 실행 책임 유지

`packages/drizzle/src/result-rollback.ts`와 `src/after-commit.ts`는 persistence 원본을
재노출하고 `src/database.ts`는 그 primitive를 소비한다.
`src/transaction.ts`의 explicit accessor와 legacy `this.db` -> 직접 property -> 중첩 `.db`
-> decorated instance 순서, native options 위치는 Drizzle 계약이다.
`src/database-brand.ts`는 non-enumerable owner/version과 complete consumed surface를 검사하며,
`src/facade.ts`는 wrapper 및 native delegate의 receiver를 각각 보존한다.

`src/database.ts`의 callback registration scope, native owner의 child settlement drain,
닫힌 ALS continuation의 새 root, status activity와 shutdown settlement는 서로 다른 수명이다.
특히 nested request의 status count 감소와 outer native settlement 대기를 합치면
진단 또는 disposal 순서가 달라진다. `src/rollback-observer.ts`의 SQL rollback과 pooled release
관찰은 node-postgres 자원 책임이므로 공통 cleanup helper로 옮기지 않는다.

`src/result-rollback.test.ts`는 query-isolated copy owner/decorator, 원래 값, native option
identity와 위치, sticky nested 실패, native 오류, attempt 격리를 검증한다.
`src/after-commit.test.ts`는 commit/hook barrier로 FIFO·scope closure·shutdown drain을,
`src/module.test.ts`, `src/public-api.test.ts`, `src/published-artifact-surface.test.ts`,
`src/vertical-slice.test.ts`는 registration·facade·공개 artifact·service/request 흐름을 검증한다.
Bun async-driver 예외 기반 지원을 Node-scoped Result/after-commit 보장으로 확대하지 않는다.

### @fluojs/mongoose: session 실행과 cleanup 책임 유지

`packages/mongoose/src/result-rollback.ts`와 `src/after-commit.ts`의 공통 오류는
persistence 원본이다. Mongoose의 `AfterCommitCleanupError`는 `AggregateError` 직접
하위 클래스이며 cleanup-first `errors`, cleanup `cause`, hook-only `results`를 보존한다.
이는 일반 `AfterCommitError`와 같은 정책이 아니다.

`src/transaction.ts`는 explicit accessor를 우선하고 legacy `this.conn` -> decorated instance
-> 고유한 중첩 `this.*.conn` 탐색과 다중 후보 오류를 유지한다.
`src/connection-brand.ts`의 complete surface에는 `currentSession`과 `model`도 포함된다.
`src/connection.ts`는 delegated/manual session, callback drain 뒤 abort/endSession,
model/saveDocument의 native option·session 처리를 소유한다.
Raw connection 생성·model compilation·close는 application-owned이며 설정된 dispose만 실행한다.
`src/rollback-observer.ts`는 session-owning connection과 transaction/request/connection command를
연결한다. Missing/pending command, local state 또는 writeConcernError는 양의 rollback 확인이 아니다.

`src/result-rollback.test.ts`, `src/result-rollback-decorator.test.ts`,
`src/result-rollback-retry.test.ts`, `src/result-rollback-cleanup.test.ts`,
`src/after-commit.test.ts`는 manual/delegated 결과·retry·cleanup·hook 순서를 검증한다.
`src/module.test.ts`, `src/public-api.test.ts`, `src/vertical-slice.test.ts`는 module와
service 경계를 검증한다. 기존 `module.test.ts`의 `vi.waitFor`는 이번에 수정하지 않았다.
새 polling이나 고정 sleep을 추가하지 않았다. Mongoose native-options 인자도 추가하지 않는다.

### @fluojs/prisma: client 실행과 attempt 책임 유지

`packages/prisma/src/result-rollback.ts`와 `src/after-commit.ts`는 공통 원본을 재노출한다.
`src/transaction.ts`의 explicit accessor, unambiguous compatible-owner discovery,
compatibility overload와 native-options/boundary 분리는 다른 ORM의 discovery와 같지 않다.
`src/prisma-service-brand.ts`는 versioned owner와 complete surface를 검사하고
`src/service.ts`의 facade는 native delegate receiver를 보존한다.

`src/service.ts`는 ALS unavailable 실패, native signal-option 거부 시 callback 실행 전
fallback, callback attempt의 owner/hook queue 격리, connect/disconnect drain을 소유한다.
`src/rollback-observer.ts`는 adapter-pg의 SQL ROLLBACK과 adapter cleanup 둘 다 요구한다.
`src/integration.ts`가 공통 request helper를 재노출하더라도 Prisma 실행을 persistence로
이전하거나 새 runtime 의존성을 만들 이유가 되지 않는다.

`src/result-rollback.test.ts`는 query-isolated copy와 native options·Result identity를,
`src/after-commit.test.ts`는 hook 순서와 capability 실패를,
`src/module.test.ts`는 ALS 부재와 lifecycle·registration 격리를 검증한다.
`src/public-api.test.ts`는 cold-built public import와 declaration의 제거된 API 부재를,
`src/vertical-slice.test.ts`는 실제 HTTP 경계를 포함한 service/request 흐름을 검증한다.
Native observer·retry·cleanup은 Prisma 자원/attempt에 연결되므로 일반 adapter 기반 클래스로 합치지 않는다.

## 실제 실행 결과

2026-10-12 UTC에 `/Users/ayden/Documents/fluo/.worktrees/issue-3950`에서 Node.js `v24.20.0`,
pnpm `10.4.1`로 실행했다. Source head는 위 기준 SHA이며 변경은 이 독립 EN/KO 보고서뿐이다.
Ignored `.omo/evidence/issue-3950.json`은 최종 commit SHA, 명령별 출력·시간·exit code와
실제 존재하는 로컬 로그를 연결한다. 이 supporting evidence는 checkout 밖에 보존해야 한다.

| 실행 명령 | 관찰 결과 | Exit code / 시간 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 62 workspace, 787 packages 설치; lockfile 변경 없음 | 0 / pnpm 보고 3.2 s |
| `pnpm -r --filter '@fluojs/persistence...' --filter '@fluojs/drizzle...' --filter '@fluojs/mongoose...' --filter '@fluojs/prisma...' run build` | 14-package dependency closure 통과; 아래 최초 실패 뒤 같은 closure 재빌드도 통과 | 0 / 재빌드 wall 7.21 s |
| `pnpm vitest run --project packages packages/persistence/src/ packages/drizzle/src/ packages/mongoose/src/ packages/prisma/src/ --no-file-parallelism` | 41 files, 495 tests 통과; suite inventory는 persistence 3, Drizzle 12, Mongoose 13, Prisma 13으로 zero-match 없음 | 0 / wall 39.64 s, Vitest 39.19 s |
| `pnpm vitest run --project tooling tooling/governance/after-commit-contract.test.ts` | 공통 오류 identity 및 Prisma/Drizzle/Mongoose manual/delegated boundary double 53 tests 통과 | 0 / wall 1.70 s |
| `pnpm -r --filter @fluojs/persistence --filter @fluojs/drizzle --filter @fluojs/mongoose --filter @fluojs/prisma run typecheck` | 네 package typecheck 통과; emitted build 종료 뒤 실행 | 0 / wall 1.49 s |
| `pnpm exec biome lint packages/persistence/src packages/drizzle/src packages/mongoose/src packages/prisma/src` | 86 files 확인, 수정·억제 없음 | 0 / wall 0.95 s |
| `node --input-type=module -e` (아래 smoke) | `PERSISTENCE_IMPORT_IDENTITY_PASS` | 0 / wall 0.13 s |
| `pnpm verify:platform-consistency-governance` | `Platform consistency governance checks passed.` | 0 / wall 2.93 s |
| `pnpm vitest run --project tooling tooling/governance/verify-platform-consistency-governance.test.ts` | 475 tests 통과 | 0 / wall 2.49 s |
| `pnpm verify:changeset-release-lane --lane stable --base-ref d34494e9f6c00a29bd63c6dbb71dc722bdd695d0` | stable gate 통과; 기존 104 pending package bump intents, package version delta 0 | 0 / wall 0.22 s |

Wall 시간은 `/usr/bin/time -p`로 측정했다. 최초 build의 전체 wall 시간은 측정하지 않았고
package별 build 시간이 원본 로그에 있다. 위 7.21 s는 별도로 실행한 재빌드 시간이다.
Vitest global setup의 Terminus/Prisma emitted-artifact build와 Drizzle artifact suite의
cold build는 검사 전제조건이며 full local CI가 아니다.

Smoke의 정확한 입력:

```sh
node --input-type=module -e "import assert from 'node:assert/strict'; import * as p from './packages/persistence/dist/index.js'; import * as i from './packages/persistence/dist/internal.js'; import * as d from './packages/drizzle/dist/index.js'; import * as m from './packages/mongoose/dist/index.js'; import * as r from './packages/prisma/dist/index.js'; for (const x of [d,m,r]) for (const k of ['AfterCommitCapabilityError','AfterCommitError','TransactionRollbackCapabilityError','TransactionRollbackOnlyError','TransactionRollbackUnconfirmedError']) assert.equal(x[k],p[k]); for (const k of ['ResultBoundary','evaluateResult','observeRollback','settleAfterCommitCallbacks']) assert.equal(typeof i[k],'function'); assert.equal('ResultBoundary' in p,false); console.log('PERSISTENCE_IMPORT_IDENTITY_PASS');"
```

### 실패와 실행 순서 조정

Source 수정 전 기본 file-parallel focused 명령은 두 번 모두 Prisma
`src/public-api.test.ts:148`에서 실패했다: 40 files/494 tests 통과, 1 file/1 test 실패,
exit 1, wall 38.79 s 및 33.03 s였다.
진단은 `Cannot find module '@fluojs/diagnostics' or its corresponding type declarations.`이다.
Drizzle `src/published-artifact-surface.test.ts`의 `beforeAll`이 같은 checkout의
dependency closure를 cold build하면서 공용 dist를 지운다. 동시에 Prisma declaration
검사가 실행되는 기존 test harness 경쟁을 확인했다.

Emitted rebuild와 겹쳐 시작한 첫 typecheck도 같은 TS2307로 exit 2, wall 1.81 s였다.
Prerequisites 재빌드 뒤 Prisma public-api 단독 실행은 6 tests, exit 0, wall 22.78 s로
통과했다. 이후 **같은 41 suites를 누락 없이 직렬 실행**하고 typecheck를 그 뒤에 실행해
위 통과 결과를 얻었다. 테스트·source·설정을 바꾸거나 실패를 skip하지 않았다.
실패 출력은 evidence에 발췌로 보존하고, 발췌를 전체 로그라고 표현하지 않는다.

## 미실행 범위와 release 영향

Native transaction policy, observer, attempt lifetime, cleanup source가 바뀌지 않아
PostgreSQL/MongoDB native fixture와 별도 upstream declaration audit는 실행하지 않았다.
Double 통과는 durable rows나 실제 DB rollback 성공 증거가 아니다.
Brand/public import closure 또는 Drizzle ALS/exception/shutdown source도 바뀌지 않아
`pnpm test:duplicate-module-safety`와 Bun conformance는 조건부 미실행이다.
Package source 미변경으로 `pnpm verify:public-export-tsdoc`도 조건부 미실행이다.

`pnpm verify:local`, `pnpm verify:release-readiness` 및 `--skip-build` 변형은 실행하지 않았다.
후자는 전체 tests/sandbox를 실행하므로 수정된 preflight에 따라 제외했다.
중단된 full-CI run이나 full-CI PASS receipt는 없다.
최종 PR exact-head GitHub CI와 선택된 독립 review는 lead의 후속 stage이며 여기서 통과를 주장하지 않는다.

변경 파일은 root `docs/architecture/persistence-maintainability-review.md`와 `.ko.md`뿐이다.
네 package의 published `files: ["dist"]`, source, exports, manifests, lockfile, release metadata는
그대로다. 이 보고서는 package artifact에 포함되지 않고 공개 행동·API·package contents를
바꾸지 않으므로 CONTRIBUTING의 docs-only 정책에 따라 Changeset과 version bump가 필요 없다.
Portable import graph에 새 Node builtin·ORM 의존성도 추가되지 않는다.
