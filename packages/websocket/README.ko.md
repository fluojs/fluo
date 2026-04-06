# @konekti/websocket

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


Konekti 애플리케이션용 데코레이터 기반 WebSocket 게이트웨이 작성 코어이며, 현재 raw `ws` Node 바인딩은 명시적 `@konekti/websocket/node` 서브패스로 분리되었습니다.

## 관련 문서

- `../runtime/README.ko.md`
- `../../docs/operations/third-party-extension-contract.ko.md`
- `../../docs/reference/package-chooser.ko.md`
- `../../docs/reference/package-surface.ko.md`

## 설치

```bash
npm install @konekti/websocket ws
```

데코레이터와 공용 게이트웨이 계약은 `@konekti/websocket`에서 가져오고, Node 기반 HTTP 어댑터에서 raw `ws`를 붙일 때만 `@konekti/websocket/node`를 추가하세요.

## 빠른 시작

```typescript
import { Module } from '@konekti/core';
import { OnConnect, OnDisconnect, OnMessage, WebSocketGateway } from '@konekti/websocket';
import { NodeWebSocketModule } from '@konekti/websocket/node';
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
- `@OnMessage(event?)`
- `@OnConnect()`
- `@OnDisconnect()`

## Node 바인딩 서브패스

- `@konekti/websocket/node`의 `NodeWebSocketModule.forRoot()` - Node 기반 어댑터용 raw `ws` upgrade 바인딩 등록
- `@konekti/websocket/node`의 `createNodeWebSocketProviders()` - Node websocket 모듈 구성을 위한 raw provider 반환

### 호환 alias

`WebSocketModule.forRoot()`와 `createWebSocketProviders()`는 현재 Node 바인딩을 위한 호환 alias로 루트 배럴에도 남아 있지만, 명시적 Node 전용 seam의 실제 위치는 이제 `@konekti/websocket/node`입니다.

### 내부 모듈 배선 토큰

`@konekti/websocket`는 lifecycle DI 토큰을 공개 API로 노출하지 않습니다. 게이트웨이 탐색/배선 토큰은 내부 구현 세부사항이며, 게이트웨이 작성 계약은 데코레이터 + 클래스 프로바이더 중심으로 유지됩니다.
`WEBSOCKET_OPTIONS`는 내부 모듈 배선으로 한정되며, 루트 엔트리포인트 토큰 표면의 일부가 아닙니다.
이 토큰은 패키지 내부 DI 식별성을 모듈 경계에서 안정적으로 유지하기 위해 여전히 `Symbol.for(...)` 안정 키를 사용하지만, 공개 계약으로 승격되지는 않습니다.

### Node 모듈 옵션

`NodeWebSocketModule.forRoot(options)`와 `createNodeWebSocketProviders(options)`는 아래 옵션을 받습니다.

- `heartbeat.enabled`, `heartbeat.intervalMs`, `heartbeat.timeoutMs`
- `shutdown.timeoutMs` (기본값: `5000`)

## 런타임 동작

- `onApplicationBootstrap()`에서 `COMPILED_MODULES`를 기준으로 게이트웨이 탐색
- 게이트웨이 인스턴스는 `RUNTIME_CONTAINER`에서 해석
- 명시적 Node seam은 `ws`의 `noServer` 모드와 단일 Node 서버 `upgrade` 리스너를 사용
- 게이트웨이 경로는 정규화 후 정확히 일치해야 연결 처리
- `request`/`transient` 스코프 게이트웨이는 경고 후 제외
- Node 바인딩 종료 시 업그레이드 리스너 제거 및 활성 소켓 정리
- `message`/`close` 이벤트는 `@OnConnect()` 핸들러가 끝날 때까지 버퍼링되며, 이후 순서대로 재생되어 connect 단계 이벤트가 조용히 유실되지 않습니다
- attachment server 종료는 timeout 인지 방식으로 처리되며, 제한 시간 안에 close가 끝나지 않으면 무기한 대기하지 않고 로그를 남깁니다
- `getRooms(socketId)`는 방 목록의 방어적 스냅샷(`ReadonlySet`)을 반환하므로 외부에서 내부 room 인덱스를 오염시킬 수 없습니다

## 의도된 제한 사항

- `@konekti/websocket` 루트는 게이트웨이 작성용 데코레이터, 메타데이터, 디스크립터, 공용 room 계약에 집중하며, 현재 raw `ws` Node 런타임 배선은 의도적으로 `@konekti/websocket/node`로 격리합니다.
- 이제 명시적 realtime capability seam의 소유권은 플랫폼 선택 경계에 있습니다. 이 패키지 자체가 런타임/플랫폼 결정을 내리지는 않으며, 현재 raw `ws` 바인딩은 계속 Node 기반 server capability를 전제로 합니다.

## 프로바이더 등록 제약

게이트웨이 클래스는 반드시 **클래스 프로바이더**로 등록해야 합니다 — 직접 등록(`providers: [MyGateway]`) 또는 `useClass` 방식(`{ provide: TOKEN, useClass: MyGateway }`) 중 하나를 사용하세요. `useValue` 또는 `useFactory`로 등록한 프로바이더는 런타임에 데코레이터 클래스와 연결할 수 없어 게이트웨이 탐색 중 무음으로 건너뜁니다. 게이트웨이가 연결되지 않는 경우, 프로바이더 항목이 클래스 생성자를 사용하고 있는지 확인하세요.
