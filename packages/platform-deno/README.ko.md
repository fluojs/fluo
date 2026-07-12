# @fluojs/platform-deno

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

네이티브 `Deno.serve`를 기반으로 구축된 fluo 런타임용 Deno 기반 HTTP 어댑터 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [HTTPS와 런타임 이식성](#https와-런타임-이식성)
- [Conformance 커버리지](#conformance-커버리지)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
deno add npm:@fluojs/platform-deno npm:@fluojs/runtime npm:@fluojs/http
```

이 패키지는 Deno에서 실행하는 것을 전제로 합니다. 배포 manifest는 npm 메타데이터가 Deno 런타임 계약과 어긋나지 않도록 의도적으로 `engines.node`를 선언하지 않으며, 저장소의 Node.js 20+ 요구사항은 메인테이너용 빌드/테스트 툴체인에만 적용됩니다.

## 사용 시점

fluo 애플리케이션을 [Deno](https://deno.com/) 런타임에서 실행할 때 이 패키지를 사용합니다. 이 어댑터는 Deno의 네이티브 `fetch` 표준 `Request` 및 `Response` 객체를 활용하여 TypeScript 백엔드 개발을 위한 안전하고 고성능인 환경을 제공합니다.

애플리케이션 종료 중에는 새 유입을 중단하고, Deno 서버 수명주기가 종료되기 전에 활성 HTTP 핸들러가 bounded drain window 안에서 마무리될 수 있도록 동작합니다.

`runDenoApplication(...)`을 Deno signal API를 사용할 수 있는 환경에서 실행하면 `SIGINT`/`SIGTERM` 리스너도 등록하고, 애플리케이션이 닫히면 해당 리스너를 정리합니다.

## 빠른 시작

```typescript
import { runDenoApplication } from '@fluojs/platform-deno';
import { AppModule } from './app.module.ts';

await runDenoApplication(AppModule, {
  port: 3000,
});
```

## 주요 패턴

### Host-Owned Deno.serve
애플리케이션이 `Deno.serve(...)`를 소유한다면 `app.listen()`을 호출하지 않고 fluo 애플리케이션을 bootstrap한 뒤 public dispatcher로 request handler를 만드세요. `createDenoFetchHandler(...)`는 request 변환과 dispatch만 수행하며 server를 시작하거나 shutdown, signal, websocket upgrade를 소유하지 않습니다.

```typescript
import { createDenoAdapter, createDenoFetchHandler } from '@fluojs/platform-deno';
import { fluoFactory } from '@fluojs/runtime';

const adapter = createDenoAdapter();
const app = await fluoFactory.create(AppModule, { adapter });
const handler = createDenoFetchHandler({
  dispatcher: app.dispatcher,
  rawBody: true,
});

const server = Deno.serve({ port: 3000 }, handler);

try {
  await server.finished;
} finally {
  await app.close();
}
```

주변 host는 `server` 중지와 process signal 조율을 소유하고 websocket upgrade를 별도로 처리할지 결정해야 합니다. fluo가 해당 lifecycle seam을 소유해야 한다면 managed `runDenoApplication(...)` 또는 `app.listen()` 경로를 사용하세요. `adapter.handle(...)`은 managed adapter의 `listen(dispatcher)` binding이 끝난 뒤에만 사용할 수 있습니다.

### 직접 어댑터 생성
애플리케이션 코드는 보통 `createDenoAdapter(options)`, `bootstrapDenoApplication(...)`, `runDenoApplication(...)`을 사용해 adapter setup 경계를 명확히 유지하는 편을 권장합니다. 커스텀 orchestration이나 테스트에서는 `new DenoHttpApplicationAdapter(options?)`를 직접 사용할 수 있으며, constructor는 factory와 같은 optional public `DenoAdapterOptions`를 받고 options가 생략되면 기본 port를 적용하며, portable `host` alias보다 `hostname`을 우선하고, 잘못된 `port` 또는 `maxBodySize` 값은 setup 시점에 거절합니다.

### Opt-in Deno WebSocket 바인딩
어댑터는 애플리케이션이 `@fluojs/websockets/deno` 바인딩을 import하고 설정한 뒤에 Deno의 네이티브 `Deno.upgradeWebSocket`을 지원합니다. 해당 바인딩이 없으면 websocket upgrade 요청은 암묵적으로 upgrade되지 않고 일반 HTTP dispatch 경로를 계속 따릅니다.

```typescript
import { Module } from '@fluojs/core';
import { DenoWebSocketModule, OnMessage, WebSocketGateway } from '@fluojs/websockets/deno';
import type { DenoServerWebSocket } from '@fluojs/websockets/deno';

@WebSocketGateway({ path: '/ws' })
export class MyGateway {
  @OnMessage('ping')
  handlePing(_payload: unknown, socket: DenoServerWebSocket) {
    socket.send(JSON.stringify({ event: 'pong', data: 'hello from deno' }));
  }
}

@Module({
  imports: [DenoWebSocketModule.forRoot()],
  providers: [MyGateway],
})
export class RealtimeModule {}
```

## HTTPS와 런타임 이식성

`https` 옵션으로 Deno TLS 인증서 자료를 전달하면 `Deno.serve`를 HTTPS 모드로 시작할 수 있습니다. 어댑터는 `https.cert`와 `https.key`를 Deno의 `cert` 및 `key`로 전달하며, 시작 로그도 `https://` listen URL을 보고하므로 Deno 패키지가 공유 HTTP 어댑터 이식성 계약과 정렬됩니다.

```typescript
await runDenoApplication(AppModule, {
  hostname: '127.0.0.1',
  https: {
    cert: await Deno.readTextFile('./cert.pem'),
    key: await Deno.readTextFile('./key.pem'),
  },
  port: 3443,
});
```

`hostname`은 Deno 네이티브 옵션 이름으로 유지됩니다. 공유 HTTP 어댑터 테스트와 교차 런타임 설정 헬퍼를 위해 `host`도 이식성 alias로 허용하며, 둘 다 제공하면 `Deno.serve(...)` bind target과 보고되는 listen URL에는 `hostname`이 우선합니다.

Advanced option에는 test 또는 non-hosted runtime을 위한 injectable `serve`, `upgradeWebSocket` seam, `rawBody`, `maxBodySize`, `multipart`, `shutdownSignals`가 포함됩니다. `createDenoFetchHandler(...)`는 같은 request parsing option을 받으며 byte-exact JSON/text raw body를 보존하고 multipart request에서는 `rawBody`를 제외합니다. Seam을 주입하지 않으면 managed adapter는 listen/upgrade 시점에 `globalThis.Deno.serve`와 `globalThis.Deno.upgradeWebSocket`으로 fallback합니다. `runDenoApplication(...)`은 기본적으로 `SIGINT`/`SIGTERM`을 연결하고, `shutdownSignals: false`는 signal registration을 끄며, 여러 signal을 등록하다 실패하면 이미 연결한 listener를 rollback합니다. 이미 실행 중인 adapter에 대한 중복 `listen(...)` 호출은 원래 dispatcher pipeline을 보존하는 no-op입니다. Close는 Deno serve signal을 abort하기 전에 active request drain을 최대 10초 기다립니다. `handle(...)`은 websocket upgrade 요청을 포함해 `listen()`이 dispatcher를 bind하기 전에는 JSON `500`, shutdown 진행 중에는 JSON `503`을 반환합니다.

## Conformance 커버리지

`packages/platform-deno/src/adapter.test.ts`는 managed Deno 계약을 검증하는 package-local regression 대상입니다. 이 파일은 shared Web dispatch delegation, `listen(dispatcher)` 이후 direct `adapter.handle(...)` success-path dispatch, 직접 constructor/factory option normalization, HTTPS startup forwarding, `Deno.serve(...)` bind target과 startup log에 대한 `host` alias 및 `hostname` 우선순위, 중복 `listen(...)` no-op dispatcher 보존, 기본 `SIGINT`/`SIGTERM` signal listener 등록, `shutdownSignals: false`, partial signal-registration failure 이후 listener rollback, websocket upgrade binding 및 no-binding HTTP fallback, websocket listen 전 bootstrap gating, global Deno serve/upgrade fallback seam, listen 전 `500` 처리, shutdown 중 `503` 처리, serve-signal abort 전 in-flight request drain, bounded 10초 close timeout을 검증합니다. `packages/platform-deno/src/fetch-handler.test.ts`는 host-owned handler에 shared web-runtime portability harness를 적용하여 cookie/query decoding, JSON/text와 byte-exact raw body, multipart exclusion, SSE framing, dispatch가 `Deno.serve(...)`를 호출하지 않는다는 사실을 검증합니다. `packages/platform-deno/src/declaration-surface.test.ts`는 package를 다시 build하고 manifest가 export하는 declaration을 검증합니다.

공유 edge portability suite인 `packages/testing/src/portability/web-runtime-adapter-portability.test.ts`는 Deno를 Bun 및 Cloudflare Workers와 함께 실행해 malformed cookie 보존, query decoding, JSON/text raw-body capture, multipart raw-body 제외, SSE framing을 검증합니다. 패키지 테스트의 README parity assertion은 이 edge-runtime 커버리지 문서가 한국어 mirror와 계속 동기화되도록 확인합니다.

## 공개 API 개요

- `createDenoAdapter(options)`: Deno HTTP 어댑터를 위한 팩토리이며, 직접 생성과 같은 validation 및 normalization을 공유합니다.
- `createDenoFetchHandler(options)`: 이미 bootstrap된 `app.dispatcher`에서 `Deno.serve(...)`를 시작하거나 소유하지 않는 `Request` handler를 동기적으로 생성합니다.
- `bootstrapDenoApplication(module, options)`: 커스텀 오케스트레이션을 위한 고급 부트스트랩입니다.
- `runDenoApplication(module, options)`: Deno를 위한 권장 빠른 시작 헬퍼입니다.
- `DenoHttpApplicationAdapter(options?)`: 핵심 adapter 구현체입니다. Direct `new DenoHttpApplicationAdapter()` 또는 `new DenoHttpApplicationAdapter(options)`는 `createDenoAdapter(options)`와 같은 기본 port, `host` alias 처리, `hostname` 우선순위, 숫자 option validation을 적용합니다.
- `listen(dispatcher)`: fluo HTTP dispatcher를 bind하고 `Deno.serve`를 시작합니다. 중복 호출은 원래 dispatcher를 보존하는 no-op입니다.
- `close()`: 새 유입을 중단하고 active request를 최대 10초 drain한 뒤, shutdown이 끝나지 않으면 Deno serve signal을 abort합니다.
- `handle(request)`: 수동 `Request` to `Response` 디스패처입니다. `listen(dispatcher)`가 runtime dispatcher를 bind한 뒤에는 성공 경로를 실행하고, bind 전에는 JSON `500`, shutdown 중에는 JSON `503`을 반환합니다.
- `getListenTarget()`: Deno `hostname` 또는 portable `host` alias를 사용해 bind target과 public URL을 보고합니다.
- `getRealtimeCapability()`: runtime integration을 위한 fetch-style Deno websocket upgrade capability를 보고합니다.
- `getServer()`: adapter가 listen 중일 때 active `Deno.serve` controller를 반환합니다.
- `configureWebSocketBinding(...)`: `listen(dispatcher)`가 server를 시작하기 전에 `@fluojs/websockets/deno` binding을 설치합니다.
- `https: { cert, key }`: `Deno.serve`로 전달되고 보고되는 listen URL에 반영되는 HTTPS 시작 옵션입니다.
- Option 및 seam type: `CreateDenoFetchHandlerOptions`, `DenoServeOptions`, `DenoServeController`, `DenoServerWebSocket`, websocket binding interface, bootstrap/run option, listen-target helper.

## 관련 패키지

- `@fluojs/runtime`: 핵심 런타임입니다.
- `@fluojs/websockets`: 전용 서브패스 `@fluojs/websockets/deno`를 포함합니다.
- `@fluojs/http`: HTTP 데코레이터 및 추상화 계층입니다.

## 예제 소스

- `packages/platform-deno/src/adapter.test.ts`
- `packages/platform-deno/src/fetch-handler.test.ts`
- `packages/websockets/src/deno/deno.test.ts`
