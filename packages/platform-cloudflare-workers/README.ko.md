# @fluojs/platform-cloudflare-workers

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

엣지에 최적화된 fluo 런타임용 Cloudflare Workers HTTP 어댑터 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [Lifecycle 및 public seam 참고](#lifecycle-및-public-seam-참고)
- [Conformance 커버리지](#conformance-커버리지)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/platform-cloudflare-workers
```

이 패키지는 Cloudflare Workers에서 실행하는 것을 전제로 합니다. 배포 manifest는 npm 메타데이터가 Workers 런타임 계약과 어긋나지 않도록 의도적으로 `engines.node`를 선언하지 않으며, 저장소의 Node.js 20+ 요구사항은 메인테이너용 빌드/테스트 툴체인에만 적용됩니다.

## 사용 시점

fluo 애플리케이션을 [Cloudflare Workers](https://workers.cloudflare.com/)에 배포할 때 이 패키지를 사용합니다. 이 어댑터는 서버리스 엣지 환경에 맞게 설계되었으며, Worker isolate 제약 조건과 네이티브 Web API를 준수하는 가벼운 `fetch` 기반 어댑터를 제공합니다.

이 어댑터는 dispatcher가 binding된 뒤 각 요청 수명주기를 `executionContext.waitUntil(...)`에 연결하고, `close()` 중에도 진행 중인 디스패치, terminal close까지의 upgraded server WebSocket, SSE(`text/event-stream`) response body를 유지하여 Worker 종료 도중 활성 작업이 중간에 잘리지 않도록 보장합니다.

애플리케이션 종료 중에는 즉시 새 ingress 수락을 중단하고, 활성 HTTP 핸들러가 정리될 수 있도록 최대 10초의 bounded drain window를 제공합니다. 이 시간을 넘기면 `close()`는 무기한 대기하지 않고 timeout 오류로 종료됩니다. 해당 drain이 아직 진행 중일 때 동시에 `listen()`을 호출하면 Worker를 다시 열지 않고 `Cloudflare Workers adapter cannot listen while shutdown is still draining.` 오류로 reject됩니다. 닫힌 뒤에는 어댑터가 명시적으로 다시 `listen()`될 때까지 후속 HTTP 및 WebSocket upgrade request가 동일한 JSON `503` shutdown response를 받습니다. Lazy entrypoint는 timed-out close가 아직 drain 중인 동안 shutdown response를 계속 반환하지만, underlying close가 나중에 settle되면 해당 임시 gate를 해제하여 이후 request가 새 Worker application을 bootstrap할 수 있게 합니다.

## 빠른 시작

### 표준 어댑터 사용
애플리케이션을 부트스트랩하고 표준 Cloudflare Worker `fetch` 핸들러를 내보냅니다.

```typescript
import { fluoFactory } from '@fluojs/runtime';
import { createCloudflareWorkerAdapter } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app.module';

const adapter = createCloudflareWorkerAdapter();
const app = await fluoFactory.create(AppModule, { adapter });

await app.listen();

export default {
  fetch: (req, env, ctx) => adapter.fetch(req, env, ctx),
};
```

### 지연 엔트리포인트 (Zero-Config)
첫 번째 요청 시 부트스트랩을 수행하는 엔트리포인트 헬퍼를 사용하여 설정을 더욱 간소화할 수 있습니다.

```typescript
import { createCloudflareWorkerEntrypoint } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app.module';

const worker = createCloudflareWorkerEntrypoint(AppModule);

export default {
  fetch: worker.fetch,
};
```

### close 소유권과 lazy 재시작

Cloudflare Workers는 exported `fetch` 핸들러에 host가 호출하는 shutdown callback을 제공하지 않습니다. NestJS shutdown hook을 마이그레이션할 때는 application-owned close trigger를 선택하세요. `worker.fetch` 호출 밖에서 실행되는 out-of-band lifecycle trigger는 `await worker.close()`를 직접 호출할 수 있습니다. 같은 `worker.fetch` 호출 안에서 처리되는 management route는 `close()`를 await하지 않고 현재 response를 반환한 뒤 `executionContext.waitUntil(worker.close())` 또는 동등한 non-self-awaiting mechanism으로 close를 관찰해야 합니다. 그렇지 않으면 `close()`가 자기 자신의 active request drain을 기다리다 shutdown timeout에 도달합니다. `worker.fetch`만 export한다고 해서 close 호출이 마련되지는 않습니다.

성공한 `worker.close()`는 의도적으로 재시작 가능합니다. 현재 lazy application을 해제하며, 이후의 `worker.fetch(...)`는 isolate 안에서 새 application을 bootstrap하여 bootstrap lifecycle hook을 다시 실행하고 application singleton provider를 다시 생성합니다. `close()`를 terminal Worker shutdown signal로 취급하지 마세요. Application에 terminal behavior가 필요하면 해당 상태를 명시적으로 소유하고 강제해야 합니다.

### Env-aware 지연 엔트리포인트
첫 번째 Worker `env`로 root module 또는 bootstrap option을 선택해야 하면 `createCloudflareWorkerEnvEntrypoint(...)`를 사용하세요. 이 factory는 isolate마다 module registration 전에 한 번 실행되고, 결과 application은 이후 request에서 재사용됩니다.

```typescript
import { createCloudflareWorkerEnvEntrypoint } from '@fluojs/platform-cloudflare-workers';
import { createAppModule } from './app.module';

interface WorkerEnv {
  API_PREFIX: string;
  DB: D1Database;
}

const worker = createCloudflareWorkerEnvEntrypoint<WorkerEnv>((env) => ({
  rootModule: createAppModule({ database: env.DB }),
  options: {
    globalPrefix: env.API_PREFIX,
  },
}));

export default {
  fetch: worker.fetch,
};
```

같은 이유로 `worker.ready(env)`도 명시적 `env`를 요구합니다. 첫 번째로 제공한 environment가 singleton bootstrap configuration을 결정하며, 이후 request environment는 `request.cloudflare.env`에 계속 연결되지만 cache된 application을 재구성하지는 않습니다. Bootstrap configuration을 첫 Worker request 전에 이미 사용할 수 있으면 기존 `createCloudflareWorkerEntrypoint(module, options)`를 사용하세요.

표준 `createCloudflareWorkerEntrypoint(...)`의 request-bound `env` 경로에서는 fetch-time binding으로 `ConfigModule.forRoot(...)` 또는 singleton bootstrap provider를 구성할 수 없습니다. Request별 binding을 읽고 검증한 뒤 좁혀서 application-shaped 값으로 provider method에 전달하세요. 첫 environment가 module registration 전에 application을 구성해야 할 때만 env-aware entrypoint를 선택하세요.

## 주요 패턴

### Early Hints 미지원

Workers `Response` API는 final response 이전 informational response를 request handler에서 write하는 primitive를 제공하지 않으므로 `context.response.earlyHints`가 없습니다. 사용 전에 capability 존재 여부를 확인하세요. Early Hints를 생성할 수 있는 Cloudflare deployment/cache feature는 host configuration이며 Fluo response writer로 노출되지 않습니다.

### 스트리밍 멀티파트 소비

애플리케이션 bootstrap에서 `multipart: { strategy: 'stream' }`을 설정하면 멀티파트 데이터를 점진적으로
받습니다. 멀티파트 route에서 `RequestContext.request.body`는 `AsyncIterableIterator<MultipartPart>`입니다.
field part는 `kind: 'field'`, `name`, `value`, `headers`를, file part는 `kind: 'file'`, `name`, `filename`,
`contentType`, `headers`, 그리고 `stream`의 single-consumer `ReadableStream<Uint8Array>`를 제공합니다. 다음
part를 요청하기 전에 각 file stream을 끝까지 소비하거나 cancel하세요.

Runtime route dispatch는 route를 위해 만든 iterator를 소유하며 handler가 끝난 뒤 자동으로 `return()`을 호출해
active source를 cancel하고 release합니다. Standalone `parseMultipartStream(...)` consumer는 이 책임을 직접
집니다. iterator를 끝까지 소비하거나 일찍 끝낼 때 `return()`을 호출하세요.

### 바이트 범위와 캐시 검증

Workers는 fetch dispatch를 통해 공유 `@fluojs/http` 단일 byte-range 및 `If-Range` contract를 보존합니다. Conditional-request 평가가 cache validator를 선택한 뒤 유효한 `Range: bytes=` 요청은 portable `206` identity-byte response를 만들고, `If-Range`는 선택된 validator를 재사용합니다. Malformed 또는 multi-range field는 전체 response를 유지하고 충족 불가능한 range는 body 없는 `416`을 만들며, `HEAD`는 stream을 소비하지 않고 GET metadata를 반영합니다.

### WebSocketPair 활용
어댑터는 `@fluojs/websockets/cloudflare-workers` 바인딩을 통해 실시간 통신을 위한 Cloudflare의 네이티브 `WebSocketPair`를 지원합니다. Upgrade handling은 해당 binding을 통한 opt-in이며, non-hosted runtime test에서는 `createWebSocketPair`를 주입할 수 있습니다. Binding은 `listen()`이 Worker dispatch boundary를 시작하기 전에 설정하세요. `listen()`이 한 번 실행된 뒤에는 해당 adapter instance의 binding identity가 frozen됩니다. 이미 public listen boundary를 지난 isolate 아래에서 upgrade ownership이 바뀌지 않도록, `close()` 이후에도 binding을 교체하거나 해제하려는 시도는 reject됩니다.

```typescript
import { Module } from '@fluojs/core';
import {
  CloudflareWorkersWebSocketModule,
  WebSocketGateway,
} from '@fluojs/websockets/cloudflare-workers';

@WebSocketGateway({ path: '/ws' })
export class EdgeGateway {}

@Module({
  imports: [CloudflareWorkersWebSocketModule.forRoot()],
  providers: [EdgeGateway],
})
export class RealtimeModule {}
```

Bootstrap 전에 application module graph에 `RealtimeModule`을 import하세요. Application bootstrap 중 `CloudflareWorkersWebSocketModule`이 gateway를 발견하고 `app.listen()`이 binding을 freeze하기 전에 versioned realtime capability를 통해 Worker adapter binding을 설치합니다. `configureWebSocketBinding()`은 compatibility facade로 유지됩니다. Listen boundary 이후에는 binding을 추가하거나 교체하지 마세요.

### 엣지 네이티브 미들웨어
표준 fluo 미들웨어(CORS, Global Prefix 등)는 Worker bootstrap helper를 통해 완전히 지원되며 Cloudflare 환경에 최적화되어 있습니다. `createCloudflareWorkerAdapter(...)`는 adapter가 소유하는 parsing 및 websocket-pair 옵션만 받습니다. Routing 및 middleware 옵션은 `bootstrapCloudflareWorkerApplication(...)` 또는 `createCloudflareWorkerEntrypoint(...)`에 전달하세요.

```typescript
const worker = createCloudflareWorkerEntrypoint(AppModule, {
  globalPrefix: 'api/v1',
  cors: true,
});
```

### 동작 참고

- Public concrete `CloudflareWorkerHttpApplicationAdapter.fetch(request, env, executionContext)` 계약은 Worker `executionContext`를 필수로 요구합니다. Direct caller는 모든 HTTP, SSE, WebSocket ingress가 `executionContext.waitUntil(...)`에 active work를 등록하도록 실제 세 번째 `ctx` 인수를 전달해야 합니다. Migration: direct two-argument adapter call을 `adapter.fetch(request, env, ctx)`로 바꾸세요.
- `fetch()`는 `listen()` 또는 lazy entrypoint가 dispatcher를 binding한 뒤 active work를 `executionContext.waitUntil(...)`에 등록합니다. Upgraded server WebSocket은 terminal `close` event까지 해당 lifecycle과 close drain을 유지하고, SSE(`text/event-stream`) response는 body가 끝나거나 cancel될 때까지 이를 유지합니다. SSE reader 또는 tracked-stream setup이 동기적으로 실패하면 오류를 전파하기 전에 lifecycle을 release합니다. 그 lifecycle boundary 전에는 upgrade request와 HTTP dispatch가 application handler에 도달하지 않습니다.
- `maxBodySize` 같은 adapter option은 Worker adapter 생성 시 검증됩니다. `globalPrefix`, `cors`, `middleware`, `securityHeaders` 같은 bootstrap 전용 옵션은 `createCloudflareWorkerAdapter(...)`가 아니라 Worker bootstrap helper에 전달해야 합니다.
- WebSocket upgrade는 HTTP dispatch와 같은 listen boundary가 소유합니다. `listen()` 전의 upgrade request는 설정된 binding에 도달하지 않으며, adapter가 한 번이라도 listen한 뒤 defined binding을 교체하거나 해제하려는 시도는 Worker upgrade ownership을 바꾸는 대신 빠르게 실패합니다. 다른 websocket binding이 필요하면 새 adapter를 생성하세요.
- `close()`는 shutdown 중 및 shutdown 이후 새 HTTP 및 WebSocket upgrade request에 JSON `503` response를 반환하고, active request가 끝나지 않으면 10초 뒤 timeout됩니다. 해당 close drain이 아직 활성 상태일 때 `listen()`을 호출하면 Cloudflare Workers adapter shutdown-draining 오류로 reject됩니다. Lazy entrypoint는 adapter의 underlying drain이 나중에 끝나면 이 timeout을 영구적으로 캐시하지 않습니다.
- Worker `fetch(...)` dispatch path는 body를 포함하는 RFC `QUERY` route와 `PURGE` 같은 uppercase extension method를 보존하며, method token과 parsed body는 동일한 fetch dispatch seam을 통해 등록된 route에 도달합니다.
- Multipart request는 `rawBody`를 보존하지 않습니다.
- Worker `env` 객체는 각 `FrameworkRequest`에 `request.cloudflare.env`로 연결되고 Worker execution context는 `request.cloudflare.executionContext`로 제공됩니다. `bootstrapCloudflareWorkerApplication(...)`은 exported `fetch(...)`가 traffic을 처리하기 전에 module registration을 완료합니다. `createCloudflareWorkerEntrypoint(...)`는 미리 선언한 root module과 option을 유지하므로 fetch-time `env`는 request dispatch 중에만 연결됩니다. 첫 명시적 Worker environment가 module registration 전에 root module 또는 final bootstrap option을 선택해야 하면 opt-in `createCloudflareWorkerEnvEntrypoint(...)`를 사용하세요. 이 API의 `ready(env)`는 environment를 요구하고 결과 application을 isolate마다 한 번 cache하며 이후 request로 재구성하지 않습니다. 어느 경로든 의도적으로 request별인 binding에는 request-bound `request.cloudflare.env`를 사용하세요.

## Lifecycle 및 public seam 참고

Root `@fluojs/platform-cloudflare-workers` export는 application code와 first-party Worker websocket integration이 사용하는 Worker public seam을 소유합니다. `CloudflareWorkerExecutionContext`, `CloudflareWorkerRequestContext`, `CloudflareWorkerWebSocketBinding`, `CloudflareWorkerWebSocketPair`, `CloudflareWorkerWebSocketPairFactory`, `CloudflareWorkerWebSocketUpgradeHost`, `CloudflareWorkerWebSocketUpgradeResult` 같은 Worker-specific public type은 consumer가 `@fluojs/http/internal` 또는 `@fluojs/runtime/internal*` subpath를 import하지 않아도 되도록 이 패키지에서 export됩니다.

위의 listen, shutdown, SSE drain, websocket binding 규칙은 public lifecycle behavior입니다. 이러한 public seam type 또는 lifecycle semantic을 바꾸는 변경은 `@fluojs/platform-cloudflare-workers` release governance 대상이며, user-impacting update는 implementation, docs, tests와 함께 Changesets로 추적해야 합니다.

<!-- fluo-contract: realtime-capability -->
```json
{
  "closeOwnership": {
    "inFetchManagement": "wait-until",
    "outOfBand": "await",
    "restart": "restartable"
  },
  "realtimeCapability": {
    "bindingInstallationVersion": 1,
    "contract": "raw-websocket-expansion",
    "kind": "fetch-style",
    "mode": "request-upgrade",
    "support": "supported",
    "version": 1
  }
}
```

## Conformance 커버리지

`packages/platform-cloudflare-workers/src/adapter.test.ts`와 `packages/platform-cloudflare-workers/src/adapter-lifecycle.test.ts`는 문서화된 Worker 계약을 검증하는 package-local regression 대상입니다. 이 파일들은 shared Web dispatch delegation, Worker `env` request attachment, `executionContext.waitUntil(...)` SSE(`text/event-stream`) body tracking, body-cancellation 및 synchronous setup-failure drain, websocket upgrade binding, upgraded server-socket close tracking, pre-listen HTTP 및 websocket lifecycle guard, listen boundary 이후 websocket binding freeze, zero-config 및 env-aware lazy entrypoint 재사용, 명시적 env-aware readiness, timeout recovery, shutdown gating, drain 중 `listen()` rejection, HTTP와 websocket upgrade 모두에 대한 close 중 및 close 이후 JSON `503` response, reliable fake-timer cleanup, public seam source import, structured realtime capability contract, bounded 10초 close timeout을 검증합니다.

공유 edge portability suite인 `packages/testing/src/portability/web-runtime-adapter-portability.test.ts`는 Cloudflare Workers를 Bun 및 Deno와 함께 실행해 conditional request, single-byte range 및 `If-Range`, body를 포함하는 `QUERY` 및 `PURGE` fetch dispatch, malformed cookie 보존, query decoding, JSON/text raw-body capture, multipart raw-body 제외, SSE framing을 검증합니다. 패키지 테스트는 두 README locale의 structured realtime capability contract를 parse하고 machine-consumed value를 adapter capability와 비교합니다.

## 공개 API 개요

- `createCloudflareWorkerAdapter(options)`: Worker HTTP 어댑터를 위한 팩토리입니다.
- `createCloudflareWorkerEntrypoint(module, options)`: 지연 부트스트랩 방식의 Worker 엔트리포인트를 생성합니다.
- `createCloudflareWorkerEnvEntrypoint(factory)`: 첫 명시적 Worker environment에서 지연 Worker 엔트리포인트를 생성합니다.
- `bootstrapCloudflareWorkerApplication(module, options)`: Worker를 위한 비동기 부트스트랩 헬퍼입니다.
- `CloudflareWorkerHttpApplicationAdapter`: 핵심 어댑터 구현 클래스입니다.
- `CloudflareWorkerHandler`: Worker application wrapper와 lazy entrypoint가 공유하는 fetch handler interface입니다.
- `CloudflareWorkerApplication`: `adapter`, `app`, `fetch(...)`, `close(...)`를 제공하는 fully bootstrapped Worker application wrapper입니다.
- `CloudflareWorkerEntrypoint`: `fetch`, `ready()`, `close()` lifecycle method를 제공하는 lazy entrypoint입니다.
- `CloudflareWorkerEnvEntrypoint`: `fetch`, `ready(env)`, `close()` lifecycle method를 제공하는 env-aware lazy entrypoint입니다.
- Option 및 type: `CloudflareWorkerAdapterOptions`, `BootstrapCloudflareWorkerApplicationOptions`, `CloudflareWorkerEnvBootstrap`, `CloudflareWorkerEnvEntrypointFactory`, `CloudflareWorkerExecutionContext`, `CloudflareWorkerRequestContext`, `CloudflareWorkerWebSocketBinding`, `CloudflareWorkerWebSocketBindingHost`, `CloudflareWorkerWebSocket`, `CloudflareWorkerWebSocketMessage`, `CloudflareWorkerWebSocketPair`, `CloudflareWorkerWebSocketPairFactory`, `CloudflareWorkerWebSocketUpgradeHost`, `CloudflareWorkerWebSocketUpgradeResult`.

## 관련 패키지

- `@fluojs/runtime`: 핵심 런타임입니다.
- `@fluojs/websockets`: 전용 서브패스 `@fluojs/websockets/cloudflare-workers`를 포함합니다.
- `@fluojs/http`: 공통 HTTP 데코레이터 계층입니다.

## 예제 소스

- `packages/platform-cloudflare-workers/src/adapter.test.ts`
- `packages/websockets/src/cloudflare-workers/cloudflare-workers.test.ts`
