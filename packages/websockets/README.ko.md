# @fluojs/websockets

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 런타임을 위한 데코레이터 기반 WebSocket 게이트웨이 작성 패키지입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
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

```typescript
import { WebSocketGateway, OnConnect, OnMessage } from '@fluojs/websockets';
import { NodeWebSocketModule } from '@fluojs/websockets/node';
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
  imports: [NodeWebSocketModule.forRoot()],
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

### Server-Backed (Node.js 전용)
Node 기반 어댑터(Express/Fastify)의 경우 전용 리스너 포트를 사용하도록 설정할 수 있습니다.

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

옵션을 생략하면 `@fluojs/websockets`는 동시 연결 수와 인바운드 페이로드 크기에 대해 기본 제한값을 적용합니다. 또한 server-backed Node 리스너는 `heartbeat.enabled`를 명시적으로 `false`로 두지 않는 한 heartbeat 타이머를 활성화합니다.

## 공개 API 개요

- `@WebSocketGateway(options)`: 클래스를 WebSocket 게이트웨이로 표시합니다.
- `@OnConnect()`: 연결 핸들러를 위한 데코레이터입니다.
- `@OnMessage(event?)`: 인바운드 메시지 핸들러를 위한 데코레이터입니다.
- `@OnDisconnect()`: 연결 해제 핸들러를 위한 데코레이터입니다.
- `WebSocketModule`: WebSocket 통합을 위한 루트 모듈입니다.
- `WebSocketModule.forRoot({ upgrade, limits, heartbeat, ... })`: pre-upgrade guard와 기본 제한값을 구성합니다.

## 런타임별 서브패스

| 런타임 | 서브패스 | 모듈 |
| --- | --- | --- |
| Node.js | `@fluojs/websockets/node` | `NodeWebSocketModule` |
| Bun | `@fluojs/websockets/bun` | `BunWebSocketModule` |
| Deno | `@fluojs/websockets/deno` | `DenoWebSocketModule` |
| Workers | `@fluojs/websockets/cloudflare-workers` | `CloudflareWorkersWebSocketModule` |

## 예제 소스

- `packages/websockets/src/module.test.ts`
- `packages/websockets/src/node/node.test.ts`
- `packages/websockets/src/bun/bun.test.ts`
