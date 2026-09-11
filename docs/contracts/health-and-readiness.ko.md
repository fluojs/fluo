# Health와 Readiness 계약
<!-- fluo-terminus-contract: registration=application-owned-TerminusModule.forRoot;health=aggregated-diagnostics;ready-admission=binary;ready-body=ready|starting|unavailable;default-liveness=absent;unhealthy-status=503;route-protection=path-scoped-external-boundary;indicator-readiness=opt-out;readiness-checks=additive -->

<p><a href="./health-and-readiness.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 범위와 소유권

이 문서와 영어 대응 문서는 `@fluojs/terminus` 등록, runtime health 응답, HTTP readiness 판정의 canonical Docs owner입니다. [패키지 README](../../packages/terminus/README.ko.md)는 설치와 패키지별 API 사용법을 유지하고 이 계약을 요약합니다. [문서 권한 규칙](./documentation-authority.ko.md)에 따라 Book, CONTEXT, migration map의 설명은 이 owner를 따릅니다.

범위는 현재 checkout의 `@fluojs/terminus` 2.x와 `@fluojs/runtime` HTTP dispatcher입니다. Node.js 지원 범위는 package manifest의 `>=24.0.0 <27`입니다. Host-owned HTTP에서도 해당 host가 dispatcher를 연결해야 route에 도달할 수 있습니다. Root import가 안전하다는 사실은 모든 host에서 Node filesystem, process memory, Redis driver를 사용할 수 있다는 보장이 아닙니다. 이 문서는 배포된 최신 패키지나 외부 DB에서 실행 검증했다는 뜻이 아닙니다.

Terminus는 dependency 진단과 readiness 조건을 구성합니다. Socket listen, signal 등록, drain 시간, DB client 생성·종료, process 종료, orchestrator의 rotation·restart 정책을 소유하지 않습니다. 전체 시작·종료 계약은 [Lifecycle & Shutdown](../architecture/lifecycle-and-shutdown.ko.md)을 따릅니다.

## 사전 조건과 공개 import

- 기존 Fluo application module에 `TerminusModule.forRoot(...)`의 반환 module을 import합니다. Package 설치만으로 route나 indicator가 등록되지는 않습니다.
- Registry 기반 `generated-app`에서는 생성된 config·greeting 등록과 lifecycle script를 보존합니다. 새로 생성된 앱은 Terminus가 아니라 기본 `HealthModule.forRoot()`를 등록합니다. 같은 health/readiness 경로에 Terminus를 사용하려면 이 기본 등록을 `TerminusModule.forRoot(...)`로 교체하고 `path`, `endpointMiddleware` 같은 관련 endpoint 설정을 옮깁니다. Terminus는 자체 `HealthModule`을 생성하므로 같은 경로에 둘 다 유지하면 route가 중복 등록됩니다. 이미 Terminus를 사용하는 앱이라면 다른 등록을 추가하지 말고 기존 `TerminusModule.forRoot(...)` 등록을 확장합니다.
- Workspace 기반 `repository-example`은 저장소 의존성과 build 조건을 사용합니다. [Bootstrap Paths](../getting-started/bootstrap-paths.ko.md)의 환경 구분과 표준 decorator/`Symbol.metadata` 준비 순서를 따르며 생성 앱 위에 repository snapshot을 덮어쓰지 않습니다.
- `pnpm add @fluojs/terminus`로 설치합니다. Node memory/disk probe는 Node 환경과 대상 filesystem이 필요합니다. Redis, Prisma, Drizzle DI probe를 선택했을 때만 해당 integration package, driver, 연결 설정과 의존성을 소유한 module이 필요합니다. Custom callback은 자신이 접근하는 자원의 준비를 책임집니다.

| 공개 import 경로 | API와 역할 |
| --- | --- |
| `@fluojs/terminus` | `TerminusModule`, `TerminusHealthService`, `HealthCheckError`, `runHealthCheck`, `assertHealthCheck`; `HealthIndicator`, `HealthIndicatorResult`, `HealthIndicatorState`, `HealthCheckReport`, `HealthCheckExecutionOptions`, `TerminusModuleOptions` 타입 |
| `@fluojs/terminus` | `HttpHealthIndicator`, `PrismaHealthIndicator`, `DrizzleHealthIndicator` 및 각각의 `create*HealthIndicator`, `create*HealthIndicatorProvider`, `*HealthIndicatorOptions` |
| `@fluojs/terminus/node` | `MemoryHealthIndicator`, `DiskHealthIndicator` 및 각각의 factory, provider factory, option 타입. 호환성을 위해 root에서도 export합니다. |
| `@fluojs/terminus/redis` | `RedisHealthIndicator.create`, `createRedisHealthIndicatorProvider`, `RedisHealthIndicatorOptions`. Redis helper는 root export가 아닙니다. |
| `@fluojs/terminus` | `TERMINUS_HEALTH_INDICATORS`, `TERMINUS_INDICATOR_PROVIDER_TOKENS`: module이 export하는 indicator 집합과 provider token 목록 |
| `@fluojs/runtime` | `ReadinessCheck`: `(ctx: RequestContext) => boolean \| Promise<boolean>`; `HealthModule`은 Terminus가 내부에서 합성하는 runtime route facade입니다. |
| `@fluojs/core`, `@fluojs/http` | Application의 `Module`; endpoint middleware를 위한 `Middleware`, `MiddlewareContext`, `Next` 타입 등 |

내부 `TERMINUS_OPTIONS`, `createTerminusProviders`, `createTerminusModule`을 consumer API로 import하지 않습니다. Node listener helper의 공개 소유자는 `@fluojs/platform-nodejs`이며 `@fluojs/runtime/node`가 아닙니다.

## 등록 입력과 기본값

`TerminusModule.forRoot(options: TerminusModuleOptions = {}): ModuleType`은 동기적으로 module class를 반환합니다. 호출 완료는 DI bootstrap, indicator 실행, listener 활성화 완료를 뜻하지 않습니다.

| 입력 | 생략 시 동작과 적용 범위 |
| --- | --- |
| `imports?: readonly ModuleType[]` | `[]`. `indicatorProviders`가 사용하는 dependency export를 Terminus 자신의 module scope에 노출합니다. 부모 module의 sibling import만으로는 충분하지 않습니다. |
| `indicators?: readonly HealthIndicator[]` | `[]`. Application이 만든 instance를 먼저 등록합니다. `check(key: string): Promise<HealthIndicatorResult>`가 keyed `up`/`down` 상태를 반환해야 합니다. |
| `indicatorProviders?: readonly Provider[]` | `[]`. DI로 resolve한 indicator를 instance 목록 뒤에 추가합니다. 같은 built-in provider factory를 반복 호출해도 호출별 고유 token으로 유지됩니다. |
| `readinessChecks?: readonly ReadinessCheck[]` | `[]`. `/ready`에 추가되는 application 조건입니다. Indicator나 platform 조건을 대체하지 않습니다. |
| `path?: string` | `''`. 기본 `GET /health`, `GET /ready`; `/internal/`이면 정규화된 `/internal/health`, `/internal/ready`입니다. |
| `endpointMiddleware?: readonly Constructor<Middleware>[]` | `[]`, 기본 접근 제한 없음. DI로 resolve한 class가 선언 순서대로 위 두 경로에만 적용됩니다. |
| `execution.indicatorTimeoutMs?: number` | Service 차원의 timeout 없음. 양의 유한값은 내림한 millisecond로 사용하며 그 외 값은 timeout을 설정하지 않습니다. Positive integer를 명시하세요. 이 예산은 indicator 실행에만 적용되고 custom readiness callback이나 platform probe의 timeout이 아닙니다. |
| Indicator의 `key?: string` | 명시한 비어 있지 않은 key, 없으면 class 이름에서 유도한 key, 그것도 없으면 `indicator-N`을 사용합니다. 충돌을 피하려면 고유 key를 지정합니다. |
| Indicator의 `readiness?: boolean` | 생략 또는 `true`면 `/health`와 `/ready` 모두에 참여합니다. 정확히 `false`일 때만 `/ready`의 indicator 집합에서 제외합니다. 모든 built-in option도 이 설정을 받습니다. |

DI-backed dependency module은 `TerminusModule.forRoot({ imports: [ownerModule], indicatorProviders: [...] })`에 직접 넣거나 적절한 global export로 노출해야 합니다. Named Redis module은 scoped이므로 Terminus `imports`가 필요합니다. Redis provider의 `clientName` 생략은 default client, 지정은 named client를 뜻합니다. Prisma provider의 `name`도 default/named 등록을 선택하고, `serviceToken`/`clientToken`은 명시적 token 선택에 사용합니다. 구체적인 조합 예제는 [README의 DI 구성](../../packages/terminus/README.ko.md#의존성-모듈과-di-기반-인디케이터-조합하기)을 따릅니다.

### 선택적 probe

다음 probe는 자동 등록되지 않습니다. 필요한 class instance 또는 provider factory를 선택합니다. 모든 option 타입과 DI 예제는 [패키지 API](../../packages/terminus/README.ko.md#공개-api-개요)에 연결되며, 여기서는 probe 선택에 필요한 기본 동작을 고정합니다.

| Probe | 입력·기본값·결과 |
| --- | --- |
| HTTP | `url` 필수, `method: 'GET'`, 기본 허용 status `200..299`, `timeoutMs: 2_000`. `headers`와 `expectedStatus`(숫자, 숫자 배열, predicate)로 변경합니다. 결과에 `url`, `statusCode`, `responseTimeMs`를 포함하며 자체 timeout은 `fetch`를 abort합니다. |
| Memory | `memoryUsage`를 생략하면 Node memory sampler 사용. `heapUsedThresholdRatio: 0.95`; `heapUsedThresholdBytes`, `rssThresholdBytes` 제한은 기본 미설정입니다. 사용량이 byte 제한 이상이거나 `heapTotal > 0`에서 heap 비율 이상이면 실패합니다. |
| Disk | `path: '.'`, `minFreeRatio: 0.1`; `minFreeBytes` 기본 미설정. 가용 byte 또는 비율이 최소값 미만이면 실패하며 `freeBytes`, `totalBytes`, `freeRatio`, `path`를 보고합니다. `node:fs/promises`는 probe 시 lazy import합니다. |
| Prisma | `timeoutMs: 2_000`. DI provider는 lifecycle-aware service를 우선하고 snapshot 확인 후 `current()`의 client로 `SELECT 1`을 실행합니다. Raw client 또는 custom `ping`도 가능하지만 service 없는 probe에 lifecycle metadata가 생기지는 않습니다. |
| Drizzle | `timeoutMs: 2_000`, 기본 `query: 'select 1'`. DI provider는 lifecycle-aware handle provider를 우선하고 snapshot 확인 후 `current()`의 database를 probe합니다. Raw `database.execute`, custom `query`/`ping`도 지원합니다. |
| Redis | `timeoutMs: 2_000`. Client `status`를 platform snapshot으로 해석한 후 `PING`합니다. `wait`, `connecting`, `reconnecting`, `close`, `end`는 연결이 준비되지 않은 결과입니다. Custom `ping`도 가능하지만 lifecycle metadata에는 `client.status`가 필요합니다. |

Built-in HTTP/Prisma/Drizzle/Redis `timeoutMs`는 양의 유한값이어야 하며 내림 후 최소 `1` ms입니다. 잘못된 값은 check 중 실패로 보고합니다. 이는 invalid 값을 무시하는 service의 `execution.indicatorTimeoutMs`와 다른 입력 경계입니다.

## 결과와 readiness 판정

| 호출·endpoint | 결과와 완료 경계 |
| --- | --- |
| `TerminusHealthService.check(): Promise<HealthCheckReport>` | 현재 indicator 전체 실행이 완료되거나 설정된 timeout에 도달한 뒤 집계합니다. `checkedAt`은 집계 시점의 ISO 문자열, `status`는 `ok` 또는 `error`, `contributors.up/down`은 key 배열, `info/error/details`는 상태 map입니다. |
| `isHealthy(): Promise<boolean>` | 새 `check()`의 `status === 'ok'`. |
| `isReady(): Promise<boolean>` | `readiness !== false`인 indicator만 새로 검사합니다. Runtime marker, custom `readinessChecks`, platform readiness까지 검사하는 API는 아닙니다. |
| `runHealthCheck(indicators, executionOptions = {})` | `Promise<HealthCheckReport>`. 호출별 독립 실행 scope이며 호출 사이의 overlap을 serialize하지 않습니다. |
| `assertHealthCheck(report, message = 'Health check failed.')` | 정상 report 자체를 반환합니다. `status: 'error'`이면 `new HealthCheckError(message, report.error)`를 throw합니다. |
| `GET /health` | Service report, `platformShell.ready()`, `platformShell.health()`를 병렬로 수집합니다. 최종 report가 `ok`이면 `200`, 아니면 `503`이며 body에 `platform: { health, readiness }`를 포함합니다. Direct service/helper 결과에는 이 platform 합성이 없습니다. |
| `GET /ready` | Marker가 starting이면 `503`과 `{ status: 'starting' }`. Marker가 ready여도 조건 하나가 `false`이면 `503`과 `{ status: 'unavailable' }`. 모두 통과하면 `200`과 `{ status: 'ready' }`. |

HTTP readiness의 admission은 **binary**입니다. Body의 세 상태는 severity bucket이 아닙니다. Custom `readinessChecks`를 선언 순서대로 await하며 첫 `false`에서 중단합니다. 이 검사 뒤에 bootstrap hook이 등록한 Terminus 검사가 실행되어 indicator readiness와 platform readiness를 병렬로 확인합니다. Platform status가 정확히 `ready`여야 통과하므로 `critical: false`인 `degraded`도 HTTP `/ready`를 차단합니다.

`readiness: false`는 해당 indicator의 probe만 `/ready`에서 제외합니다. 같은 dependency가 별도 platform component로 등록되어 readiness를 실패시키면 gate는 여전히 실패합니다. 반대로 custom readiness 조건의 실패나 platform health만의 실패를 같은 조건으로 취급하지 않습니다. Custom readiness 조건은 `/health`에서 실행하지 않고, platform health가 unhealthy여도 platform readiness와 나머지 조건이 ready이면 `/ready`는 `200`일 수 있습니다.

### 범위가 명시된 module 예제

다음은 외부 서비스 없이 두 endpoint의 차이를 보여 주는 application module 조각입니다. `searchAvailable`과 `acceptingTraffic`은 설명용 application 상태이며 framework 설정 API가 아닙니다. 실행 host와 decorator 준비는 [Bootstrap Paths](../getting-started/bootstrap-paths.ko.md)에서 구성합니다.

```typescript
import { Module } from '@fluojs/core';
import { TerminusModule, type HealthIndicator } from '@fluojs/terminus';

let searchAvailable = false;
let acceptingTraffic = true;

const search: HealthIndicator = {
  key: 'search',
  readiness: false,
  async check(key) {
    return { [key]: { status: searchAvailable ? 'up' : 'down' } };
  },
};

@Module({
  imports: [
    TerminusModule.forRoot({
      indicators: [search],
      readinessChecks: [() => acceptingTraffic],
    }),
  ],
})
export class AppModule {}
```

Bootstrap와 platform readiness가 성공한 상태에서 초기 `/health`는 `503`, `status: 'error'`, `contributors.down: ['search']`이고 `/ready`는 `200`, `{ status: 'ready' }`입니다. Application이 `acceptingTraffic = false`로 바꾸면 `/ready`는 `503`, `{ status: 'unavailable' }`입니다. `search.readiness`를 생략한 구성은 search 실패만으로도 `/ready`가 `503`입니다. Deployment가 실제 rotation에서 제거하려면 이 HTTP 결과를 읽도록 probe를 설정해야 합니다.

## 시작·요청·종료 순서와 자원 소유자

1. Application이 module과 dependency instance/provider를 구성합니다. Runtime은 module graph 검증, container 생성, runtime token 등록, lifecycle instance resolve를 수행합니다.
2. Runtime은 health marker를 starting으로 설정하고 모든 `onModuleInit()` 다음 모든 `onApplicationBootstrap()`을 await합니다. Terminus의 bootstrap registrar는 이때 indicator/platform readiness 조건을 추가합니다.
3. `platformShell.start()`가 성공한 뒤 marker를 ready로 전환하고 dispatcher를 만듭니다. 아직 listener를 열었다는 뜻은 아닙니다. Bootstrap 실패 시 marker를 starting으로 되돌리고 `bootstrap-failed` cleanup 및 container disposal을 시도합니다.
4. HTTP 활성화는 adapter/host 경계입니다. `Application.listen()`은 `Application.ready()`의 platform gate 다음 adapter listen을 await하고 성공 후 public state를 `ready`로 바꿉니다. 이 startup gate는 Terminus indicator나 custom HTTP readiness callback을 실행하지 않으며 HTTP `/ready`와 동등하지 않습니다.
5. 각 probe 요청은 middleware 이후 위 endpoint 로직을 실행합니다. Indicator들은 한 집계 안에서 병렬 실행됩니다. 같은 service/container의 같은 indicator instance에 대한 미완료 probe가 있으면 새 요청은 겹쳐 실행하지 않고 `down`을 받습니다. Application container가 다르면 in-flight 상태도 독립적입니다.
6. Close 시작은 새 `Application.dispatch()`, provider 접근, listen 등 runtime 작업의 terminal admission gate를 닫습니다. 진행 중 listen 정리와 연결된 microservice close 뒤 parent teardown이 health marker를 starting으로 재설정하고 runtime cleanup callback, 역순 `onModuleDestroy()`, 역순 `onApplicationShutdown(signal)`, adapter close, container disposal 순서로 진행합니다. 이미 연결된 dispatcher/adapter에서 probe에 도달할 수 있는 동안 starting 응답이 관찰될 수 있지만 닫힌 listener를 통해 응답할 수 있다는 보장은 아닙니다.
7. Cleanup 실패 후에도 admission과 readiness는 재개되지 않습니다. 성공한 close만 public state를 `closed`로 바꿉니다. 명시적 close 재시도는 완료한 runtime phase를 건너뛰며 각 stage의 retry 규칙을 따릅니다. Host/adapter가 signal, drain 시간과 process 종료를 소유하고 dependency module이 자신이 소유한 client를 정리합니다. Terminus는 이 정책이나 자원 소유권을 대신하지 않습니다.

Timeout은 driver 작업 취소나 연결 복구를 보장하지 않습니다. HTTP indicator의 자체 abort와 달리 custom callback/DB driver는 계속 실행될 수 있고, service는 원래 probe가 settle할 때까지 overlap을 막습니다. 이후 요청은 다시 검사할 수 있지만 자동 retry loop, 결과 cache, runtime-active indicator graph 변경은 제공하지 않습니다.

## 실패 모드와 의도적 제한

| 조건 | 관찰 결과와 대응 |
| --- | --- |
| Indicator `down` 또는 일반 exception | `error/details`에 `down` diagnostic으로 집계하며 unhealthy `/health`는 HTTP `503`입니다. Readiness 참여 indicator이면 `/ready`도 unavailable입니다. |
| `HealthCheckError(message, causes)` | `causes`의 모든 entry를 `down`으로 정규화합니다. 원래 cause가 `up`이어도 실패가 정상 결과로 바뀌지 않습니다. |
| 빈 결과, non-object, 지원하지 않는 status, blank key | 조용히 버리지 않고 `down` diagnostic을 추가합니다. Multi-entry 결과의 정상 key도 보존합니다. |
| Duplicate result key | 먼저 등록된 결과를 보존하고 `*-duplicate-key-error`를 추가합니다. 필요하면 숫자 suffix로 diagnostic key를 구분합니다. |
| Platform health/readiness 실패와 user key 충돌 | `fluo-platform-health`, `fluo-platform-readiness`에 platform payload를 유지하고 `*-user-key-collision`을 추가합니다. `critical`은 진단 metadata이며 HTTP readiness severity가 아닙니다. |
| Timeout 또는 같은 instance의 미완료 probe | 해당 indicator는 `down`입니다. 새 overlapping probe를 시작하지 않으며 underlying 작업의 settle을 기다려 소유권을 해제합니다. |
| Redis dependency token 없음 | Module graph 검증 중 `MODULE_VISIBILITY_ERROR`로 bootstrap 실패합니다. 요청 시 health 저하로 미루지 않습니다. |
| Prisma/Drizzle token이 graph 전체에 없음 | Optional injection은 bootstrap을 허용하지만 실제 dependency나 custom probe도 없으면 indicator는 요청 시 `down`입니다. |
| Prisma/Drizzle token이 접근 불가능한 sibling에 존재 | Optional injection도 visibility를 우회하지 않으므로 `MODULE_VISIBILITY_ERROR`입니다. Owner module을 Terminus `imports`에 노출합니다. |
| Custom readiness callback throw/reject | Runtime readiness loop가 boolean 실패로 변환하지 않습니다. HTTP error 처리 경로로 전파되므로 application이 예상한 unavailable 조건은 `false`로 반환해야 합니다. Callback에 service indicator timeout도 적용되지 않습니다. |
| Endpoint 보호 없음 | 기본 endpoint는 unprotected입니다. `endpointMiddleware` 또는 path-scoped application/adapter middleware, network policy, deployment probe boundary에서 보호합니다. NestJS controller의 `@HealthCheck()`/`@UseGuards()` metadata를 이 route로 이전하지 않습니다. |
| Process-only liveness 필요 | 기본 별도 liveness route는 없습니다. Application/deployment 계층에서 좁은 의미의 probe를 정의합니다. `/health`를 process-only 검사로 재해석하지 않습니다. |

## 구현·테스트 근거와 관련 문서

| 검토 대상 | 구현 | 실행 근거 |
| --- | --- | --- |
| Module 등록, `503`, platform 합성, readiness opt-out와 additive 조건 | [module.ts](../../packages/terminus/src/module.ts), [types.ts](../../packages/terminus/src/types.ts) | [module.test.ts](../../packages/terminus/src/module.test.ts): healthy/failing endpoint, opt-out, custom checks, non-critical degraded readiness, shutdown, reserved-key collision |
| Report, exception 정규화, timeout·overlap | [health-check.ts](../../packages/terminus/src/health-check.ts), [errors.ts](../../packages/terminus/src/errors.ts) | [health-check.test.ts](../../packages/terminus/src/health-check.test.ts), [request-regressions.test.ts](../../packages/terminus/src/request-regressions.test.ts) |
| DI visibility와 선택적 dependency | [Prisma](../../packages/terminus/src/indicators/prisma.ts), [Drizzle](../../packages/terminus/src/indicators/drizzle.ts), [Redis](../../packages/terminus/src/indicators/redis.ts) | [module-sibling-composition.test.ts](../../packages/terminus/src/module-sibling-composition.test.ts), [Prisma](../../packages/terminus/src/indicators/prisma.test.ts), [Drizzle](../../packages/terminus/src/indicators/drizzle.test.ts), [Redis](../../packages/terminus/src/indicators/redis.test.ts) |
| HTTP/Node probe 기본값 | [HTTP](../../packages/terminus/src/indicators/http.ts), [Memory](../../packages/terminus/src/indicators/memory.ts), [Disk](../../packages/terminus/src/indicators/disk.ts) | [HTTP](../../packages/terminus/src/indicators/http.test.ts), [Memory](../../packages/terminus/src/indicators/memory.test.ts), [Disk](../../packages/terminus/src/indicators/disk.test.ts) |
| Runtime marker, startup gate, close admission과 순서 | [health.ts](../../packages/runtime/src/health/health.ts), [bootstrap.ts](../../packages/runtime/src/bootstrap.ts), [platform-shell.ts](../../packages/runtime/src/platform-shell.ts) | [health.test.ts](../../packages/runtime/src/health/health.test.ts), [application.test.ts](../../packages/runtime/src/application.test.ts), [platform-shell.test.ts](../../packages/runtime/src/platform-shell.test.ts) |
| 공개 export와 import 경계 | [package.json](../../packages/terminus/package.json), [index.ts](../../packages/terminus/src/index.ts), [node.ts](../../packages/terminus/src/node.ts), [redis.ts](../../packages/terminus/src/redis.ts) | [public-surface.test.ts](../../packages/terminus/src/public-surface.test.ts), [public-subpaths.test.ts](../../packages/terminus/src/public-subpaths.test.ts), [root-import-runtime-safety.test.ts](../../packages/terminus/src/root-import-runtime-safety.test.ts) |
| Contract sentinel과 regression guard | [Terminus guard](../../tooling/governance/terminus-runtime-health-contract.mjs), [source guard](../../tooling/governance/terminus-runtime-health-source-contract.mjs) | [terminus-runtime-health-contract.test.ts](../../tooling/governance/terminus-runtime-health-contract.test.ts) |

저장소 의존성이 준비된 workspace root에서 관련 검증을 실행할 수 있습니다. 아래 명령은 검증 방법이며 실행 receipt가 아닙니다. Request test의 in-process dispatcher 검증은 배포 환경의 network policy나 실제 DB 연결 검증을 대신하지 않습니다.

```bash
pnpm exec vitest run packages/terminus/src packages/runtime/src/health/health.test.ts tooling/governance/terminus-runtime-health-contract.test.ts
```

- [NestJS Migration Map](../getting-started/migrate-from-nestjs.ko.md): controller-owned health check에서 module 구성으로 전환하는 경계.
- [Ops Metrics/Terminus 예제](../../examples/ops-metrics-terminus/src/app.ts): 실제 module 등록과 endpoint middleware 구성.
- [1권 23장](../../book/01-fluoblog/ch23-lifecycle-and-readiness.ko.md): 제품의 lifecycle/readiness 적용. [이전 판 health 장](../../book/beginner/ch18-health.ko.md)은 계속 참고 자료로 접근할 수 있으며 canonical owner는 이 Docs입니다.
