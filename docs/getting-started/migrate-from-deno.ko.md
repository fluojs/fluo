# Deno에서 이전하기

<p><a href="./migrate-from-deno.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## 상태와 범위

**Deno 지원은 Deprecated입니다.** `@fluojs/platform-deno`, `@fluojs/websockets/deno`, CLI의 Deno 경로에는 새 기능, 성능 개선, 새로운 런타임 버전 호환성을 추가하지 않습니다. 중대한 보안 문제와 회귀 수정은 건별로 검토하며 patch 또는 LTS 제공을 보장하지 않습니다. 신규 프로젝트에는 기본 Node.js + Fastify 경로를 권장하고, edge 배포가 필요하면 Cloudflare Workers를 검토하세요.

기존 Deno adapter/WebSocket `2.x`와 CLI `3.x` 경로 및 예제는 계속 사용할 수 있습니다. 제거는 각 Deno 관련 패키지의 다음 major에서 진행하며 [#3938](https://github.com/fluojs/fluo/issues/3938)에서 추적합니다. 마지막 advisory 릴리스의 정확한 버전은 Changesets 릴리스 결과로 결정됩니다. 이 문서는 특정 마지막 버전이나 npm registry deprecation 완료를 선언하지 않습니다.

[2026-10-09 공식 발표](https://deno.com/blog/cloudflare)에 따르면 Deno runtime은 1년간 매월 bug/security fix를 제공한 뒤 팀의 개발이 종료되며 open source로 남습니다. Deno Deploy는 6개월 후 종료되고 JSR은 계속 운영됩니다. 이 일정은 Fluo의 patch/LTS 약속이 아니며 runtime, Deploy, JSR을 같은 서비스로 취급하지 않습니다.

이 가이드는 실행 호스트와 도구 체계를 이전하는 절차입니다. HTTP 동작은 기존 계약을 따르며 package별 지원 범위를 확대하지 않습니다. 먼저 [패키지 지원 표](../reference/package-surface.ko.md), [bootstrap 계약](./bootstrap-paths.ko.md), [lifecycle 계약](../architecture/lifecycle-and-shutdown.ko.md)을 확인하세요. 아래 entrypoint는 이미 존재하는 `AppModule`을 사용하는 조각이며 전체 앱의 대체 파일이 아닙니다.

## Node.js + Fastify로 이전

CLI와 생성 Babel/Vite toolchain에는 Node.js `>=24.11.0 <27`을 사용하세요. Adapter의 runtime-only 범위는 `>=24.0.0 <27`입니다. 기본 starter와 decorator tooling을 비교할 별도 프로젝트는 다음처럼 만듭니다. 기존 프로젝트에 덮어쓰지 마세요.

```bash
pnpm dlx @fluojs/cli new migrated-api --shape application --transport http --runtime node --platform fastify
```

기존 runtime/core/http와 기능 모듈은 유지하고, 대상 앱에 `@fluojs/platform-fastify`와 `@fluojs/platform-nodejs`를 설치합니다. Fastify는 adapter의 dependency이므로 직접 Fastify API를 쓰지 않으면 별도 설치가 필요하지 않습니다.

**Before: managed Deno entrypoint**

```ts
import '@fluojs/core/metadata-preload';
import { DenoHttpApplicationAdapter, createDenoShutdownSignalRegistration } from '@fluojs/platform-deno';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.ts';

const app = await FluoFactory.create(AppModule, {
  adapter: DenoHttpApplicationAdapter.create({ port: 3000 }),
  shutdownRegistration: createDenoShutdownSignalRegistration(),
});
await app.listen();
```

**After: default Node/Fastify entrypoint**

```ts
import '@fluojs/core/metadata-preload';
import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app';

const parsedPort = Number.parseInt(process.env.PORT ?? '3000', 10);
const port = Number.isFinite(parsedPort) ? parsedPort : 3000;

const app = await FluoFactory.create(AppModule, {
  adapter: FastifyHttpApplicationAdapter.create({ port }),
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(),
});
await app.listen();
```

Factory가 초기화하고 `app.listen()`이 listener를 엽니다. Adapter는 `PORT`를 읽지 않으며 port parsing은 애플리케이션 정책입니다. 이 예시는 생성 starter의 parseInt/fallback 정책을 유지합니다. 표준 decorator transform과 metadata preload를 유지하고 `experimentalDecorators`/`emitDecoratorMetadata`를 켜지 마세요. Deno의 native TypeScript 실행을 Node의 직접 TypeScript 실행으로 치환하지 말고 생성된 Vite build 경계를 사용합니다.

## Cloudflare Workers로 이전

HTTP handler를 export해야 하는 edge 앱에는 host-owned 경로를 사용합니다. Workers는 `Deno.serve`나 Node listener를 실행하지 않습니다. 기존 Deno host가 관리하던 서버와 signal orchestration을 그대로 복사하지 마세요.

**Before: host-owned Deno handler**

```ts
import '@fluojs/core/metadata-preload';
import { DenoHttpApplicationAdapter, createDenoFetchHandler } from '@fluojs/platform-deno';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.ts';

const adapter = DenoHttpApplicationAdapter.create();
const app = await FluoFactory.create(AppModule, { adapter });
const handler = createDenoFetchHandler({ dispatcher: app.dispatcher });
const server = Deno.serve({ port: 3000 }, handler);

try {
  await server.finished;
} finally {
  await app.close();
}
```

이 Before에서 host는 별도로 server stop, signal, websocket upgrade를 소유합니다. `createDenoFetchHandler(...)`는 서버를 열거나 upgrade를 소유하지 않습니다.

**After: host-owned lazy Workers handler**

```ts
import '@fluojs/core/metadata-preload';
import { CloudflareWorkerApplicationHost } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app';

const worker = CloudflareWorkerApplicationHost.create(AppModule);

export default {
  fetch: worker.fetch,
};
```

이 host는 lazy bootstrap, generation 교체, retry, close/drain recovery를 소유합니다. 별도 `app.listen()`이나 process signal 등록은 필요하지 않습니다. Workers에는 export된 `fetch`에 전달되는 host shutdown callback이 없습니다. Export만으로 close가 예약되지 않습니다. 호출 중인 `worker.fetch` 밖의 애플리케이션 trigger는 `await worker.close()`를 호출할 수 있지만 같은 요청 안에서 close를 await하면 자기 요청의 drain을 기다립니다. 그 경우 response를 반환하고 `executionContext.waitUntil(worker.close())` 같은 방식으로 close를 관찰하세요. 성공한 close 후 다음 요청은 cached configuration으로 새 generation을 만들므로 terminal 종료가 필요하면 애플리케이션이 상태를 소유해야 합니다.

첫 Worker `env`가 singleton bootstrap을 결정해야 하면 동일한 `CloudflareWorkerApplicationHost.create({ fromEnv })` overload를 사용하세요. 첫 configuration은 host instance에 cache되고 후속 request env는 singleton을 재설정하지 않습니다. Fixed-module host의 요청별 binding은 `request.cloudflare.env`로 전달되며 bootstrap 시점의 `ConfigModule` 입력을 대신하지 않습니다. [Workers API와 소유권](../../packages/platform-cloudflare-workers/README.ko.md)을 따르세요.

## 권한, 리소스와 realtime 점검

| 경계 | Node/Fastify | Workers |
| --- | --- | --- |
| 권한 | Deno `--allow-*`는 적용되지 않습니다. OS/container 권한, network 정책, secret 접근을 따로 설정합니다. | Binding, secret, service 접근을 배포 configuration에서 설정합니다. Deno permission flag를 복사하지 않습니다. |
| 환경 변수 | Entry point의 `Deno.env.get/toObject`를 애플리케이션 소유 `process.env` snapshot으로 바꾸고 service에는 `ConfigService`를 유지합니다. Node env-file/watch 계약을 따릅니다. | `env` binding을 사용합니다. Node `.env` loader나 process 전체 environment snapshot을 가정하지 않습니다. |
| 파일과 storage | `Deno.readTextFile` 같은 호출을 Node filesystem API로 이전하고 path/root, working directory, read/write 권한을 확인합니다. | 일반 filesystem이나 Deno KV를 가정하지 않습니다. Storage binding 또는 애플리케이션 소유 `StaticAssetSource`를 선택하고 데이터를 별도로 이전합니다. |
| TLS | Deno PEM 문자열을 애플리케이션 경계에서 읽어 Fastify의 Node `https` options로 전달합니다. Proxy가 TLS를 종료하면 adapter의 `https`를 생략합니다. | HTTPS endpoint와 인증서는 host가 소유합니다. `Deno.serve`의 `cert/key` option을 전달하지 않습니다. |
| 종료 | `shutdownRegistration`을 명시해야 Node signal이 연결됩니다. Deno helper의 log/swallow와 Node helper의 failure/timeout exit-status 정책을 같다고 가정하지 않습니다. | Host close는 애플리케이션 trigger와 bounded drain을 따르며 자동 process signal이나 terminal isolate 종료를 보장하지 않습니다. |
| WebSocket | `DenoWebSocketModule`을 `@fluojs/websockets/node`의 `NodeWebSocketModule.forRoot(...)`로 바꿉니다. | `@fluojs/websockets/cloudflare-workers`의 `CloudflareWorkersWebSocketModule.forRoot(...)`로 바꾸고 native `WebSocketPair` 경계를 따릅니다. |

Gateway decorator, room contract, 명시적 reply 또는 opt-in event-envelope 정책은 유지합니다. Runtime lifecycle injection token, raw socket/payload type, upgrade guard의 request type, backpressure와 disconnect drain을 대상 runtime 계약으로 다시 확인하세요. Fetch-style Deno/Workers의 `serverBacked` 거부 계약을 바꾸지 않습니다. Socket.IO는 Workers를 지원하지 않으며 Node/Bun의 별도 지원 계약입니다. Database/native driver, JWT, GraphQL처럼 package별 제한이 있는 기능을 adapter 변경만으로 이식 가능하다고 가정하지 마세요.

## CLI, configuration, scripts와 lockfile

CLI process 자체는 Node.js `>=24.11.0 <27`에서 실행됩니다. Deno target이 Deprecated여도 기존 명시적 `--runtime deno --platform deno` 값과 생성 경로는 이번 단계에서 제거하지 않습니다. [Starter matrix](../reference/fluo-new-support-matrix.ko.md)와 [toolchain matrix](../reference/toolchain-contract-matrix.ko.md)를 기준으로 새 대상 프로젝트와 비교하세요.

1. `deno.json`/`deno.jsonc`의 import map, `npm:`/URL/JSR import와 task를 목록화하고 대상 `package.json` dependency와 bundler resolution으로 옮깁니다. 같은 파일을 무조건 삭제하지 말고 잔존 Deno consumer를 확인합니다. `./app.ts` 같은 local import는 선택한 starter의 TypeScript/bundler 규칙에 맞춥니다.
2. CLI는 `package.json` dependency의 platform package로 runtime을 감지합니다. 이전 완료한 target manifest에서는 `@fluojs/platform-deno`를 대상 adapter로 교체하고 명시적 runtime override도 맞춥니다. 기존 `fluo dev`가 자동으로 Node target으로 바뀐다고 가정하지 않습니다.
3. Node에서는 `dev: fluo dev`, `build: fluo build`, `start: fluo start`와 생성 Vite/Vitest config를 사용합니다. Deno의 `deno compile --allow-env --allow-net --allow-read=.env --output dist/app src/main.ts` 및 `./dist/app` script를 Node build/start로 옮깁니다. 기존 Deno binary를 Node에서 실행하지 않습니다.
4. Workers에서는 `dev: fluo dev`, `build: wrangler deploy --dry-run`, `preview: wrangler dev --remote --show-interactive-dev-session=false`, `deploy: wrangler deploy`가 생성 lifecycle이며 생성 manifest에는 `start` script가 없습니다. Node CLI의 Workers command는 Wrangler에 위임하고 `deploy`는 실제 배포입니다. Entrypoint, compatibility 설정, binding과 secret은 대상 Wrangler configuration에서 검토합니다.
5. `deno.lock`은 npm package manager의 lockfile을 대체하지 않습니다. 대상 package manager로 dependency와 lockfile을 생성하고 CI install/cache를 맞추세요. Rollback 또는 남아 있는 Deno 사용자를 위해 기존 lockfile과 배포 artifact를 보존하고 이전이 검증된 뒤 별도로 정리합니다.
6. Deno test/lint/fmt task와 permission flag를 대상 test/tooling 경계에 맞춥니다. Generated non-Deno starter의 standard decorator transform, metadata preload, unit/slice/app/e2e 구성을 유지하세요. Production restart, TLS, raw-body/multipart/SSE, upgrade/rooms/disconnect와 shutdown 실패를 대상 환경에서 검증한 뒤 트래픽을 전환합니다.

## 근거와 검증 범위

공개 API와 예제는 [Fastify](../../packages/platform-fastify/README.ko.md), [Deno](../../packages/platform-deno/README.ko.md), [Workers](../../packages/platform-cloudflare-workers/README.ko.md), [WebSockets](../../packages/websockets/README.ko.md) 계약에서 가져옵니다. 구현 근거는 `packages/platform-fastify/src/adapter.ts`, `packages/platform-deno/src/fetch-handler.ts`, `packages/platform-cloudflare-workers/src/adapter.ts`, `packages/cli/src/new/scaffold.ts`, `packages/cli/src/commands/scripts.ts`입니다. 이 문서는 배포나 registry 상태의 증명이 아닙니다. 실제 이전 검증은 애플리케이션 소유입니다.
