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
npm install @fluojs/websockets
```

Root Node.js module path는 `WebSocketModule.forRoot()`가 runtime에서 해석될 때만 패키지가 직접 소유한 `ws` dependency를 사용합니다. 애플리케이션 코드에서 `ws`를 직접 사용하지 않는 한 별도 설치가 필요하지 않습니다.

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
Server-backed Node adapter(Node.js, Express, Fastify)에서는 전용 listener port를 사용할 수 있습니다. 테스트나 동적 host에서 운영체제가 ephemeral listener port를 원자적으로 할당하게 하려면 `serverBacked.port: 0`을 사용합니다. Fetch-style runtime(`@fluojs/websockets/bun`, `@fluojs/websockets/deno`, `@fluojs/websockets/cloudflare-workers`)은 `serverBacked`를 거부합니다.

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
      const authorization = request.headers.authorization;

      if (authorization !== 'Bearer demo-token') {
        throw new UnauthorizedException('Authentication required.');
      }
    },
  },
});
```

옵션을 생략하면 `@fluojs/websockets`는 동시 연결 수, inbound payload 크기, pending message buffer, shutdown cleanup에 bounded default를 적용합니다. 기본값은 `maxConnections: 1000`, `maxPayloadBytes: 1 MiB`, `buffer.maxPendingMessagesPerSocket: 256`, `shutdown.timeoutMs: 5000`, Node heartbeat interval `30s`, Node backpressure `maxBufferedAmountBytes: 1 MiB`와 drop behavior입니다. 또한 server-backed Node listener는 `heartbeat.enabled`를 명시적으로 `false`로 두지 않는 한 heartbeat timer를 활성화합니다. Node shutdown은 shutdown이 시작된 뒤 in-flight async upgrade를 거절하고, 애플리케이션 shutdown 시 추적 중인 websocket 클라이언트를 닫고, `shutdown.timeoutMs` 범위 안에서 `@OnDisconnect()` cleanup이 마무리될 수 있도록 bounded 기회를 제공합니다. 해결되지 않은 cleanup은 shutdown을 무기한 막지 않고 해당 timeout 안에서 로그로 남습니다. 공식 fetch-style runtime module(`@fluojs/websockets/bun`, `@fluojs/websockets/deno`, `@fluojs/websockets/cloudflare-workers`)은 `Request` typed upgrade guard를 노출하며, 애플리케이션 shutdown 중 동일한 bounded close와 disconnect cleanup 동작을 제공합니다. Cloudflare Workers 애플리케이션 shutdown 중에는 worker subpath가 adapter-owned binding을 유지하고, 새 upgrade 시도를 HTTP dispatch로 넘기지 않고 JSON `503` shutdown response로 거절합니다.

Root `@fluojs/websockets` / `@fluojs/websockets/node` guard는 Node의 `IncomingMessage`를 받습니다. Fetch-style subpath는 Web standard `Request`를 받으므로, 재사용 가능한 옵션 객체를 작성할 때는 subpath별 `WebSocketModuleOptions` 타입을 선택하세요. Guard는 `true`, `undefined`, 또는 return 없음으로 upgrade를 허용하고, `false` 또는 `{ status, body? }` 형태의 `WebSocketUpgradeRejection`으로 거절하거나 `UnauthorizedException` 같은 `HttpException` 계열 오류를 throw할 수 있습니다. Throw된 HTTP exception은 socket이 accept되기 전에 동일한 pre-handshake rejection response로 변환됩니다.

### Room
`WebSocketRoomService`를 사용하면 gateway 또는 application service가 adapter 내부에 접근하지 않고도 가벼운 room membership state를 유지할 수 있습니다. Runtime lifecycle service는 `joinRoom(socketId, room)`, `leaveRoom(socketId, room)`, `broadcastToRoom(room, event, data)`, `getRooms(socketId)`를 구현합니다. `broadcastToRoom(...)`은 현재 room에 있는 열린 socket에 `{ event, data }` 형태의 JSON frame을 보내며, 전송 전에 설정된 backpressure policy를 적용합니다.

```typescript
import { WebSocketRoomService } from '@fluojs/websockets';

class OrderStatusPublisher {
  constructor(private readonly rooms: WebSocketRoomService) {}

  publish(orderId: string, status: string) {
    this.rooms.broadcastToRoom(`order:${orderId}`, 'order.status', { status });
  }
}
```

## 바이너리 페이로드

Gateway `@OnMessage()` handler는 지원 런타임 전반에서 하나의 정규화된 payload contract를 받습니다. Text frame은 가능한 경우 JSON으로 파싱하고, 그렇지 않으면 string으로 전달합니다. Binary frame은 런타임이 Node `Buffer`/typed array, Bun `ArrayBuffer`/view, Deno `ArrayBuffer`/view/`Blob`, Cloudflare Workers `ArrayBuffer`/view/`Blob` 중 어떤 형태로 노출하더라도 UTF-8로 디코딩한 뒤 동일한 JSON/event dispatch 단계를 거칩니다. `limits.maxPayloadBytes` 검사는 모든 표현에 byte length를 사용하며, 허용된 socket에서 oversized payload가 들어오면 close code `1009`로 닫습니다.

Handler return value는 Node, Bun, Deno, Cloudflare Workers 전반에서 완료될 때까지 await된 뒤 무시됩니다. Raw WebSocket handler에서 event object를 반환하지 말고, `socket.send(JSON.stringify({ event: 'pong', data }))`처럼 runtime socket argument를 통해 명시적으로 reply를 보내세요.

## 공개 API 개요

- `@WebSocketGateway(options)`: 클래스를 WebSocket 게이트웨이로 표시합니다.
- `@OnConnect()`: 연결 핸들러를 위한 데코레이터입니다.
- `@OnMessage(event?)`: 인바운드 메시지 핸들러를 위한 데코레이터입니다.
- `@OnDisconnect()`: 연결 해제 핸들러를 위한 데코레이터입니다.
- `WebSocketModule`: WebSocket 통합을 위한 루트 모듈입니다.
- `WebSocketModule.forRoot({ upgrade, limits, backpressure, buffer, heartbeat, shutdown })`: pre-upgrade guard와 bounded runtime default를 구성합니다.
- `WebSocketGatewayLifecycleService`: 기본 Node.js 기반 lifecycle service token인 `NodeWebSocketGatewayLifecycleService`의 루트 alias입니다. 직접 instantiate하는 concrete class가 아니라 DI token placeholder이며, `WebSocketModule.forRoot(...)`가 lazy Node implementation을 연결한 뒤 application container에서 resolve해야 합니다.
- `WebSocketRoomService`: websocket room join, leave, broadcast, 조회를 위해 runtime lifecycle service가 구현하는 Room management contract입니다.
- Typed runtime seam: `WebSocketUpgradeContext`, `WebSocketUpgradeGuard`, `WebSocketUpgradeRejection`, `WebSocketGatewayDescriptor`, `WebSocketGatewayHandlerDescriptor`, 그리고 Node, Bun, Deno, Cloudflare Workers subpath의 runtime socket/binding type.
- Metadata helper와 symbol: `defineWebSocketGatewayMetadata`, `getWebSocketGatewayMetadata`, `defineWebSocketHandlerMetadata`, `getWebSocketHandlerMetadata`, `getWebSocketHandlerMetadataEntries`, `webSocketGatewayMetadataSymbol`, `webSocketHandlerMetadataSymbol`.

## 런타임별 서브패스

기본 루트 Node.js alias 대신 런타임을 명시적으로 고정하고 싶다면 런타임별 서브패스를 사용하세요. 루트 `@fluojs/websockets` 진입점은 Node.js 기본 module export name을 유지하고 `WebSocketGatewayLifecycleService`를 `NodeWebSocketGatewayLifecycleService`와 같은 DI token으로 alias하지만, 단순 root package import는 concrete Node implementation을 lazy runtime provider resolution 뒤에 둡니다. Fetch-style 애플리케이션은 선택한 런타임 서브패스에서 gateway decorator와 metadata helper를 import해 authoring code가 root Node.js-backed module boundary에 의존하지 않게 해야 합니다.

Package manifest의 `engines.node >=20.0.0` 선언은 published package와 기본 Node.js entrypoint 기준입니다. Bun, Deno, Cloudflare Workers 지원은 아래 전용 fetch-style subpath를 통해 노출되며, 해당 subpath는 request/handler type을 web-standard로 유지하고 application code가 root Node.js lifecycle-service alias에 의존하지 않게 합니다.

각 서브패스는 해당 `*WebSocketModule.forRoot(...)` 진입점, 일치하는 런타임 lifecycle service export, 그리고 공유 gateway authoring primitive인 `WebSocketGateway`, `OnConnect`, `OnMessage`, `OnDisconnect`, `defineWebSocketGatewayMetadata`, `getWebSocketGatewayMetadata`, `defineWebSocketHandlerMetadata`, `getWebSocketHandlerMetadata`, `getWebSocketHandlerMetadataEntries`, `webSocketGatewayMetadataSymbol`, `webSocketHandlerMetadataSymbol`을 제공합니다. Bun 서브패스의 low-level binding은 `upgrade(...)`만 가진 `BunWebSocketUpgradeHost`를 받으며, adapter-owned listener shutdown과 raw HTTP fetch 제어는 `@fluojs/platform-bun`에 남습니다.

| 런타임 | 서브패스 | 모듈 | Lifecycle service |
| --- | --- | --- | --- |
| Node.js | `@fluojs/websockets/node` | `NodeWebSocketModule` | `NodeWebSocketGatewayLifecycleService` |
| Bun | `@fluojs/websockets/bun` | `BunWebSocketModule` | `BunWebSocketGatewayLifecycleService` |
| Deno | `@fluojs/websockets/deno` | `DenoWebSocketModule` | `DenoWebSocketGatewayLifecycleService` |
| Workers | `@fluojs/websockets/cloudflare-workers` | `CloudflareWorkersWebSocketModule` | `CloudflareWorkersWebSocketGatewayLifecycleService` |

```typescript
import { BunWebSocketModule, OnMessage, WebSocketGateway } from '@fluojs/websockets/bun';
```

## 예제 소스

- `packages/websockets/src/module.test.ts`
- `packages/websockets/src/public-surface.test.ts`
- `packages/websockets/src/node/node.test.ts`
- `packages/websockets/src/bun/bun.test.ts`
- `packages/websockets/src/deno/deno.test.ts`
- `packages/websockets/src/cloudflare-workers/cloudflare-workers.test.ts`
