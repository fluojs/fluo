<!-- packages: @fluojs/socket.io, @fluojs/websockets -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 14. Advanced Socket.IO

이 장은 raw WebSocket 위에 Socket.IO 계층을 더하고, room, namespace, broadcasting 같은 고수준 실시간 기능을 FluoShop에 연결하는 방법을 설명합니다. Chapter 13에서 gateway 기반 real-time surface를 세웠다면, 이제는 다중 사용자 채팅과 세밀한 메시지 제어를 운영하기 쉬운 Socket.IO 패턴으로 확장합니다.

## Learning Objectives
- Socket.IO가 raw WebSocket보다 높은 수준의 협업 기능을 제공하는 이유를 이해합니다.
- `SocketIoModule.forRoot()`로 CORS와 engine 제한을 명시적으로 구성하는 방법을 익힙니다.
- `SocketIoRoomService`를 사용해 room 참여와 브로드캐스트를 분리하는 구조를 설명합니다.
- namespace와 message guard가 실시간 보안 경계를 어떻게 세분화하는지 분석합니다.
- raw `Server` 접근과 Bun engine 지원이 어떤 확장 지점을 제공하는지 정리합니다.
- support chat 같은 다중 room 흐름을 테스트 가능하게 유지하는 방법을 설명합니다.

## Prerequisites
- Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8, Chapter 9, Chapter 10, Chapter 11, Chapter 12, Chapter 13 완료.
- WebSocket gateway lifecycle과 실시간 메시지 라우팅에 대한 기초 이해.
- 인증, room 분리, 브로드캐스트 같은 다중 사용자 채팅 요구사항에 대한 기본 감각.

## 14.1 Why Socket.IO for FluoShop?

13장에서 다룬 `@fluojs/websockets`가 주문 업데이트 같은 단순한 스트림에 적합하다면, 일부 기능은 raw socket만으로 올바르게 구현하기 어렵습니다.

- **Rooms**: "Support Ticket #123"에 있는 모든 사용자에게 메시지를 브로드캐스트하기.
- **Automatic Reconnection**: 애플리케이션 상태를 잃지 않고 불안정한 모바일 네트워크 처리하기.
- **Namespaces**: 단일 연결 내에서 "Public Chat"과 "Internal Admin Alerts" 분리하기.
- **Broadcasting**: 발신자를 *제외한* 모든 사람에게 메시지 보내기.

Socket.IO는 이러한 기능을 first-class concept으로 제공합니다. FluoShop은 고객 지원 포털을 위해 Socket.IO를 사용하며, 각 지원 티켓은 room으로, 각 부서는 namespace로 관리됩니다. 덕분에 사용자 대화, 내부 상담원 흐름, 운영 알림을 같은 실시간 기반 위에서 분리해 다룰 수 있습니다.

## 14.2 Socket.IO module wiring

등록 방식은 기존 fluo 패턴을 따르지만, Socket.IO 전용 설정이 추가됩니다. 이 설정은 CORS, payload 제한, engine 동작처럼 일반 WebSocket보다 높은 수준의 실시간 정책을 모듈 경계에 모읍니다.

```typescript
import { Module } from '@fluojs/core';
import { SocketIoModule } from '@fluojs/socket.io';

@Module({
  imports: [
    SocketIoModule.forRoot({
      cors: {
        origin: ['https://fluoshop.com'],
      },
      engine: {
        maxHttpBufferSize: 1_048_576, // 1 MiB limit
      }
    }),
  ],
  providers: [SupportChatGateway],
})
export class ChatModule {}
```

기본적으로 fluo는 CORS를 deny-by-default, 즉 `origin: false` 상태로 유지합니다. Cross-origin 브라우저 클라이언트를 허용하려면 허용된 origin 목록을 명시적으로 작성해야 합니다. `engine` 설정은 Engine.IO에 직접 매핑되며, production 안정성을 위해 payload size를 제한할 수 있게 합니다. 이런 기본값은 실시간 연결이 브라우저에서 오래 유지되는 특성을 고려한 안전한 출발점입니다.

## 14.3 Room management with SocketIoRoomService

Socket.IO의 핵심 기능 중 하나는 room 관리입니다. FluoShop에서 고객이 지원 티켓을 열면, 해당 티켓 ID를 기준으로 한 room에 고객을 참여시켜야 합니다. 소켓 객체를 직접 조작하는 대신, fluo는 `SOCKETIO_ROOM_SERVICE`를 제공합니다. 이 서비스 경계는 room 참여와 브로드캐스트 규칙을 gateway 코드에서 과하게 흩어지지 않게 합니다.

```typescript
import { 
  WebSocketGateway, 
  OnConnect, 
  OnMessage 
} from '@fluojs/websockets';
import { 
  SOCKETIO_ROOM_SERVICE, 
  type SocketIoRoomService 
} from '@fluojs/socket.io';
import { Inject } from '@fluojs/core';

@Inject(SOCKETIO_ROOM_SERVICE)
@WebSocketGateway({ path: '/support' })
export class SupportChatGateway {
  constructor(private readonly rooms: SocketIoRoomService) {}

  @OnMessage('join_ticket')
  handleJoin(payload: { ticketId: string }, socket: any) {
    const roomName = `ticket:${payload.ticketId}`;
    this.rooms.joinRoom(socket.id, roomName);
  }

  @OnMessage('send_message')
  handleMessage(payload: { ticketId: string, text: string }) {
    const roomName = `ticket:${payload.ticketId}`;
    this.rooms.broadcastToRoom(roomName, 'new_message', {
      text: payload.text,
      sender: 'user',
    });
  }
}
```

`SocketIoRoomService`는 gateway에서 room 로직을 분리합니다. 이 구조 덕분에 원본 소켓 인스턴스에 접근할 수 없는 일반 서비스에서도 특정 room으로 브로드캐스트할 수 있습니다. 결과적으로 실시간 전달은 소켓 핸들러에 갇히지 않고 애플리케이션 서비스의 명시적인 협력 지점이 됩니다.

## 14.4 Guarding namespaces and messages

실시간 시스템의 보안은 단순한 handshake guard보다 세밀한 제어가 필요한 경우가 많습니다. `/support` namespace에 대한 연결은 허용하되, 사용자가 인증된 경우에만 "send_message"를 허용해야 할 수 있습니다. `SocketIoModule.forRoot`는 명시적인 auth guard를 지원하므로, 연결 권한과 메시지 권한을 다른 수준에서 판단할 수 있습니다.

```typescript
SocketIoModule.forRoot({
  auth: {
    connection({ socket }) {
      // Namespace 수준의 인증
      const token = socket.handshake.auth.token;
      return token === 'valid' ? true : { message: '인증 실패' };
    },
    message({ event, payload }) {
      // 메시지 수준의 인증
      if (event === 'admin_command' && !payload.isAdmin) {
        return { message: '권한이 없는 명령어입니다.' };
      }
      return true;
    }
  }
})
```

이 guard들이 `true` 이외의 값을 반환하면 연결이나 메시지는 표준화된 Socket.IO error 객체와 함께 거부됩니다. 클라이언트는 실패 원인을 일관된 방식으로 처리할 수 있고, 서버는 권한 없는 실시간 동작을 handler 실행 전에 차단할 수 있습니다.

## 14.5 Accessing the raw server

가끔 추상화를 넘어서 하부의 Socket.IO `Server` 인스턴스에 직접 접근해야 할 때가 있습니다. 다중 노드 확장을 위한 Redis adapter 같은 커스텀 adapter를 연결하거나, 저수준 서버 이벤트를 수신해야 하는 경우가 그렇습니다. `SOCKETIO_SERVER` 토큰을 사용하면 raw server를 주입받을 수 있습니다. 다만 이런 접근은 플랫폼 확장 지점에 필요한 곳으로 좁혀두는 편이 좋습니다.

```typescript
import { Inject } from '@fluojs/core';
import { SOCKETIO_SERVER } from '@fluojs/socket.io';
import type { Server } from 'socket.io';

@Inject(SOCKETIO_SERVER)
export class ScalingService {
  constructor(private readonly io: Server) {
    // 저수준 서버 설정 수행
    console.log('Socket.IO Server 인스턴스 사용 가능');
  }
}
```

이 경계는 fluo가 decorator-based surface를 제공하면서도, 하부 라이브러리의 확장 지점을 막지 않도록 합니다. 평소에는 fluo의 선언적 gateway를 쓰고, 운영상 필요한 예외만 raw server 경계로 모을 수 있습니다.

## 14.6 Bun engine details

fluo는 Bun의 고성능 WebSocket 구현을 우선 지원합니다. Socket.IO는 보통 Node.js에서 `ws` 패키지를 사용하지만, Bun에서는 `@socket.io/bun-engine`을 사용할 수 있습니다. FluoShop을 Bun에서 실행하면 `@fluojs/socket.io` adapter는 자동으로 환경을 감지하고, 사용 가능한 경우 Bun engine으로 전환합니다. 이 선택은 FluoShop이 표준 Node.js 프로세스보다 낮은 메모리 오버헤드로 많은 동시 지원 채팅을 처리할 수 있게 합니다.

## 14.7 여러 room으로 브로드캐스트하기

FluoShop 지원 포털에서 상담원은 활성화된 여러 티켓에 글로벌 공지사항을 보내야 할 수 있습니다. `SocketIoRoomService.broadcastToRoom(...)`는 공유 room-service 계약을 단순하게 유지하기 위해 한 번에 하나의 room만 받으므로, room 이름이 여러 개라면 호출부에서 명시적으로 순회해야 합니다.

```typescript
@OnMessage('global_announcement')
handleAnnouncement(payload: { message: string }) {
  const targetRooms = ['ticket:active', 'staff:updates'];

  for (const roomName of targetRooms) {
    this.rooms.broadcastToRoom(roomName, 'announcement', {
      text: payload.message,
    });
  }
}
```

이처럼 명시적으로 순회하면 주입 가능한 서비스가 공유 websocket room 계약과 정렬된 상태를 유지하면서도, 애플리케이션 코드에서는 여러 room으로 fan-out 하는 흐름을 충분히 표현할 수 있습니다.

정말로 Socket.IO의 native 다중 room emit 동작이 필요하다면, 해당 로직은 `SOCKETIO_SERVER`를 직접 주입하는 서비스로 좁혀 두는 편이 좋습니다.

```typescript
import { Inject } from '@fluojs/core';
import { SOCKETIO_SERVER } from '@fluojs/socket.io';
import type { Server } from 'socket.io';

@Inject(SOCKETIO_SERVER)
export class SupportAnnouncementService {
  constructor(private readonly io: Server) {}

  broadcastUrgent(message: string) {
    this.io.of('/support').to(['ticket:active', 'staff:updates']).emit('announcement', {
      text: message,
    });
  }
}
```

## 14.8 로우 서버로 volatile 메시지 다루기

가끔은 *지금 이 순간*에만 유용한 메시지를 보내야 할 때가 있습니다. 클라이언트 연결이 일시적으로 끊겼을 때, 재연결 시 해당 메시지를 받게 하고 싶지 않은 경우입니다. 이는 Socket.IO의 기본 buffering 동작과 반대입니다. FluoShop의 예로는 "사용자가 입력 중입니다" 표시나 대시보드의 실시간 커서 위치가 있습니다.

`SocketIoRoomService`는 전용 volatile-send helper를 노출하지 않습니다. `.volatile` 같은 Socket.IO 전용 전달 의미론이 필요하다면 `SOCKETIO_SERVER`를 주입하고, 그 로직을 raw server 경계에 두어야 합니다.

```typescript
import { Inject } from '@fluojs/core';
import { SOCKETIO_SERVER } from '@fluojs/socket.io';
import type { Server } from 'socket.io';

@Inject(SOCKETIO_SERVER)
export class PresenceHintsService {
  constructor(private readonly io: Server) {}

  sendTyping(ticketId: string, userId: string) {
    this.io.of('/support').volatile.to(`ticket:${ticketId}`).emit('typing', {
      userId,
    });
  }
}
```

이렇게 하면 portable room-service 계약은 room 참여와 일반적인 room broadcast에 집중하고, Socket.IO 전용 고급 의미론은 인프라 지향 서비스에 명시적으로 남겨둘 수 있습니다.

## 14.9 Testing Socket.IO gateways

fluo gateway는 단순한 클래스이므로 테스트하기 쉽습니다. `SocketIoRoomService`를 mock하면 실제 네트워크 소켓을 구동하지 않고도 gateway가 올바른 room에 참여하고 예상된 이벤트를 브로드캐스트하는지 검증할 수 있습니다. 테스트는 네트워크 transport보다 gateway가 선택한 room과 event 계약에 집중하게 됩니다.

```typescript
describe('SupportChatGateway', () => {
  it('올바른 티켓 room에 참여해야 합니다', () => {
    const mockRoomService = { joinRoom: vi.fn() };
    const gateway = new SupportChatGateway(mockRoomService as any);
    
    gateway.handleJoin({ ticketId: '123' }, { id: 'socket_abc' });
    
    expect(mockRoomService.joinRoom).toHaveBeenCalledWith('socket_abc', 'ticket:123');
  });
});
```

이 테스트 가능성은 fluo가 소켓 객체에 메서드를 붙이는 대신 room 관리를 서비스 기반으로 다루는 핵심 이유입니다. 서비스 경계가 있으면 실제 Socket.IO 서버 없이도 대부분의 비즈니스 흐름을 빠르게 검증할 수 있습니다.

## 14.10 FluoShop support chat flow

Socket.IO를 통해 FluoShop 지원 시스템은 대규모 실시간 흐름을 다룰 수 있습니다. Room, namespace, guard가 함께 동작하면서 지원 티켓별 대화와 내부 운영 채널을 분리합니다.

1. 고객이 지원 페이지에 접속하면 `/support` namespace로의 연결이 트리거됩니다.
2. `auth.connection` guard가 고객의 세션을 검증합니다.
3. 고객이 "티켓 열기"를 클릭하면 gateway가 고객의 소켓을 `ticket:{id}` room에 참여시킵니다.
4. 상담원(admin namespace)은 모든 활성 티켓을 볼 수 있습니다.
5. 메시지는 특정 room으로 브로드캐스트되어 개인 정보 보호와 성능을 모두 보장합니다.
6. Bun 환경에서는 시스템 전체가 고효율 native engine 위에서 작동합니다.

이 아키텍처는 FluoShop이 성장하는 고객 지원 트래픽을 명시적인 실시간 인프라로 수용할 수 있게 합니다. 지원 흐름이 커져도 메시지 라우팅, 권한, 테스트 경계가 같은 패턴 안에 남습니다.

## 14.11 Summary

- `@fluojs/socket.io`는 room, namespace, broadcasting 기능을 fluo gateway 시스템에 가져옵니다.
- `SocketIoRoomService`는 주입과 테스트가 가능한 room 관리를 위한 고수준 API를 제공합니다.
- 연결 및 메시지에 대한 명시적인 `auth` guard는 세밀한 보안을 제공합니다.
- `SOCKETIO_SERVER`를 통해 필요할 때 저수준 서버 접근이 가능합니다.
- Native Bun 지원은 현대적인 runtime에서 최대 성능을 보장합니다.
- CORS 기본값은 안정성을 위해 `false`이며, 명시적인 origin 설정이 필요합니다.

Socket.IO는 단순한 "ping-pong" 소켓과 실제 다중 사용자 애플리케이션 사이의 다리입니다. 이를 fluo decorator 시스템에 통합하면 FluoShop은 이전 장들에서 구축한 모듈형 아키텍처를 유지하면서 Socket.IO의 고수준 기능을 사용할 수 있습니다. 결과적으로 실시간 협업 기능도 모듈, provider, guard라는 익숙한 구성 요소 안에서 운영됩니다.
