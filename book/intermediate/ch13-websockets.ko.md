<!-- packages: @fluojs/websockets -->
<!-- project-state: FluoShop v2.2.0 -->

# 13. WebSocket Gateways

API request와 event는 과거에 일어난 일을 설명합니다.

WebSocket은 지금 이 순간 일어나고 있는 일을 설명합니다.

FluoShop이 v2.2.0으로 나아가면서, 플랫폼은 client가 polling하게 만들지 않고도 backend의 상태 변화와 frontend의 사용자 경험 사이의 간극을 메워야 합니다.

`@fluojs/websockets` 패키지는 우리가 지금까지 만든 HTTP controller나 event handler와 동일하게 느껴지는 decorator-driven 방식으로 WebSocket gateway를 작성할 수 있게 해줍니다.

이 패키지는 다양한 JavaScript runtime에 걸쳐 handshake, message routing, disconnection cleanup의 복잡함을 처리합니다.

이 장에서는 주문이 fulfillment pipeline을 따라 이동할 때 고객에게 실시간으로 정보를 제공하는 order status gateway를 구축하는 방법을 다룹니다.

## 13.1 The shift to real-time

이전 장들에서 FluoShop은 request-response cycle에 의존했습니다.

사용자가 command를 보내면 backend가 이를 처리하고, response가 결과를 확인해 줍니다.

사용자가 주문 배송과 같은 업데이트를 확인하고 싶다면 보통 페이지를 새로고침하거나 background polling script가 GET endpoint를 호출할 때까지 기다려야 합니다.

이는 비효율적이며 불필요한 부하를 생성합니다.

WebSocket은 이 계약을 바꿉니다.

Client는 persistent connection을 열고, 서버는 업데이트가 발생하는 즉시 push합니다.

fluo에서 이 전환은 Gateway를 통해 관리됩니다.

## 13.2 WebSocket module wiring

실시간 기능을 활성화하기 위해 `WebSocketModule`을 등록합니다.

기본적으로 fluo는 Node.js 기반 runtime을 사용하지만, 이 패키지는 runtime-agnostic하게 설계되었습니다.

```typescript
import { Module } from '@fluojs/core';
import { WebSocketModule } from '@fluojs/websockets';

@Module({
  imports: [WebSocketModule.forRoot()],
  providers: [OrderStatusGateway],
})
export class RealTimeModule {}
```

`forRoot()` 호출은 기본 engine을 초기화하고 프레임워크가 `@WebSocketGateway`로 장식된 클래스를 찾을 수 있도록 준비합니다.

## 13.3 Creating a gateway

Gateway는 특정 실시간 영역을 관리하는 클래스입니다.

FluoShop에서는 주문 업데이트를 위한 전용 gateway를 원합니다.

```typescript
import { 
  WebSocketGateway, 
  OnConnect, 
  OnMessage, 
  OnDisconnect 
} from '@fluojs/websockets';

@WebSocketGateway({ path: '/orders/updates' })
export class OrderStatusGateway {
  @OnConnect()
  handleConnection(socket: any) {
    console.log('Client connected for order updates');
  }

  @OnMessage('subscribe')
  handleSubscription(payload: { orderId: string }, socket: any) {
    // 소켓을 주문에 연결하는 로직
  }

  @OnDisconnect()
  handleDisconnect(socket: any) {
    console.log('Client disconnected');
  }
}
```

`@OnConnect`, `@OnMessage`, `@OnDisconnect` decorator는 WebSocket lifecycle에 직접 매핑됩니다.

이 구조는 익숙하게 느껴져야 합니다.

HTTP `@Get` 및 Event `@OnEvent` handler에서 사용했던 것과 동일한 declarative pattern을 따릅니다.

## 13.4 Bounded defaults and guards

Production 환경에서는 WebSocket을 완전히 열어둘 수 없습니다.

WebSocket은 서버의 persistent resource(메모리 및 file descriptor)를 소모합니다.

`@fluojs/websockets` 패키지는 concurrent connection과 payload size에 대한 bounded default를 자동으로 적용합니다.

이러한 설정은 module 수준에서 조정할 수 있습니다.

```typescript
WebSocketModule.forRoot({
  limits: {
    maxConnections: 1000,
    maxPayloadBytes: 32_768, // 32KB
  },
  upgrade: {
    guard(request) {
      // Handshake 수준의 보안
      const token = request.headers.authorization;
      if (!isValid(token)) throw new UnauthorizedException();
    }
  }
})
```

`upgrade.guard`는 특히 중요합니다.

이것은 WebSocket handshake가 완료되기 전에 실행됩니다.

Guard가 실패하면 connection은 즉시 거부되며, 서버가 인증되지 않은 client를 위해 리소스를 할당하지 않도록 보호합니다.

## 13.5 Integrating with FluoShop events

Gateway 그 자체는 단지 파이프일 뿐입니다.

이를 유용하게 만들기 위해 FluoShop event bus에 연결합니다.

Backend에서 `OrderShippedEvent`가 발생하면, gateway는 관련 client에게 메시지를 push해야 합니다.

```typescript
import { OnEvent } from '@fluojs/events';
import { WebSocketGateway } from '@fluojs/websockets';

@WebSocketGateway({ path: '/orders/updates' })
export class OrderStatusGateway {
  private clients = new Map<string, any>();

  @OnMessage('watch')
  registerInterest(payload: { orderId: string }, socket: any) {
    this.clients.set(payload.orderId, socket);
  }

  @OnEvent('order.shipped')
  handleOrderShipped(event: OrderShippedEvent) {
    const socket = this.clients.get(event.orderId);
    if (socket) {
      socket.send(JSON.stringify({
        type: 'status_change',
        status: 'SHIPPED',
        timestamp: new Date()
      }));
    }
  }
}
```

이것이 asynchronous domain과 real-time surface 사이의 다리 역할을 합니다.

Gateway는 내부 이벤트를 수신하고 이를 외부 소켓 메시지로 번역합니다.

## 13.6 Cross-runtime websocket surfaces

fluo는 이식성을 위해 구축되었습니다.

기본 `WebSocketModule`은 Node.js를 대상으로 하지만, FluoShop을 Bun, Deno 또는 Cloudflare Workers에서 실행하고 싶을 수도 있습니다.

각 runtime은 engine 수준에서 WebSocket을 다르게 처리합니다.

`@fluojs/websockets` 패키지는 runtime-specific subpath를 통해 이를 해결합니다.

| Runtime | Subpath |
| --- | --- |
| Node.js | `@fluojs/websockets/node` |
| Bun | `@fluojs/websockets/bun` |
| Deno | `@fluojs/websockets/deno` |
| Workers | `@fluojs/websockets/cloudflare-workers` |

정확한 subpath에서 import 함으로써, backend adapter가 호스트 환경에 맞게 바뀌는 동안 여러분의 gateway 로직은 그대로 유지됩니다.

## 13.7 Heartbeats and connection health

WebSocket은 소리 없이 죽을 수 있습니다.

네트워크 중단이나 silent proxy timeout으로 인해 서버에는 더 이상 도달할 수 없는 "ghost" connection이 남을 수 있습니다.

Node 기반 adapter의 경우, fluo는 기본적으로 heartbeat timer를 활성화합니다.

서버는 주기적으로 client에게 ping을 보냅니다.

정해진 시간 내에 client가 응답하지 않으면, fluo는 소켓을 닫고 `@OnDisconnect` handler를 트리거합니다.

이를 통해 FluoShop backend가 수천 개의 죽은 연결로 인해 메모리 누수를 겪지 않도록 보장합니다.

## 13.8 Server-backed mode

가끔 메인 HTTP 서버와 독립적인 WebSocket 서버를 원할 때가 있습니다.

fluo에서는 이를 `serverBacked` 모드라고 부릅니다.

```typescript
@WebSocketGateway({ 
  path: '/updates', 
  serverBacked: { port: 3101 } 
})
export class DedicatedGateway {}
```

이 설정은 3101 포트에서 전용 listener를 시작합니다.

실시간 트래픽을 표준 API 트래픽과 격리하여 서로 다른 load-balancing 규칙이나 방화벽 정책을 적용하고 싶을 때 유용합니다.

## 13.9 Shared path gateways

fluo는 여러 gateway가 동일한 경로를 공유하는 것을 지원합니다.

```typescript
@WebSocketGateway({ path: '/realtime' })
export class ChatGateway {
  @OnMessage('chat')
  handleChat() {}
}

@WebSocketGateway({ path: '/realtime' })
export class MetricsGateway {
  @OnMessage('metrics')
  handleMetrics() {}
}
```

`/realtime` 경로로 메시지가 도착하면, fluo는 event name을 기반으로 올바른 handler로 라우팅합니다.

이를 통해 실시간 로직을 하나의 거대한 "God Gateway" 대신 작고 집중된 클래스들로 구성할 수 있습니다.

## 13.10 FluoShop v2.2.0 order flow

WebSocket이 구현되면서 주문 흐름은 이제 진정으로 현대화되었습니다.

1. 고객이 표준 HTTP POST를 통해 주문을 합니다.
2. Frontend는 즉시 `/orders/updates`로 WebSocket을 엽니다.
3. Backend는 주문을 처리하고 domain event를 발행합니다.
4. `OrderStatusGateway`는 이 이벤트들을 듣고 소켓으로 업데이트를 push합니다.
5. 고객은 단 한 번의 새로고침 없이도 "Processing", "Packed", "Shipped" 업데이트를 실시간으로 확인합니다.

이는 응답성이 뛰어나고 신뢰할 수 있는 고급 경험을 제공합니다.

## 13.11 Summary

- `@fluojs/websockets`는 실시간 통신을 위한 decorator-based API를 제공합니다.
- `WebSocketModule.forRoot()`는 production 안정성을 위해 bounded default와 함께 engine을 초기화합니다.
- `@WebSocketGateway` 클래스는 connection lifecycle과 message routing을 관리합니다.
- `upgrade.guard`를 사용하면 서버 리소스를 소모하기 전에 인증되지 않은 handshake를 거부할 수 있습니다.
- Runtime-specific subpath는 실시간 로직이 Node, Bun, Deno 간에 이식 가능하도록 보장합니다.
- Heartbeat와 bounded default는 리소스 누수와 ghost connection을 방지합니다.

실용적인 교훈은 WebSocket도 REST API만큼이나 구조화되어야 한다는 점입니다.

Gateway와 decorator를 사용함으로써 FluoShop은 실시간 로직을 깔끔하고 감사 가능하게 유지하며, 프레임워크의 나머지 event system과 긴밀하게 통합합니다.
