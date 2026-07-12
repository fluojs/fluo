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

## 주요 패턴

### WebSocketPair 활용
어댑터는 `@fluojs/websockets/cloudflare-workers` 바인딩을 통해 실시간 통신을 위한 Cloudflare의 네이티브 `WebSocketPair`를 지원합니다. Upgrade handling은 해당 binding을 통한 opt-in이며, non-hosted runtime test에서는 `createWebSocketPair`를 주입할 수 있습니다. Binding은 `listen()`이 Worker dispatch boundary를 시작하기 전에 설정하세요. `listen()`이 한 번 실행된 뒤에는 해당 adapter instance의 binding identity가 frozen됩니다. 이미 public listen boundary를 지난 isolate 아래에서 upgrade ownership이 바뀌지 않도록, `close()` 이후에도 binding을 교체하거나 해제하려는 시도는 reject됩니다.

```typescript
@WebSocketGateway({ path: '/ws' })
export class MyGateway {}
```

### 엣지 네이티브 미들웨어
표준 fluo 미들웨어(CORS, Global Prefix 등)는 Worker bootstrap helper를 통해 완전히 지원되며 Cloudflare 환경에 최적화되어 있습니다. `createCloudflareWorkerAdapter(...)`는 adapter가 소유하는 parsing 및 websocket-pair 옵션만 받습니다. Routing 및 middleware 옵션은 `bootstrapCloudflareWorkerApplication(...)` 또는 `createCloudflareWorkerEntrypoint(...)`에 전달하세요.

```typescript
const worker = createCloudflareWorkerEntrypoint(AppModule, {
  globalPrefix: 'api/v1',
  cors: true,
});
```

### 동작 참고

- `fetch()`는 `listen()` 또는 lazy entrypoint가 dispatcher를 binding한 뒤 active work를 `executionContext.waitUntil(...)`에 등록합니다. Upgraded server WebSocket은 terminal `close` event까지 해당 lifecycle과 close drain을 유지하고, SSE(`text/event-stream`) response는 body가 끝나거나 cancel될 때까지 이를 유지합니다. SSE reader 또는 tracked-stream setup이 동기적으로 실패하면 오류를 전파하기 전에 lifecycle을 release합니다. 그 lifecycle boundary 전에는 upgrade request와 HTTP dispatch가 application handler에 도달하지 않습니다.
- `maxBodySize` 같은 adapter option은 Worker adapter 생성 시 검증됩니다. `globalPrefix`, `cors`, `middleware`, `securityHeaders` 같은 bootstrap 전용 옵션은 `createCloudflareWorkerAdapter(...)`가 아니라 Worker bootstrap helper에 전달해야 합니다.
- WebSocket upgrade는 HTTP dispatch와 같은 listen boundary가 소유합니다. `listen()` 전의 upgrade request는 설정된 binding에 도달하지 않으며, adapter가 한 번이라도 listen한 뒤 defined binding을 교체하거나 해제하려는 시도는 Worker upgrade ownership을 바꾸는 대신 빠르게 실패합니다. 다른 websocket binding이 필요하면 새 adapter를 생성하세요.
- `close()`는 shutdown 중 및 shutdown 이후 새 HTTP 및 WebSocket upgrade request에 JSON `503` response를 반환하고, active request가 끝나지 않으면 10초 뒤 timeout됩니다. 해당 close drain이 아직 활성 상태일 때 `listen()`을 호출하면 Cloudflare Workers adapter shutdown-draining 오류로 reject됩니다. Lazy entrypoint는 adapter의 underlying drain이 나중에 끝나면 이 timeout을 영구적으로 캐시하지 않습니다.
- Multipart request는 `rawBody`를 보존하지 않습니다.
- Worker `env` 객체는 각 `FrameworkRequest`에 `request.cloudflare.env`로 연결되고 Worker execution context는 `request.cloudflare.executionContext`로 제공됩니다. Package-level config resolution은 application이 소유하므로, binding은 application boundary에서 명시적 provider 또는 `@fluojs/config`로 매핑하세요.

## Lifecycle 및 public seam 참고

Root `@fluojs/platform-cloudflare-workers` export는 application code와 first-party Worker websocket integration이 사용하는 Worker public seam을 소유합니다. `CloudflareWorkerExecutionContext`, `CloudflareWorkerRequestContext`, `CloudflareWorkerWebSocketBinding`, `CloudflareWorkerWebSocketPair`, `CloudflareWorkerWebSocketPairFactory`, `CloudflareWorkerWebSocketUpgradeHost`, `CloudflareWorkerWebSocketUpgradeResult` 같은 Worker-specific public type은 consumer가 `@fluojs/http/internal` 또는 `@fluojs/runtime/internal*` subpath를 import하지 않아도 되도록 이 패키지에서 export됩니다.

위의 listen, shutdown, SSE drain, websocket binding 규칙은 public lifecycle behavior입니다. 이러한 public seam type 또는 lifecycle semantic을 바꾸는 변경은 `@fluojs/platform-cloudflare-workers` release governance 대상이며, user-impacting update는 implementation, docs, tests와 함께 Changesets로 추적해야 합니다.

## Conformance 커버리지

`packages/platform-cloudflare-workers/src/adapter.test.ts`와 `packages/platform-cloudflare-workers/src/adapter-lifecycle.test.ts`는 문서화된 Worker 계약을 검증하는 package-local regression 대상입니다. 이 파일들은 shared Web dispatch delegation, Worker `env` request attachment, `executionContext.waitUntil(...)` SSE(`text/event-stream`) body tracking, body-cancellation 및 synchronous setup-failure drain, websocket upgrade binding, upgraded server-socket close tracking, pre-listen HTTP 및 websocket lifecycle guard, listen boundary 이후 websocket binding freeze, lazy entrypoint 재사용 및 timeout recovery, shutdown gating, drain 중 `listen()` rejection, HTTP와 websocket upgrade 모두에 대한 close 중 및 close 이후 JSON `503` response, reliable fake-timer cleanup, public seam source import, README parity, bounded 10초 close timeout을 검증합니다.

공유 edge portability suite인 `packages/testing/src/portability/web-runtime-adapter-portability.test.ts`는 Cloudflare Workers를 Bun 및 Deno와 함께 실행해 malformed cookie 보존, query decoding, JSON/text raw-body capture, multipart raw-body 제외, SSE framing을 검증합니다. 패키지 테스트의 README parity assertion은 이 edge-runtime 커버리지 문서가 한국어 mirror와 계속 동기화되도록 확인합니다.

## 공개 API 개요

- `createCloudflareWorkerAdapter(options)`: Worker HTTP 어댑터를 위한 팩토리입니다.
- `createCloudflareWorkerEntrypoint(module, options)`: 지연 부트스트랩 방식의 Worker 엔트리포인트를 생성합니다.
- `bootstrapCloudflareWorkerApplication(module, options)`: Worker를 위한 비동기 부트스트랩 헬퍼입니다.
- `CloudflareWorkerHttpApplicationAdapter`: 핵심 어댑터 구현 클래스입니다.
- `CloudflareWorkerHandler`: Worker application wrapper와 lazy entrypoint가 공유하는 fetch handler interface입니다.
- `CloudflareWorkerApplication`: `adapter`, `app`, `fetch(...)`, `close(...)`를 제공하는 fully bootstrapped Worker application wrapper입니다.
- `CloudflareWorkerEntrypoint`: `fetch`, `ready()`, `close()` lifecycle method를 제공하는 lazy entrypoint입니다.
- Option 및 type: `CloudflareWorkerAdapterOptions`, `BootstrapCloudflareWorkerApplicationOptions`, `CloudflareWorkerExecutionContext`, `CloudflareWorkerRequestContext`, `CloudflareWorkerWebSocketBinding`, `CloudflareWorkerWebSocketBindingHost`, `CloudflareWorkerWebSocket`, `CloudflareWorkerWebSocketMessage`, `CloudflareWorkerWebSocketPair`, `CloudflareWorkerWebSocketPairFactory`, `CloudflareWorkerWebSocketUpgradeHost`, `CloudflareWorkerWebSocketUpgradeResult`.

## 관련 패키지

- `@fluojs/runtime`: 핵심 런타임입니다.
- `@fluojs/websockets`: 전용 서브패스 `@fluojs/websockets/cloudflare-workers`를 포함합니다.
- `@fluojs/http`: 공통 HTTP 데코레이터 계층입니다.

## 예제 소스

- `packages/platform-cloudflare-workers/src/adapter.test.ts`
- `packages/websockets/src/cloudflare-workers/cloudflare-workers.test.ts`
