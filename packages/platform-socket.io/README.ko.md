# @konekti/platform-socket.io

<p><strong><kbd>한국어</kbd></strong> <a href="./README.md"><kbd>English</kbd></a></p>

Konekti 애플리케이션을 위한 Socket.IO v4 게이트웨이 어댑터입니다.

## Installation

```bash
npm install @konekti/platform-socket.io @konekti/websocket socket.io
```

## Quick Start

```typescript
import { Inject, Module } from '@konekti/core';
import { createSocketIoModule, SOCKETIO_ROOM_SERVICE, type SocketIoRoomService } from '@konekti/platform-socket.io';
import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '@konekti/websocket';
import type { Socket } from 'socket.io';

@Inject([SOCKETIO_ROOM_SERVICE])
@WebSocketGateway({ path: '/chat' })
class ChatGateway {
  constructor(private readonly rooms: SocketIoRoomService) {}

  @OnConnect()
  handleConnect(socket: Socket) {
    this.rooms.joinRoom(socket.id, 'chat:lobby');
  }

  @OnMessage('ping')
  handlePing(payload: unknown) {
    this.rooms.broadcastToRoom('chat:lobby', 'pong', payload);
  }

  @OnDisconnect()
  handleDisconnect(socket: Socket, reason: string) {
    this.rooms.leaveRoom(socket.id, 'chat:lobby');
    console.log(reason);
  }
}

@Module({
  imports: [createSocketIoModule({ transports: ['websocket'] })],
  providers: [ChatGateway],
})
export class AppModule {}
```

## API

- `createSocketIoModule()` - 라이프사이클 디스커버리와 Socket.IO 네임스페이스 바인딩을 등록합니다
- `createSocketIoProviders()` - 커스텀 모듈 조합용 raw provider 배열을 반환합니다
- `SOCKETIO_SERVER` - Socket.IO `Server` 인스턴스를 DI로 주입합니다
- `SOCKETIO_ROOM_SERVICE` - Socket.IO 네이티브 room API 기반 헬퍼를 주입합니다

### Module options

`createSocketIoModule(options)` 및 `createSocketIoProviders(options)`는 다음 옵션을 받습니다.

- `cors`
- `transports`
- `shutdown.timeoutMs` (기본값: `5000`)

## Runtime behavior

- `@konekti/websocket` 데코레이터와 메타데이터 디스커버리를 재사용합니다
- `@WebSocketGateway({ path })`를 Socket.IO 네임스페이스로 매핑합니다 (`/`는 기본 네임스페이스 사용)
- 연결된 네임스페이스 소켓마다 `@OnConnect()`, `@OnMessage(event?)`, `@OnDisconnect()` 핸들러를 바인딩합니다
- 런타임 DI 컨테이너에서 게이트웨이 인스턴스를 resolve하며, singleton이 아닌 게이트웨이는 경고 후 건너뜁니다
- 공용 `SocketIoRoomService` 추상화를 통해 room 헬퍼를 노출합니다
- 타임아웃을 고려한 종료 처리로 Socket.IO 서버를 닫습니다

## `@konekti/websocket`과의 차이

- `@konekti/websocket`은 공용 Node 서버의 raw `ws` upgrade 처리에 초점을 둡니다
- `@konekti/platform-socket.io`는 Socket.IO v4 네임스페이스, room, acknowledgement, transport fallback 동작에 초점을 둡니다
- 데코레이터는 공유하지만, transport 전용 서버와 room 구현은 이 패키지가 담당합니다
