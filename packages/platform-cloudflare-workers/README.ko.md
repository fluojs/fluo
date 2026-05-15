# @fluojs/platform-cloudflare-workers

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

엣지에 최적화된 fluo 런타임용 Cloudflare Workers HTTP 어댑터 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
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

이 어댑터는 dispatcher가 binding된 뒤 각 요청 수명주기를 `executionContext.waitUntil(...)`에 연결하고, `close()` 중에도 진행 중인 디스패치를 유지하여 Worker 종료 도중 활성 작업이 중간에 잘리지 않도록 보장합니다.

애플리케이션 종료 중에는 즉시 새 ingress 수락을 중단하고, 활성 HTTP 핸들러가 정리될 수 있도록 최대 10초의 bounded drain window를 제공합니다. 이 시간을 넘기면 `close()`는 무기한 대기하지 않고 timeout 오류로 종료됩니다. 해당 drain이 아직 진행 중일 때 동시에 `listen()`을 호출하면 Worker를 다시 열지 않고 `Cloudflare Workers adapter cannot listen while shutdown is still draining.` 오류로 reject됩니다. 닫힌 뒤에는 어댑터가 명시적으로 다시 `listen()`될 때까지 후속 HTTP 및 WebSocket upgrade request가 동일한 JSON `503` shutdown response를 받습니다.

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
어댑터는 `@fluojs/websockets/cloudflare-workers` 바인딩을 통해 실시간 통신을 위한 Cloudflare의 네이티브 `WebSocketPair`를 지원합니다. Upgrade handling은 해당 binding을 통한 opt-in이며, non-hosted runtime test에서는 `createWebSocketPair`를 주입할 수 있습니다.

```typescript
@WebSocketGateway({ path: '/ws' })
export class MyGateway {}
```

### 엣지 네이티브 미들웨어
표준 fluo 미들웨어(CORS, Global Prefix 등)가 완전히 지원되며 Cloudflare 환경에 최적화되어 있습니다.

```typescript
const adapter = createCloudflareWorkerAdapter({
  globalPrefix: 'api/v1',
  cors: true,
});
```

### 동작 참고

- `fetch()`는 `listen()` 또는 lazy entrypoint가 dispatcher를 binding한 뒤 active work를 `executionContext.waitUntil(...)`에 등록합니다. 그 lifecycle boundary 전에는 upgrade request와 HTTP dispatch가 application handler에 도달하지 않습니다.
- WebSocket upgrade는 HTTP dispatch와 같은 listen boundary가 소유합니다. `listen()` 전의 upgrade request는 설정된 binding에 도달하지 않습니다.
- `close()`는 shutdown 중 및 shutdown 이후 새 요청에 JSON `503` response를 반환하고, active request가 끝나지 않으면 10초 뒤 timeout됩니다. 해당 close drain이 아직 활성 상태일 때 `listen()`을 호출하면 Cloudflare Workers adapter shutdown-draining 오류로 reject됩니다.
- Multipart request는 `rawBody`를 보존하지 않습니다.
- Worker `env` 객체는 fetch entrypoint boundary를 통과하며, package-level config resolution은 application이 소유합니다.

## Conformance 커버리지

`packages/platform-cloudflare-workers/src/adapter.test.ts`는 문서화된 Worker 계약을 검증하는 package-local regression 대상입니다. 이 파일은 shared Web dispatch delegation, `executionContext.waitUntil(...)` 등록, websocket upgrade binding, listen-bound upgrade ownership, lazy entrypoint 재사용, shutdown gating, drain 중 `listen()` rejection, close 중 및 close 이후 JSON `503` response, bounded 10초 close timeout을 검증합니다.

공유 edge portability suite인 `packages/testing/src/portability/web-runtime-adapter-portability.test.ts`는 Cloudflare Workers를 Bun 및 Deno와 함께 실행해 malformed cookie 보존, query decoding, JSON/text raw-body capture, multipart raw-body 제외, SSE framing을 검증합니다. 패키지 테스트의 README parity assertion은 이 edge-runtime 커버리지 문서가 한국어 mirror와 계속 동기화되도록 확인합니다.

## 공개 API 개요

- `createCloudflareWorkerAdapter(options)`: Worker HTTP 어댑터를 위한 팩토리입니다.
- `createCloudflareWorkerEntrypoint(module, options)`: 지연 부트스트랩 방식의 Worker 엔트리포인트를 생성합니다.
- `bootstrapCloudflareWorkerApplication(module, options)`: Worker를 위한 비동기 부트스트랩 헬퍼입니다.
- `CloudflareWorkerHttpApplicationAdapter`: 핵심 어댑터 구현 클래스입니다.
- `CloudflareWorkerHandler`: Worker application wrapper와 lazy entrypoint가 공유하는 fetch handler interface입니다.
- `CloudflareWorkerApplication`: `adapter`, `app`, `fetch(...)`, `close(...)`를 제공하는 fully bootstrapped Worker application wrapper입니다.
- `CloudflareWorkerEntrypoint`: `fetch`, `ready()`, `close()` lifecycle method를 제공하는 lazy entrypoint입니다.
- Option 및 type: `CloudflareWorkerAdapterOptions`, `BootstrapCloudflareWorkerApplicationOptions`, `CloudflareWorkerExecutionContext`, `CloudflareWorkerWebSocketBinding`, Worker websocket pair/upgrade type.

## 관련 패키지

- `@fluojs/runtime`: 핵심 런타임입니다.
- `@fluojs/websockets`: 전용 서브패스 `@fluojs/websockets/cloudflare-workers`를 포함합니다.
- `@fluojs/http`: 공통 HTTP 데코레이터 계층입니다.

## 예제 소스

- `packages/platform-cloudflare-workers/src/adapter.test.ts`
- `packages/websockets/src/cloudflare-workers/cloudflare-workers.test.ts`
