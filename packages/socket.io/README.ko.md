# @konekti/socket.io

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 런타임용 Socket.IO v4 게이트웨이 어댑터입니다.

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
npm install @konekti/socket.io @konekti/websockets socket.io
```

## 사용 시점

Socket.IO가 제공하는 room, namespace, broadcast, 자동 재연결 같은 고수준 실시간 기능이 필요할 때 사용합니다. 이 패키지는 raw websocket 대신 Socket.IO v4 서버를 Konekti의 `@WebSocketGateway` 기반 모델에 연결합니다.

## 빠른 시작

```ts
import { Inject, Module } from '@konekti/core';
import { SOCKETIO_ROOM_SERVICE, SocketIoModule, type SocketIoRoomService } from '@konekti/socket.io';
import { OnMessage, WebSocketGateway } from '@konekti/websockets';

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
import { SOCKETIO_SERVER } from '@konekti/socket.io';
import type { Server } from 'socket.io';

@Inject(SOCKETIO_SERVER)
class MyService {
  constructor(private readonly io: Server) {}
}
```

## 공개 API 개요

- `SocketIoModule.forRoot(options)`
- `SOCKETIO_SERVER`
- `SOCKETIO_ROOM_SERVICE`
- `createSocketIoProviders(options)`

## 지원 플랫폼

| 플랫폼 | 지원 여부 | 비고 |
| --- | --- | --- |
| Node.js (Raw/Express/Fastify) | ✅ 전체 지원 | server-backed mode |
| Bun | ✅ 전체 지원 | `@socket.io/bun-engine` 기반 |
| Deno | ❌ 미지원 | 현재 지원하지 않음 |
| Workers | ❌ 미지원 | 현재 지원하지 않음 |

## 예제 소스

- `packages/socket.io/src/module.test.ts`
