<!-- packages: @fluojs/websockets -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 13. WebSocket Gateways

이 장은 FluoShop에 실시간 연결 계층을 추가하고, polling 없이 상태 변화를 전달하는 gateway 모델을 설명합니다. Chapter 12에서 시간 기반 coordination을 다뤘다면, 이제는 domain event와 주문 흐름을 client connection에 연결해 real-time surface를 만듭니다.

## Learning Objectives
- WebSocket gateway가 request-response 흐름과 다른 실시간 계약을 가진다는 점을 이해합니다.
- `WebSocketModule.forRoot()`로 gateway 기반 실시간 계층을 등록하는 방법을 익힙니다.
- `@OnConnect`, `@OnMessage`, `@OnDisconnect` lifecycle이 어떤 책임을 갖는지 설명합니다.
- upgrade guard와 bounded default가 production 안정성에 왜 중요한지 분석합니다.
- domain event를 gateway 메시지로 변환해 client에게 push하는 흐름을 정리합니다.
- heartbeat, shared path, server-backed mode가 각각 어떤 운영 문제를 해결하는지 설명합니다.

## Prerequisites
- Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8, Chapter 9, Chapter 10, Chapter 11, Chapter 12 완료.
- event-driven flow와 persistent connection 개념에 대한 기초 이해.
- 인증된 client 연결과 실시간 리소스 관리에 대한 기본 감각.

## 13.1 The shift to real-time

이전 장들에서 FluoShop은 request-response cycle에 의존했습니다. 사용자가 command를 보내면 backend가 이를 처리하고, response가 결과를 확인하는 구조였습니다. 그러나 주문 배송 같은 업데이트를 확인하려면 보통 페이지를 새로고침하거나 background polling script가 GET endpoint를 호출할 때까지 기다려야 했고, 이는 비효율적이며 불필요한 부하를 만들었습니다. WebSocket은 이 계약을 바꿔 client가 persistent connection을 열고, 서버가 업데이트 발생 즉시 push할 수 있게 합니다. fluo에서 이 전환은 Gateway를 통해 관리되므로, 실시간 연결도 애플리케이션의 명시적인 경계 안에 머무릅니다.

## 13.2 WebSocket module wiring

실시간 기능을 활성화하려면 `WebSocketModule`을 등록합니다. 기본적으로 fluo는 Node.js 기반 runtime을 사용하지만, 이 패키지는 runtime-agnostic하게 설계되어 애플리케이션 코드가 특정 엔진에 과하게 묶이지 않도록 합니다.

```typescript
import { Module } from '@fluojs/core';
import { WebSocketModule } from '@fluojs/websockets';

@Module({
  imports: [WebSocketModule.forRoot()],
  providers: [OrderStatusGateway],
})
export class RealTimeModule {}
```

`forRoot()` 호출은 기본 engine을 초기화하고, framework가 `@WebSocketGateway`로 장식된 클래스를 discovery할 수 있게 준비합니다. 이 단계가 있어야 게이트웨이가 일반 provider처럼 모듈 그래프 안에서 관리되고, 연결 수명주기도 fluo의 애플리케이션 경계 안에서 다뤄집니다.

## 13.3 Creating a gateway

Gateway는 특정 실시간 영역을 관리하는 클래스입니다. FluoShop에서는 주문 업데이트를 위한 전용 gateway가 필요하며, 이렇게 분리하면 주문 상태 메시지와 다른 실시간 기능이 한 클래스에 뒤섞이지 않습니다.

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

`@OnConnect`, `@OnMessage`, `@OnDisconnect` decorator는 WebSocket lifecycle에 직접 매핑됩니다. 이 구조는 기존 fluo handler 모델과 같은 결을 가지며, HTTP `@Get`과 Event `@OnEvent` handler에서 사용했던 declarative pattern을 그대로 따릅니다. 덕분에 실시간 연결을 다루더라도 코드는 익숙한 fluo 방식으로 읽힙니다.

## 13.4 Bounded defaults and guards

Production 환경에서는 WebSocket을 제한 없이 열어둘 수 없습니다. WebSocket은 서버의 persistent resource, 즉 메모리와 file descriptor를 계속 소모하기 때문입니다. `@fluojs/websockets` 패키지는 concurrent connection과 payload size에 대한 bounded default를 자동으로 적용하며, 이 설정은 module 수준에서 조정할 수 있습니다. 기본값을 먼저 두고 필요한 만큼만 조정하면 실시간 기능의 확장성과 안정성을 함께 관리할 수 있습니다.

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

`upgrade.guard`는 특히 중요합니다. 이 guard는 WebSocket handshake가 완료되기 전에 실행되므로, 인증이나 origin 검증처럼 연결 성립 전에 판단해야 하는 조건을 가장 이른 경계에서 처리할 수 있습니다.

Guard가 실패하면 connection은 즉시 거부됩니다. 서버가 인증되지 않은 client를 위해 리소스를 할당하지 않도록 막는 경계입니다.

## 13.5 Integrating with FluoShop events

Gateway 자체는 파이프에 가깝습니다. 이를 유용한 실시간 기능으로 만들려면 FluoShop event bus에 연결해야 합니다. Backend에서 `OrderShippedEvent`가 발생하면 gateway는 그 내부 event를 읽고, 관련 client에게 상태 변경 메시지를 push해야 합니다.

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

이 연결이 asynchronous domain과 real-time surface 사이의 다리 역할을 합니다. Gateway는 내부 이벤트를 수신하고 이를 외부 소켓 메시지로 변환하므로, 도메인 로직은 소켓 세부 사항을 몰라도 되고 client는 필요한 상태 변화를 즉시 받을 수 있습니다.

## 13.6 Cross-runtime websocket surfaces

fluo는 이식성을 전제로 설계되었습니다. 기본 `WebSocketModule`은 Node.js를 대상으로 하지만, FluoShop을 Bun, Deno 또는 Cloudflare Workers에서 실행해야 할 수도 있습니다. 각 runtime은 engine 수준에서 WebSocket을 다르게 처리하므로, `@fluojs/websockets` 패키지는 runtime-specific subpath로 이 차이를 다룹니다. 이렇게 런타임별 차이를 import 경계에 모아두면 gateway의 업무 로직은 더 안정적으로 유지됩니다.

| Runtime | Subpath |
| --- | --- |
| Node.js | `@fluojs/websockets/node` |
| Bun | `@fluojs/websockets/bun` |
| Deno | `@fluojs/websockets/deno` |
| Workers | `@fluojs/websockets/cloudflare-workers` |

정확한 subpath에서 import하면 backend adapter가 호스트 환경에 맞게 바뀌어도 gateway 로직은 그대로 유지됩니다. 즉, 이식성은 추상적인 약속이 아니라 패키지 경계와 import 선택으로 드러나는 설계 원칙입니다.

## 13.7 Heartbeats and connection health

WebSocket은 조용히 끊길 수 있습니다. 네트워크 중단이나 silent proxy timeout으로 인해 서버에는 더 이상 도달할 수 없는 "ghost" connection이 남을 수 있습니다. Node 기반 adapter에서는 fluo가 기본적으로 heartbeat timer를 활성화하고, 서버는 주기적으로 client에게 ping을 보냅니다. 정해진 시간 내에 client가 응답하지 않으면 fluo는 소켓을 닫고 `@OnDisconnect` handler를 트리거합니다. 이 경계는 FluoShop backend가 수천 개의 죽은 연결 때문에 메모리 누수를 겪지 않도록 보호합니다.

## 13.8 Server-backed mode

가끔 메인 HTTP 서버와 독립적인 WebSocket 서버가 필요할 때가 있습니다. fluo에서는 이를 `serverBacked` 모드라고 부르며, 실시간 트래픽의 운영 조건이 일반 API와 다를 때 유용합니다.

```typescript
@WebSocketGateway({ 
  path: '/updates', 
  serverBacked: { port: 3101 } 
})
export class DedicatedGateway {}
```

이 설정은 3101 포트에서 전용 listener를 시작합니다. 실시간 트래픽을 표준 API 트래픽과 격리하고, 서로 다른 load-balancing 규칙이나 방화벽 정책을 적용해야 할 때 유용합니다. 운영자는 이 분리를 통해 연결 유지 비용과 일반 요청 처리 비용을 따로 관찰할 수 있습니다.

## 13.9 Shared path gateways

fluo는 여러 gateway가 동일한 경로를 공유하는 것을 지원합니다. 같은 연결 표면을 쓰더라도 event name을 기준으로 책임을 나누면, 기능별 gateway를 작게 유지할 수 있습니다.

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

`/realtime` 경로로 메시지가 도착하면 fluo는 event name을 기준으로 올바른 handler에 라우팅합니다. 이를 통해 실시간 로직을 하나의 거대한 "God Gateway"가 아니라 작고 집중된 클래스들로 구성할 수 있습니다. 클래스가 작게 유지되면 테스트와 권한 검증도 기능 단위로 분리하기 쉬워집니다.

## 13.10 FluoShop v2.2.0 order flow

WebSocket이 도입되면서 주문 흐름은 더 직접적인 실시간 계약을 갖습니다. 사용자는 같은 주문 과정을 보지만, 상태 확인 방식은 반복 조회에서 서버 push 중심으로 바뀝니다.

1. 고객이 표준 HTTP POST를 통해 주문을 합니다.
2. Frontend는 즉시 `/orders/updates`로 WebSocket을 엽니다.
3. Backend는 주문을 처리하고 domain event를 발행합니다.
4. `OrderStatusGateway`는 이 이벤트들을 듣고 소켓으로 업데이트를 push합니다.
5. 고객은 단 한 번의 새로고침 없이도 "Processing", "Packed", "Shipped" 업데이트를 실시간으로 확인합니다.

이 흐름은 사용자의 반복 조회를 줄이고, backend가 상태 변경을 책임 있게 push하는 경험을 제공합니다. 또한 주문 처리와 실시간 전달이 이벤트 경계로 연결되기 때문에, 두 흐름을 독립적으로 테스트하고 운영할 수 있습니다.

## 13.11 Summary

- `@fluojs/websockets`는 실시간 통신을 위한 decorator-based API를 제공합니다.
- `WebSocketModule.forRoot()`는 production 안정성을 위해 bounded default와 함께 engine을 초기화합니다.
- `@WebSocketGateway` 클래스는 connection lifecycle과 message routing을 관리합니다.
- `upgrade.guard`를 사용하면 서버 리소스를 소모하기 전에 인증되지 않은 handshake를 거부할 수 있습니다.
- Runtime-specific subpath는 실시간 로직이 Node, Bun, Deno 간에 이식 가능하도록 보장합니다.
- Heartbeat와 bounded default는 리소스 누수와 ghost connection을 방지합니다.

실무적 교훈은 WebSocket도 REST API만큼 구조화되어야 한다는 점입니다.

Gateway와 decorator를 사용하면 FluoShop은 실시간 로직을 명확하고 감사 가능한 형태로 유지하면서, framework의 나머지 event system과 긴밀하게 통합할 수 있습니다.
