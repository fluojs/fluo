# @konekti/socket.io

<p><strong><kbd>한국어</kbd></strong> <a href="./README.md"><kbd>English</kbd></a></p>

Konekti 애플리케이션을 위한 Socket.IO v4 게이트웨이 어댑터입니다.

## Installation

```bash
npm install @konekti/socket.io @konekti/websockets socket.io
```

### Migration note (semver-major)

- `@konekti/platform-socket.io` 패키지 이름이 `@konekti/socket.io`로 변경되었습니다.
- 패키지 import를 `@konekti/platform-socket.io`에서 `@konekti/socket.io`로 바꾸세요.
- Socket.IO 게이트웨이 프로젝트는 공용 데코레이터 import도 `@konekti/websockets`로 함께 바꿔야 합니다.

## Quick Start

```typescript
import { Inject, Module } from '@konekti/core';
import { SocketIoModule, SOCKETIO_ROOM_SERVICE, type SocketIoRoomService } from '@konekti/socket.io';
import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '@konekti/websockets';
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
  imports: [SocketIoModule.forRoot({ transports: ['websocket'] })],
  providers: [ChatGateway],
})
export class AppModule {}
```

## API

- `SocketIoModule.forRoot()` - 라이프사이클 디스커버리와 Socket.IO 네임스페이스 바인딩을 등록합니다
- `createSocketIoProviders()` - 커스텀 모듈 조합용 raw provider 배열을 반환합니다
- `SOCKETIO_SERVER` - Socket.IO `Server` 인스턴스를 DI로 주입합니다
- `SOCKETIO_ROOM_SERVICE` - Socket.IO 네이티브 room API 기반 헬퍼를 주입합니다

루트 패키지 엔트리포인트의 공개 토큰 표면은 `SOCKETIO_SERVER`와 `SOCKETIO_ROOM_SERVICE`에 집중하도록 의도적으로 제한됩니다.
`SOCKETIO_OPTIONS`는 내부 모듈 배선 토큰으로 유지되며 루트 공개 토큰 seam 바깥으로 의도적으로 국소화되어 있습니다.
이 토큰은 패키지 내부 DI 식별성을 모듈 경계에서 일관되게 유지하기 위해 여전히 `Symbol.for(...)` 안정 키를 사용하지만, 공개 계약에는 포함되지 않습니다.

### Migration note (0.x)

`SOCKETIO_LIFECYCLE_SERVICE`는 더 이상 루트 공개 엔트리포인트와 `SocketIoModule.forRoot()`의 exports에 포함되지 않습니다.
소비자는 room 헬퍼에는 `SOCKETIO_ROOM_SERVICE`를, raw Socket.IO 서버 접근에는 `SOCKETIO_SERVER`를 주입해야 합니다.

### Module options

`SocketIoModule.forRoot(options)` 및 `createSocketIoProviders(options)`는 다음 옵션을 받습니다.

- `cors`
- `transports`
- `shutdown.timeoutMs` (기본값: `5000`)

## 지원 어댑터 매트릭스

`@konekti/socket.io`는 현재 realtime capability seam을 통해 호환 가능한 Node HTTP/S host를 노출하는 server-backed 어댑터에서만 문서화·회귀 테스트되어 있습니다.

- `@konekti/platform-nodejs`
- `@konekti/platform-fastify`
- `@konekti/platform-express`

현재 이 패키지에서 Socket.IO 미지원 상태를 명시적으로 유지하는 런타임은 다음과 같습니다.

- `@konekti/platform-bun`
- `@konekti/platform-deno`
- `@konekti/platform-cloudflare-workers`

## Runtime behavior

- `@konekti/websockets` 데코레이터와 메타데이터 디스커버리를 재사용합니다
- 플랫폼이 선택한 realtime capability를 소비하며, 선택된 HTTP 어댑터가 `{ kind: 'server-backed', server }`를 보고할 때만 부팅합니다
- `@WebSocketGateway({ path })`를 Socket.IO 네임스페이스로 매핑합니다 (`/`는 기본 네임스페이스 사용)
- 연결된 네임스페이스 소켓마다 `@OnConnect()`, `@OnMessage(event?)`, `@OnDisconnect()` 핸들러를 바인딩합니다
- 런타임 DI 컨테이너에서 게이트웨이 인스턴스를 resolve하며, singleton이 아닌 게이트웨이는 경고 후 건너뜁니다
- 공용 `SocketIoRoomService` 추상화를 통해 room 헬퍼를 노출합니다
- 비동기 `@OnDisconnect()` 핸들러가 끝날 때까지 room helper를 사용할 수 있게 유지한 뒤, 소켓을 내부 레지스트리에서 제거합니다
- 소켓 단위 `error` 이벤트를 로깅하고, 오류가 난 소켓을 내부 레지스트리에서 제거합니다
- 타임아웃을 고려한 종료 처리로 Socket.IO 서버를 닫습니다

## 의도된 제한 사항

- `@konekti/socket.io`는 `getServer()` 존재만으로 유효한 realtime 런타임이라고 가정하지 않습니다. 선택된 플랫폼 어댑터가 보고하는 명시적 realtime capability만 따릅니다.
- 현재 Socket.IO 지원 주장은 namespace, room, shutdown 동작이 회귀 테스트된 `@konekti/platform-nodejs`, `@konekti/platform-fastify`, `@konekti/platform-express`로 제한됩니다.
- `{ kind: 'unsupported', mode: 'no-op' }`를 보고하는 런타임은 그 명시적 경계에서 중단됩니다. 이 패키지는 Worker/fetch-style 런타임을 위해 Node listener lifecycle을 에뮬레이션하지 않습니다.
- Bun, Deno, Cloudflare Workers는 이 패키지에 테스트된 호환 구현이 추가되기 전까지 Socket.IO 지원 주장 범위에 포함되지 않습니다.

## `@konekti/websockets`과의 차이

- `@konekti/websockets/node`는 공용 Node 서버의 raw `ws` upgrade 처리에 초점을 두고, `@konekti/websockets` 루트는 공용 게이트웨이 데코레이터와 메타데이터에 집중합니다
- `@konekti/socket.io`는 Socket.IO v4 네임스페이스, room, acknowledgement, transport fallback 동작에 초점을 둡니다
- 데코레이터는 공유하지만, transport 전용 서버와 room 구현은 이 패키지가 담당합니다
