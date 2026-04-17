# @fluojs/socket.io

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 런타임용 Socket.IO v4 게이트웨이 어댑터입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [공개 API 개요](#공개-api-개요)
- [지원 플랫폼](#지원-플랫폼)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/core @fluojs/socket.io @fluojs/websockets socket.io
```

## 사용 시점

Socket.IO가 제공하는 room, namespace, broadcast, 자동 재연결 같은 고수준 실시간 기능이 필요할 때 사용합니다. 이 패키지는 raw websocket 대신 Socket.IO v4 서버를 fluo의 `@WebSocketGateway` 기반 모델에 연결합니다.

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

### Raw Socket.IO 서버 접근

```ts
import { SOCKETIO_SERVER } from '@fluojs/socket.io';
import type { Server } from 'socket.io';

@Inject(SOCKETIO_SERVER)
class MyService {
  constructor(private readonly io: Server) {}
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

이제 `cors`를 생략하면 `@fluojs/socket.io`는 `origin: false`를 기본값으로 사용하므로 cross-origin 노출은 명시적 opt-in이 필요합니다. `engine.maxHttpBufferSize`를 생략하면 어댑터가 1 MiB Engine.IO payload 상한을 적용합니다.

### 수동 모듈 조합
일반적인 애플리케이션 모듈에서는 `SocketIoModule.forRoot(...)`가 표준 진입점입니다.
이미 존재하는 커스텀 `defineModule(...)` 등록 안에 같은 Socket.IO provider 집합을 배선해야 할 때는
`createSocketIoProviders(...)`를 지원되는 저수준 공개 API로 계속 사용할 수 있습니다.

```ts
import { defineModule } from '@fluojs/runtime';
import {
  SOCKETIO_ROOM_SERVICE,
  SOCKETIO_SERVER,
  createSocketIoProviders,
} from '@fluojs/socket.io';

class ManualSocketIoModule {}

defineModule(ManualSocketIoModule, {
  exports: [SOCKETIO_ROOM_SERVICE, SOCKETIO_SERVER],
  global: true,
  providers: createSocketIoProviders(),
});
```

## 공개 API 개요

- `SocketIoModule.forRoot(options)`
- `SocketIoModule.forRoot({ auth, cors, engine, ... })`
- `SOCKETIO_SERVER`
- `SOCKETIO_ROOM_SERVICE`
- `createSocketIoProviders(options)`: `SocketIoModule.forRoot(options)`가 사용하는 provider 집합을 반환하며, 지원되는 수동 `defineModule(...)` 조합에 사용할 수 있습니다.

## 지원 플랫폼

| 플랫폼 | 지원 여부 | 비고 |
| --- | --- | --- |
| Node.js (Raw/Express/Fastify) | ✅ 전체 지원 | server-backed mode |
| Bun | ✅ 전체 지원 | `@socket.io/bun-engine` 기반 |
| Deno | ❌ 미지원 | 현재 지원하지 않음 |
| Workers | ❌ 미지원 | 현재 지원하지 않음 |

## 예제 소스

- `packages/socket.io/src/module.test.ts`
