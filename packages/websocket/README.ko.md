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
- `message` 및 `close` 리스너는 `@OnConnect()` 핸들러가 모두 완료된 후에 등록되므로, `onConnect` 완료 이전에 도착한 메시지나 연결 종료 이벤트는 게이트웨이 핸들러에 전달되지 않습니다

## 프로바이더 등록 제약

게이트웨이 클래스는 반드시 **클래스 프로바이더**로 등록해야 합니다 — 직접 등록(`providers: [MyGateway]`) 또는 `useClass` 방식(`{ provide: TOKEN, useClass: MyGateway }`) 중 하나를 사용하세요. `useValue` 또는 `useFactory`로 등록한 프로바이더는 런타임에 데코레이터 클래스와 연결할 수 없어 게이트웨이 탐색 중 무음으로 건너뜁니다. 게이트웨이가 연결되지 않는 경우, 프로바이더 항목이 클래스 생성자를 사용하고 있는지 확인하세요.
