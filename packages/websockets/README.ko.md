# @fluojs/websockets

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 런타임을 위한 데코레이터 기반 WebSocket 게이트웨이 작성 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [바이너리 페이로드](#바이너리-페이로드)
- [공개 API 개요](#공개-api-개요)
- [런타임별 서브패스](#런타임별-서브패스)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/websockets ws
```

## 사용 시점

fluo 애플리케이션에 실시간 WebSocket 기능을 추가할 때 이 패키지를 사용합니다. 연결, 메시지 및 연결 해제 처리를 위한 깔끔한 데코레이터 기반 API를 제공하며, 다양한 런타임(Node.js, Bun, Deno, Cloudflare Workers)을 최고 수준으로 지원합니다.

## 빠른 시작

기본 Node.js 기반 websocket 런타임을 사용하려면 `WebSocketModule.forRoot()`를 사용합니다.

```typescript
import { WebSocketGateway, OnConnect, OnMessage, WebSocketModule } from '@fluojs/websockets';
import { Module } from '@fluojs/core';

@WebSocketGateway({ path: '/chat' })
class ChatGateway {
  @OnConnect()
  handleConnect(socket) {
    console.log('클라이언트 연결됨');
  }

  @OnMessage('ping')
  handlePing(payload, socket) {
    socket.send(JSON.stringify({ event: 'pong', data: payload }));
  }
}

@Module({
  imports: [WebSocketModule.forRoot()],
  providers: [ChatGateway],
})
export class AppModule {}
```

## 주요 패턴

### 경로 공유 게이트웨이
여러 게이트웨이가 동일한 경로를 공유할 수 있으며, 이들의 핸들러는 탐색된 순서대로 실행됩니다.

```typescript
@WebSocketGateway({ path: '/events' })
class MetricsGateway {
  @OnMessage('metrics')
  handleMetrics(data) { /* ... */ }
}
```

### Server-Backed Node adapter
Server-backed Node adapter(Node.js, Express, Fastify)에서는 전용 listener port를 사용할 수 있습니다. Fetch-style runtime(`@fluojs/websockets/bun`, `@fluojs/websockets/deno`, `@fluojs/websockets/cloudflare-workers`)은 `serverBacked`를 거부합니다.

```typescript
@WebSocketGateway({ 
  path: '/chat', 
  serverBacked: { port: 3101 } 
})
class DedicatedChatGateway {}
```

### pre-upgrade guard와 기본 제한값
`WebSocketModule.forRoot(...)`를 사용하면 핸드셰이크 전에 익명 업그레이드를 거절하고, 공통 연결/페이로드 제한을 조정할 수 있습니다.

```typescript
import { UnauthorizedException } from '@fluojs/http';

WebSocketModule.forRoot({
  limits: {
    maxConnections: 500,
    maxPayloadBytes: 65_536,
  },
  upgrade: {
    guard(request) {
      const authorization = request instanceof Request
        ? request.headers.get('authorization')
        : request.headers.authorization;

      if (authorization !== 'Bearer demo-token') {
        throw new UnauthorizedException('Authentication required.');
      }
    },
  },
});
```

옵션을 생략하면 `@fluojs/websockets`는 동시 연결 수, inbound payload 크기, pending message buffer, shutdown cleanup에 bounded default를 적용합니다. 기본값은 `maxConnections: 1000`, `maxPayloadBytes: 1 MiB`, `buffer.maxPendingMessagesPerSocket: 256`, `shutdown.timeoutMs: 5000`, Node heartbeat interval `30s`, Node backpressure `maxBufferedAmountBytes: 1 MiB`와 drop behavior입니다. 또한 server-backed Node listener는 `heartbeat.enabled`를 명시적으로 `false`로 두지 않는 한 heartbeat timer를 활성화하고, shutdown이 시작되면 진행 중인 async upgrade를 거절하며, 애플리케이션 shutdown 시 추적 중인 websocket 클라이언트를 닫고 `shutdown.timeoutMs` 범위 안에서 `@OnDisconnect()` cleanup이 마무리될 수 있도록 bounded 기회를 제공합니다. 공식 fetch-style runtime module(`@fluojs/websockets/bun`, `@fluojs/websockets/deno`, `@fluojs/websockets/cloudflare-workers`)도 같은 bounded client close 및 disconnect cleanup shutdown contract를 유지합니다.

## 바이너리 페이로드

Gateway `@OnMessage()` handler는 지원 런타임 전반에서 하나의 정규화된 payload contract를 받습니다. Text frame은 가능한 경우 JSON으로 파싱하고, 그렇지 않으면 string으로 전달합니다. Binary frame은 런타임이 Node `Buffer`/typed array, Bun `ArrayBuffer`/view, Deno `ArrayBuffer`/view/`Blob`, Cloudflare Workers `ArrayBuffer`/view/`Blob` 중 어떤 형태로 노출하더라도 UTF-8로 디코딩한 뒤 동일한 JSON/event dispatch 단계를 거칩니다. `limits.maxPayloadBytes` 검사는 모든 표현에 byte length를 사용하며, 허용된 socket에서 oversized payload가 들어오면 close code `1009`로 닫습니다.

## 공개 API 개요

- `@WebSocketGateway(options)`: 클래스를 WebSocket 게이트웨이로 표시합니다.
- `@OnConnect()`: 연결 핸들러를 위한 데코레이터입니다.
- `@OnMessage(event?)`: 인바운드 메시지 핸들러를 위한 데코레이터입니다.
- `@OnDisconnect()`: 연결 해제 핸들러를 위한 데코레이터입니다.
- `WebSocketModule`: WebSocket 통합을 위한 루트 모듈입니다.
- `WebSocketModule.forRoot({ upgrade, limits, backpressure, buffer, heartbeat, shutdown })`: pre-upgrade guard와 bounded runtime default를 구성합니다.
- `WebSocketGatewayLifecycleService`: 기본 Node.js 기반 lifecycle service token을 위한 루트 alias입니다.
- Metadata helper와 symbol: `defineWebSocketGatewayMetadata`, `getWebSocketGatewayMetadata`, `defineWebSocketHandlerMetadata`, `getWebSocketHandlerMetadata`, `getWebSocketHandlerMetadataEntries`, `webSocketGatewayMetadataSymbol`, `webSocketHandlerMetadataSymbol`.

## 런타임별 서브패스

기본 루트 Node.js alias 대신 런타임을 명시적으로 고정하고 싶다면 런타임별 서브패스를 사용하세요. 각 서브패스는 해당 `*WebSocketModule.forRoot(...)` 진입점과 일치하는 런타임 lifecycle service export를 제공합니다.

| 런타임 | 서브패스 | 모듈 | Lifecycle service |
| --- | --- | --- | --- |
| Node.js | `@fluojs/websockets/node` | `NodeWebSocketModule` | `NodeWebSocketGatewayLifecycleService` |
| Bun | `@fluojs/websockets/bun` | `BunWebSocketModule` | `BunWebSocketGatewayLifecycleService` |
| Deno | `@fluojs/websockets/deno` | `DenoWebSocketModule` | `DenoWebSocketGatewayLifecycleService` |
| Workers | `@fluojs/websockets/cloudflare-workers` | `CloudflareWorkersWebSocketModule` | `CloudflareWorkersWebSocketGatewayLifecycleService` |

## 예제 소스

- `packages/websockets/src/module.test.ts`
- `packages/websockets/src/public-surface.test.ts`
- `packages/websockets/src/node/node.test.ts`
- `packages/websockets/src/bun/bun.test.ts`
- `packages/websockets/src/deno/deno.test.ts`
- `packages/websockets/src/cloudflare-workers/cloudflare-workers.test.ts`
