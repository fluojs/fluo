# @konekti/websocket

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


공유 Node HTTP/S 서버의 업그레이드 리스너를 사용하는 Konekti용 데코레이터 기반 WebSocket 게이트웨이 패키지입니다.

## 설치

```bash
npm install @konekti/websocket ws
```

## 빠른 시작

```typescript
import { Module } from '@konekti/core';
import { createWebSocketModule, OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '@konekti/websocket';
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
  imports: [createWebSocketModule()],
  providers: [ChatGateway],
})
export class AppModule {}
```

## API

- `createWebSocketModule()`
- `createWebSocketProviders()`
- `@WebSocketGateway({ path? })`
- `@OnMessage(event?)`
- `@OnConnect()`
- `@OnDisconnect()`

## 런타임 동작

- `onApplicationBootstrap()`에서 `COMPILED_MODULES`를 기준으로 게이트웨이 탐색
- 게이트웨이 인스턴스는 `RUNTIME_CONTAINER`에서 해석
- `ws`의 `noServer` 모드와 단일 Node 서버 `upgrade` 리스너 사용
- 게이트웨이 경로는 정규화 후 정확히 일치해야 연결 처리
- `request`/`transient` 스코프 게이트웨이는 경고 후 제외
- 종료 시 업그레이드 리스너 제거 및 활성 소켓 정리
