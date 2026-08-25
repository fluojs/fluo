# @fluojs/socket.io

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 런타임용 Socket.IO v4 게이트웨이 어댑터입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [Namespace, Engine.IO path, and gateway scope](#namespace-engineio-path-and-gateway-scope)
- [공개 API 개요](#공개-api-개요)
- [지원 플랫폼](#지원-플랫폼)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/core @fluojs/socket.io @fluojs/websockets socket.io@^4.8.3
```

`@fluojs/socket.io`는 mandatory `@fluojs/runtime` dependency와 동일하게 Node-backed adapter에서 Node.js `>=20.19.3 <21 || >=22.2.0 <27`을 지원합니다. Socket.IO gateway authoring은 `@fluojs/websockets`의 `@WebSocketGateway`, `@OnMessage`, lifecycle decorator를 재사용하므로 companion 패키지도 함께 설치하세요.

`@fluojs/socket.io`는 Socket.IO `^4.8.3`을 요구합니다. 더 오래된 Socket.IO v4 release를 사용하던 consumer는 이 major `@fluojs/socket.io` release를 적용하기 전에 peer를 업그레이드하고 lockfile을 갱신해야 합니다. 갱신된 Engine.IO chain은 패치된 WebSocket runtime을 resolve해야 합니다. fluo adapter API는 그대로입니다.

## 사용 시점

Socket.IO가 제공하는 room, namespace, broadcast, 자동 재연결 같은 고수준 실시간 기능이 필요할 때 사용합니다. 이 패키지는 raw websocket 대신 Socket.IO v4 서버를 fluo의 `@WebSocketGateway` 기반 모델에 연결합니다. 대상 런타임은 Node.js `>=20.19.3 <21 || >=22.2.0 <27` server-backed adapter와 공식 Bun engine path이며, 이 Socket.IO adapter는 Deno와 Workers를 지원하지 않습니다.

## 빠른 시작

```ts
import { Inject, Module } from '@fluojs/core';
import { SOCKETIO_ROOM_SERVICE, SocketIoModule, type SocketIoRoomService } from '@fluojs/socket.io';
import { OnMessage, WebSocketGateway } from '@fluojs/websockets';

@Inject(SOCKETIO_ROOM_SERVICE)
@WebSocketGateway({ path: '/chat' })
class ChatGateway {
  constructor(private readonly rooms: SocketIoRoomService) {}

  @OnMessage('ping')
  handlePing(payload: unknown) {
    this.rooms.broadcastToRoom('chat:lobby', 'pong', payload);
  }
}

@Module({
  imports: [SocketIoModule.forRoot()],
  providers: [ChatGateway],
})
export class AppModule {}
```

## 주요 패턴

### Room 관리

```ts
this.rooms.joinRoom(socket.id, 'room:123');
this.rooms.broadcastToRoom('room:123', 'event', data);
```

Room helper는 공유 `WebSocketRoomService` 계약을 따르면서 Socket.IO namespace 인식을 추가합니다. gateway handler 안에서는 현재 `@WebSocketGateway({ path })` namespace를 자동으로 추론합니다. gateway handler 밖에서 room helper를 실행할 때는 같은 이름의 room이 다른 Socket.IO namespace에 존재할 수 있으므로 대상 namespace path를 명시적으로 전달하세요.

```ts
this.rooms.broadcastToRoom('room:123', 'event', data, '/chat');
this.rooms.joinRoom(socketId, 'room:123', '/chat');
```

### Raw Socket.IO 서버 접근

```ts
import { SOCKETIO_SERVER } from '@fluojs/socket.io';
import type { Server } from 'socket.io';

@Inject(SOCKETIO_SERVER)
class MyService {
  constructor(private readonly io: Server) {}
}
```

Raw server 접근은 좁게 유지하고, 공유 room 계약이 의도적으로 감싸지 않는 Socket.IO 전용 의미론에 사용하세요. 예를 들어 native multi-room emit이나 volatile delivery는 raw server 경계에 둡니다:

```ts
@Inject(SOCKETIO_SERVER)
class SupportBroadcasts {
  constructor(private readonly io: Server) {}

  broadcastUrgent(message: string) {
    this.io.of('/support').to(['ticket:active', 'staff:updates']).emit('announcement', { message });
  }

  sendTyping(ticketId: string, userId: string) {
    this.io.of('/support').volatile.to(`ticket:${ticketId}`).emit('typing', { userId });
  }
}
```

### Handler return value와 ACK reply

Socket.IO gateway handler는 공유 `@fluojs/websockets` positional handler 모델인 `(payload, socket, request, acknowledgement)`를 사용합니다. 반환값은 오류 격리와 순서를 위해 await되지만 무시됩니다. fluo는 handler 반환값을 암묵적인 Socket.IO emit 또는 ACK reply로 변환하지 않습니다. NestJS `@SubscribeMessage()` handler가 반환값으로 ACK payload를 보내던 경우에는 `acknowledgement` callback을 명시적으로 호출하거나 `SOCKETIO_SERVER`를 주입해 raw server 경계에서 emit하도록 재작성하세요.

```ts
@OnMessage('ping')
handlePing(payload: unknown, _socket: Socket, _request: SocketIoHandshakeRequest, ack?: (response: unknown) => void) {
  ack?.({ event: 'pong', payload });
}
```

### auth guard, 안전한 CORS 기본값, bounded payload
`SocketIoModule.forRoot(...)`로 namespace/message 인증을 명시하고, CORS를 deny-by-default로 유지하며, 인바운드 Engine.IO payload 크기를 제한할 수 있습니다.

```ts
SocketIoModule.forRoot({
  auth: {
    connection({ socket }) {
      return socket.handshake.auth.token === 'demo-token'
        ? true
        : { message: 'Authentication required.' };
    },
    message({ payload }) {
      return payload === 'allowed'
        ? true
        : { message: 'Forbidden event.' };
    },
  },
  cors: {
    origin: ['https://app.example.com'],
  },
  engine: {
    maxHttpBufferSize: 65_536,
  },
});
```

`cors`를 생략하면 `@fluojs/socket.io`는 `{ credentials: false, origin: false }`를 기본값으로 사용하므로 cross-origin 노출은 명시적 opt-in이 필요합니다. `engine.maxHttpBufferSize`를 생략하면 어댑터가 1 MiB Engine.IO payload 상한을 적용합니다. 기본값에는 `buffer.maxPendingMessagesPerSocket: 128`, `buffer.overflowPolicy: 'drop-oldest'`, `shutdown.timeoutMs: 5000`도 포함됩니다. `buffer.overflowPolicy`는 최신 pending event를 유지하려면 `'drop-oldest'`, 이미 queue된 event를 보존하려면 `'drop-newest'`, bound를 초과한 socket을 disconnect하려면 `'close'`로 설정합니다. `buffer` 옵션은 socket 연결 후 connection handler가 준비되기 전에 들어온 inbound event를 제한하며, outbound emit이나 Socket.IO reconnect buffering을 제어하지 않습니다. 설정한 `transports`는 Node-backed path와 Bun engine path 모두에서 적용되므로 목록에 없는 transport를 사용하는 client는 Engine.IO handshake 중 거부됩니다. 명시적인 `engine.maxHttpBufferSize`, `buffer.maxPendingMessagesPerSocket`, `shutdown.timeoutMs` 값은 양의 정수여야 하며, 잘못된 명시 값은 기본값으로 fallback하지 않고 모듈 등록 중 실패합니다.

정적 `@WebSocketGateway({ path })` namespace는 fluo gateway discovery가 소유하며 Socket.IO dynamic child namespace로 취급하지 않습니다. 어댑터는 이러한 정적 namespace에 대해 Socket.IO의 `cleanupEmptyChildNamespaces` 동작을 비활성화합니다. 애플리케이션 코드가 raw `SOCKETIO_SERVER` 접근으로 dynamic child namespace를 만들면 해당 소유권과 cleanup 정책은 애플리케이션 수준 Socket.IO 통합이 담당합니다.

애플리케이션 종료 중 Socket.IO client 정리는 Socket.IO가 소유하지만 underlying HTTP server는 이를 제공한 platform adapter 또는 shared HTTP server 통합이 계속 소유합니다. 어댑터는 `io.close(...)` 전에 해당 HTTP server 참조를 분리하므로 client cleanup은 실행되지만 Socket.IO가 adapter-owned/shared HTTP listener를 닫지는 않습니다. 수락된 gateway connection, message, disconnect 작업은 동일한 `shutdown.timeoutMs` bound 안에서 managed namespace와 socket state를 지우기 전에 drain됩니다. Graceful Socket.IO close가 이 bound를 넘으면 managed Socket.IO client를 force-disconnect하며, force cleanup이 실패하거나 수락된 gateway 작업이 drain되지 않으면 shutdown retry를 위해 managed server reference와 registry를 보존합니다. 동일한 managed Socket.IO instance 주변에 별도의 manual socket-disconnect 경로를 추가하지 마세요.

### Guard 계약

`auth.connection`은 namespace connect handler가 실행되기 전에 `SocketIoConnectionGuardContext`를 받습니다. `auth.message`는 message handler가 실행되기 전에 `SocketIoMessageGuardContext`를 받습니다. Guard는 `true`, `undefined`, 또는 아무 값도 반환하지 않으면 허용합니다. `false` 또는 `message`, optional `data`, optional `disconnect`를 가진 `SocketIoGuardRejection`을 반환하면 거부합니다. Connection rejection은 Socket.IO namespace connection error 경로를 사용합니다. Message rejection은 해당 event에 acknowledgement callback이 제공된 경우에만 `{ error, data }` 형태의 ACK payload로 전달되며, ACK callback이 없으면 fluo는 암묵적인 client error event를 emit하지 않습니다. 명시적인 `disconnect: true`는 그대로 socket 연결을 종료합니다. Root export의 `SocketIoHandshakeRequest`는 런타임 중립으로 유지됩니다. Node-backed adapter는 구조적으로 typed HTTP handshake request를 제공하고 Bun은 Web-standard `Request`를 제공합니다.

### Namespace, Engine.IO path, and gateway scope

`@WebSocketGateway({ path: '/chat' })`의 `path`는 Socket.IO namespace `/chat`에 매핑되며 Engine.IO HTTP request path를 바꾸지 않습니다. Engine.IO path는 `/socket.io/`로 유지됩니다. 이는 gateway `path` option을 Engine.IO path로 사용하는 NestJS configuration과 다릅니다. Socket.IO gateway는 application listener를 공유하므로 모든 runtime에서 `@WebSocketGateway({ serverBacked })`를 거부합니다. Gateway는 singleton provider 또는 controller로 등록하세요. Request/transient scope로 migration된 gateway는 instantiate되지 않고 warning 후 skip됩니다.

### Bun 전용 참고

Bun path는 `@socket.io/bun-engine`과 HTTP adapter의 versioned realtime binding capability를 통해 Socket.IO를 지원하지만 static CORS shape가 필요합니다. CORS delegate function과 `cors.origin` array 안의 boolean entry는 지원하지 않습니다. `@WebSocketGateway({ serverBacked })`는 지원하지 않습니다. Bun의 HTTP request body limit(`maxRequestBodySize`)과 WebSocket frame limit(`websocket.maxPayloadLength`)은 별도 host contract입니다. 어댑터는 polling request와 websocket frame이 같은 inbound payload bound를 따르도록 두 값을 모두 `engine.maxHttpBufferSize`에서 매핑합니다.

### 모듈 등록
`SocketIoModule.forRoot(...)`로 Socket.IO를 등록합니다.

Socket.IO 등록은 소유 모듈의 import 경로에서 구성하여 namespace/message guard, CORS, Engine.IO 옵션을 한 곳에서 관리합니다.

## 공개 API 개요

- `SocketIoModule.forRoot(options)`: Socket.IO 통합의 기본 모듈입니다.
- `SocketIoModule.forRoot({ global, auth, cors, engine, ... })`: provider visibility, namespace/message guard, 명시적 CORS, Engine.IO payload bound를 구성합니다.
- `SOCKETIO_SERVER`: raw Socket.IO `Server`를 주입하기 위한 토큰입니다.
- `SOCKETIO_ROOM_SERVICE`: `SocketIoRoomService`를 주입하기 위한 토큰입니다.
- `SocketIoRoomService`: 공유 room 계약에 Socket.IO namespace-aware `joinRoom`, `leaveRoom`, `broadcastToRoom`, `getRooms` helper를 더한 타입입니다.
- `SocketIoLifecycleService`: server와 room-service token 뒤에서 동작하는 lifecycle 기반 구현입니다. 애플리케이션 코드는 일반적으로 `SOCKETIO_SERVER` 또는 `SOCKETIO_ROOM_SERVICE`를 주입하세요.
- 타입: `SocketIoModuleOptions`, `SocketIoHandshakeRequest`, `SocketIoConnectionGuardContext`, `SocketIoConnectionGuard`, `SocketIoMessageGuardContext`, `SocketIoMessageGuard`, `SocketIoGuardRejection`.

`SocketIoModuleOptions`는 `global`, `auth`, `buffer`, `cors`, `engine`, `shutdown`, `transports`를 포함합니다. `global`의 기본값은 `true`이므로 `SOCKETIO_SERVER`와 `SOCKETIO_ROOM_SERVICE`가 앱 전체에서 보입니다. module-local provider visibility가 필요하면 `false`로 설정하세요. 지원되는 Node.js `>=20.19.3 <21 || >=22.2.0 <27` server-backed runtime adapter 또는 공식 Bun engine host가 필요하며, unsupported/noop adapter는 bootstrap 중 빠르게 실패합니다. Socket.IO는 모든 runtime에서 `@WebSocketGateway({ serverBacked })`를 거부하고 Bun은 추가로 static CORS shape를 요구합니다.

## 지원 플랫폼

| 플랫폼 | 지원 여부 | 비고 |
| --- | --- | --- |
| Node.js (Raw/Express/Fastify) | ✅ 전체 지원 | Node.js `>=20.19.3 <21 || >=22.2.0 <27`; shared application listener |
| Bun | ✅ 전체 지원 | `@socket.io/bun-engine` 기반; static CORS만 지원, `serverBacked` gateway 미지원 |
| Deno | ❌ 미지원 | 현재 지원하지 않음 |
| Workers | ❌ 미지원 | 현재 지원하지 않음 |

## 예제 소스

- `packages/socket.io/src/bun-initialization.test.ts`
- `packages/socket.io/src/config.internal.test.ts`
- `packages/socket.io/src/module.test.ts`
- `packages/socket.io/src/public-surface.test.ts`
- `packages/socket.io/src/shutdown-lifecycle.test.ts`
