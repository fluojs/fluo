# @konekti/websockets

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti 애플리케이션용 데코레이터 기반 WebSocket 게이트웨이 작성 코어이며, 런타임별 raw websocket 바인딩은 `@konekti/websockets/node`, `@konekti/websockets/bun`, `@konekti/websockets/deno`, `@konekti/websockets/cloudflare-workers` 같은 명시적 서브패스로 분리됩니다.

## 관련 문서

- `../runtime/README.ko.md`
- `../../docs/operations/third-party-extension-contract.ko.md`
- `../../docs/reference/package-chooser.ko.md`
- `../../docs/reference/package-surface.ko.md`

## 설치

```bash
npm install @konekti/websockets ws
```

### Migration note (semver-major)

- `@konekti/websocket` 패키지 이름이 `@konekti/websockets`로 변경되었습니다.
- 루트 import를 `@konekti/websocket`에서 `@konekti/websockets`로 바꾸세요.
- `@konekti/websocket/node` 같은 바인딩 서브패스 import도 `@konekti/websockets/node`로 함께 바꾸세요.

데코레이터와 공용 게이트웨이 계약은 `@konekti/websockets`에서 가져오고, 선택한 HTTP 어댑터에 맞는 런타임 전용 바인딩 서브패스를 추가하세요(`@konekti/websockets/node`, `@konekti/websockets/bun`, `@konekti/websockets/deno`, 또는 `@konekti/websockets/cloudflare-workers`).

## 빠른 시작

```typescript
import { Module } from '@konekti/core';
import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '@konekti/websockets';
import { NodeWebSocketModule } from '@konekti/websockets/node';
import type { WebSocket } from 'ws';

@WebSocketGateway({ path: '/chat' })
class ChatGateway {
  @OnConnect()
  handleConnect(socket: WebSocket) {}

  @OnMessage('ping')
  handlePing(payload: unknown, socket: WebSocket) {
    socket.send(JSON.stringify({ event: 'pong', data: payload }));
  }

  @OnDisconnect()
  handleDisconnect(socket: WebSocket, code: number) {}
}

@Module({
  imports: [NodeWebSocketModule.forRoot()],
  providers: [ChatGateway],
})
export class AppModule {}
```

## API

- `@WebSocketGateway({ path? })`
- `@WebSocketGateway({ path?, serverBacked? })` — `serverBacked: { port }`는 `@konekti/websockets/node`가 소유하는 전용 server-backed 리스너로 게이트웨이를 opt-in 시킵니다
- `@OnMessage(event?)`
- `@OnConnect()`
- `@OnDisconnect()`

### server-backed gateway opt-in

이제 루트 데코레이터는 명시적인 server-backed 전용 메타데이터 블록을 지원합니다.

```typescript
@WebSocketGateway({
  path: '/chat',
  serverBacked: { port: 3101 },
})
class ChatGateway {}
```

- `serverBacked.port`는 유한한 양의 정수여야 합니다.
- 이 opt-in은 `@konekti/websockets/node`에서만 소비됩니다.
- 해당 게이트웨이는 애플리케이션 HTTP 리스너 대신, 설정한 포트의 websocket 전용 리스너로 이동합니다.
- fetch-style 바인딩(`@konekti/websockets/bun`, `@konekti/websockets/deno`, `@konekti/websockets/cloudflare-workers`)은 이 메타데이터를 명시적으로 거부합니다.

## Node 바인딩 서브패스

- `@konekti/websockets/node`의 `NodeWebSocketModule.forRoot()` - Node 기반 어댑터용 raw `ws` upgrade 바인딩 등록
- `@konekti/websockets/node`의 `createNodeWebSocketProviders()` - Node websocket 모듈 구성을 위한 raw provider 반환

### 호환 alias

`WebSocketModule.forRoot()`와 `createWebSocketProviders()`는 현재 Node 바인딩을 위한 호환 alias로 루트 배럴에도 남아 있지만, 명시적 Node 전용 seam의 실제 위치는 이제 `@konekti/websockets/node`입니다.

### 내부 모듈 배선 토큰

`@konekti/websockets`는 lifecycle DI 토큰을 공개 API로 노출하지 않습니다. 게이트웨이 탐색/배선 토큰은 내부 구현 세부사항이며, 게이트웨이 작성 계약은 데코레이터 + 클래스 프로바이더 중심으로 유지됩니다.
`WEBSOCKET_OPTIONS`는 내부 모듈 배선으로 한정되며, 루트 엔트리포인트 토큰 표면의 일부가 아닙니다.
이 토큰은 패키지 내부 DI 식별성을 모듈 경계에서 안정적으로 유지하기 위해 여전히 `Symbol.for(...)` 안정 키를 사용하지만, 공개 계약으로 승격되지는 않습니다.

### Node 모듈 옵션

`NodeWebSocketModule.forRoot(options)`와 `createNodeWebSocketProviders(options)`는 아래 옵션을 받습니다.

- `heartbeat.enabled`, `heartbeat.intervalMs`, `heartbeat.timeoutMs`
- `shutdown.timeoutMs` (기본값: `5000`)

### raw websocket 지원 호스트 어댑터

현재 `@konekti/websockets/node`는 테스트된 Node 소유 `{ kind: 'server-backed', server }` realtime capability와 호환 가능한 HTTP/S `upgrade` listener 경계를 노출하는 플랫폼 어댑터만 지원합니다.

- `@konekti/platform-nodejs`
- `@konekti/platform-fastify`
- `@konekti/platform-express`

이 브랜치는 `@konekti/platform-bun`, `@konekti/platform-deno`, `@konekti/platform-cloudflare-workers`에 대해 raw `@konekti/websockets/node` 지원을 주장하지 않습니다.

이 fetch-style 런타임들은 런타임별 websocket 바인딩을 위해 공용 `{ kind: 'fetch-style', contract: 'raw-websocket-expansion', mode: 'request-upgrade', support, version: 1, reason }` seam을 사용합니다. 이 capability만으로 `@konekti/websockets/node` 지원이 생기는 것은 아닙니다.

## Bun 바인딩 서브패스

- `@konekti/websockets/bun`의 `BunWebSocketModule.forRoot()` - `@konekti/platform-bun`용 Bun 네이티브 raw websocket 바인딩 등록
- `@konekti/websockets/bun`의 `createBunWebSocketProviders()` - 커스텀 Bun websocket 모듈 구성을 위한 raw provider 반환

`@konekti/websockets/bun`은 Bun의 `{ kind: 'fetch-style', contract: 'raw-websocket-expansion', mode: 'request-upgrade', support: 'supported', version: 1, reason }` realtime capability를 소비하고 `Bun.serve()` + `server.upgrade()`로 게이트웨이를 호스팅합니다.

## Deno 바인딩 서브패스

- `@konekti/websockets/deno`의 `DenoWebSocketModule.forRoot()` - `@konekti/platform-deno`용 Deno 네이티브 raw websocket 바인딩 등록
- `@konekti/websockets/deno`의 `createDenoWebSocketProviders()` - 커스텀 Deno websocket 모듈 구성을 위한 raw provider 반환

`@konekti/websockets/deno`는 Deno의 `{ kind: 'fetch-style', contract: 'raw-websocket-expansion', mode: 'request-upgrade', support: 'supported', version: 1, reason }` realtime capability를 소비하고 `Deno.upgradeWebSocket(request)`로 게이트웨이를 호스팅합니다.

## Cloudflare Workers 바인딩 서브패스

- `@konekti/websockets/cloudflare-workers`의 `CloudflareWorkersWebSocketModule.forRoot()` - `@konekti/platform-cloudflare-workers`용 Worker 네이티브 raw websocket 바인딩 등록
- `@konekti/websockets/cloudflare-workers`의 `createCloudflareWorkersWebSocketProviders()` - 커스텀 Worker websocket 모듈 구성을 위한 raw provider 반환

`@konekti/websockets/cloudflare-workers`는 Cloudflare Workers의 `{ kind: 'fetch-style', contract: 'raw-websocket-expansion', mode: 'request-upgrade', support: 'supported', version: 1, reason }` realtime capability를 소비하고 `WebSocketPair` 기반 isolate-local/stateless 범위에서 게이트웨이를 호스팅합니다.

## 런타임 동작

- `onApplicationBootstrap()`에서 `COMPILED_MODULES`를 기준으로 게이트웨이 탐색
- 게이트웨이 인스턴스는 `RUNTIME_CONTAINER`에서 해석
- 명시적 Node seam은 플랫폼이 선택한 realtime capability를 소비하며, 그 capability가 `server-backed`일 때 `ws`의 `noServer` 모드와 단일 Node 서버 `upgrade` 리스너를 사용합니다
- `serverBacked: { port }`에 opt-in한 게이트웨이는 애플리케이션의 공용 리스너에 붙지 않고, 해당 포트의 전용 Node 리스너를 사용합니다
- 게이트웨이 경로는 정규화 후 정확히 일치해야 연결 처리
- `request`/`transient` 스코프 게이트웨이는 경고 후 제외
- Node 바인딩 종료 시 업그레이드 리스너 제거 및 활성 소켓 정리
- `message`/`close` 이벤트는 `@OnConnect()` 핸들러가 끝날 때까지 버퍼링되며, 이후 순서대로 재생되어 connect 단계 이벤트가 조용히 유실되지 않습니다
- attachment server 종료는 timeout 인지 방식으로 처리되며, 제한 시간 안에 close가 끝나지 않으면 무기한 대기하지 않고 로그를 남깁니다
- `getRooms(socketId)`는 방 목록의 방어적 스냅샷(`ReadonlySet`)을 반환하므로 외부에서 내부 room 인덱스를 오염시킬 수 없습니다

## 의도된 제한 사항

- `@konekti/websockets` 루트는 게이트웨이 작성용 데코레이터, 메타데이터, 디스크립터, 공용 room 계약에 집중하며, 현재 raw `ws` Node 런타임 배선은 의도적으로 `@konekti/websockets/node`로 격리합니다.
- 이제 명시적 realtime capability seam의 소유권은 플랫폼 선택 경계에 있습니다. 이 패키지 자체가 런타임/플랫폼 결정을 내리지는 않으며, 현재 raw `ws` 바인딩은 계속 Node 기반 server capability를 전제로 합니다.
- `serverBacked: { port }`는 `@konekti/websockets/node` 전용의 명시적 server-backed 계약이며, 현재 문서화·테스트된 지원 범위는 계속 `@konekti/platform-nodejs`, `@konekti/platform-fastify`, `@konekti/platform-express`로 제한됩니다.
- `{ kind: 'unsupported', mode: 'no-op' }` 또는 fetch-style `raw-websocket-expansion` capability를 보고하는 런타임은 런타임별 websocket host가 구현되기 전까지 그 명시적 경계에서 중단되며, 이 패키지는 Worker/fetch-style 런타임을 위해 Node upgrade listener 라이프사이클을 에뮬레이션하지 않습니다.
- Bun, Deno, Cloudflare Workers는 공식 raw websocket 지원이 각 fetch-style 전용 바인딩에 있으므로 `@WebSocketGateway({ serverBacked })`를 명시적으로 거부합니다.
- 그 seam을 통해 호환 가능한 Node upgrade-listener host를 노출하지 않는 fetch-style 런타임은 `@konekti/websockets/node`에서 계속 unsupported 상태이며, Bun/Deno/Cloudflare Workers raw websocket 호스팅은 각 전용 서브패스를 통해서만 주장합니다. Cloudflare Workers 지원은 의도적으로 isolate-local/stateless 범위에 머무르며 Durable Objects나 cross-isolate coordination을 포함하지 않습니다.

## 프로바이더 등록 제약

게이트웨이 클래스는 반드시 **클래스 프로바이더**로 등록해야 합니다 — 직접 등록(`providers: [MyGateway]`) 또는 `useClass` 방식(`{ provide: TOKEN, useClass: MyGateway }`) 중 하나를 사용하세요. `useValue` 또는 `useFactory`로 등록한 프로바이더는 런타임에 데코레이터 클래스와 연결할 수 없어 게이트웨이 탐색 중 무음으로 건너뜁니다. 게이트웨이가 연결되지 않는 경우, 프로바이더 항목이 클래스 생성자를 사용하고 있는지 확인하세요.
