<!-- packages: @fluojs/socket.io, @fluojs/websockets -->
<!-- project-state: FluoShop v2.2.0 -->

# 14. Advanced Socket.IO

Raw WebSocket은 강력하지만, 저수준의 primitive입니다.

Room, namespace, 신뢰할 수 있는 broadcasting과 같은 복잡한 실시간 기능이 필요할 때 업계에서는 종종 Socket.IO를 선택합니다.

`@fluojs/socket.io` 패키지는 Socket.IO v4를 fluo 생태계에 통합하여, 동일한 gateway decorator를 사용하면서도 Socket.IO engine의 고급 기능을 활용할 수 있게 해줍니다.

FluoShop v2.2.0이 진화함에 따라, 우리는 다채널 고객 지원 채팅을 지원할 방법이 필요합니다.

표준 WebSocket을 사용한다면 수많은 연결 그룹을 수동으로 관리해야 할 것입니다.

Socket.IO는 이 작업을 매우 단순하게 만들어 줍니다.

이 장에서는 room, namespace 및 runtime-specific 최적화를 사용하여 고객 지원 채팅 시스템을 구축하는 방법을 다룹니다.

## 14.1 Why Socket.IO for FluoShop?

13장에서 다룬 `@fluojs/websockets`가 주문 업데이트와 같은 단순한 스트림에 탁월하다면, 일부 기능은 raw socket만으로는 올바르게 구현하기 어렵습니다.

- **Rooms**: "Support Ticket #123"에 있는 모든 사용자에게 메시지를 브로드캐스트하기.
- **Automatic Reconnection**: 애플리케이션 상태를 잃지 않고 불안정한 모바일 네트워크 처리하기.
- **Namespaces**: 단일 연결 내에서 "Public Chat"과 "Internal Admin Alerts" 분리하기.
- **Broadcasting**: 발신자를 *제외한* 모든 사람에게 메시지 보내기.

Socket.IO는 이러한 기능을 first-class concept으로 제공합니다.

FluoShop에서는 모든 지원 티켓을 room으로, 각 부서를 namespace로 관리하는 고객 지원 포털을 구동하기 위해 Socket.IO를 사용합니다.

## 14.2 Socket.IO module wiring

등록 방식은 익숙한 fluo 패턴을 따르지만, Socket.IO 전용 설정이 추가됩니다.

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

기본적으로 fluo는 CORS를 deny-by-default(`origin: false`) 상태로 유지합니다.

Cross-origin 브라우저 클라이언트를 허용하려면 허용된 origin 목록을 명시적으로 작성해야 합니다.

`engine` 설정은 Engine.IO에 직접 매핑되어 production 안정성을 위해 payload size를 제한할 수 있게 해줍니다.

## 14.3 Room management with SocketIoRoomService

Socket.IO의 가장 강력한 기능은 room 관리입니다.

FluoShop에서 고객이 지원 티켓을 열면, 해당 티켓의 ID를 딴 room에 고객을 참여시키고 싶습니다.

소켓 객체를 직접 조작하는 대신, fluo는 `SOCKETIO_ROOM_SERVICE`를 제공합니다.

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

@WebSocketGateway({ path: '/support' })
export class SupportChatGateway {
  constructor(
    @Inject(SOCKETIO_ROOM_SERVICE)
    private readonly rooms: SocketIoRoomService
  ) {}

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

`SocketIoRoomService`는 gateway로부터 room 로직을 추상화합니다.

이를 통해 원본 소켓 인스턴스에 접근할 수 없는 일반 서비스에서도 특정 room으로 브로드캐스트할 수 있습니다.

## 14.4 Guarding namespaces and messages

실시간 시스템의 보안은 단순한 handshake guard보다 더 세밀한 제어가 필요한 경우가 많습니다.

`/support` namespace에 대한 연결은 허용하되, 사용자가 인증된 경우에만 "send_message"를 허용하고 싶을 수 있습니다.

`SocketIoModule.forRoot`는 명시적인 auth guard를 지원합니다.

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

이 guard들이 `true` 이외의 값을 반환하면, 연결이나 메시지는 표준화된 Socket.IO error 객체와 함께 거부됩니다.

## 14.5 Accessing the raw server

가끔 추상화를 깨고 하부의 Socket.IO `Server` 인스턴스에 직접 접근해야 할 때가 있습니다.

다중 노드 확장을 위한 Redis adapter와 같은 커스텀 adapter를 연결하거나, 저수준 서버 이벤트를 수신해야 할 경우가 그렇습니다.

`SOCKETIO_SERVER` 토큰을 사용하여 raw server를 주입받을 수 있습니다.

```typescript
import { SOCKETIO_SERVER } from '@fluojs/socket.io';
import type { Server } from 'socket.io';

export class ScalingService {
  constructor(
    @Inject(SOCKETIO_SERVER)
    private readonly io: Server
  ) {
    // 저수준 서버 설정 수행
    console.log('Socket.IO Server 인스턴스 사용 가능');
  }
}
```

이를 통해 fluo가 깔끔한 decorator-based surface를 제공하는 동시에, 하부 라이브러리의 모든 기능을 놓치지 않도록 보장합니다.

## 14.6 Bun engine details

fluo는 Bun의 고성능 WebSocket 구현을 최우선적으로 지원합니다.

Socket.IO는 보통 Node.js에서 `ws` 패키지를 사용합니다.

Bun에서는 `@socket.io/bun-engine`을 사용할 수 있습니다.

FluoShop을 Bun에서 실행하면, `@fluojs/socket.io` adapter는 자동으로 환경을 감지하고 사용 가능한 경우 Bun engine으로 전환합니다.

이를 통해 FluoShop은 표준 Node.js 프로세스보다 훨씬 낮은 메모리 오버헤드로 수천 개의 동시 지원 채팅을 처리할 수 있습니다.

## 14.7 Broadcasting to multiple rooms

FluoShop 지원 포털에서 상담원은 활성화된 모든 티켓에 글로벌 공지사항을 브로드캐스트해야 할 수도 있습니다.

```typescript
@OnMessage('global_announcement')
handleAnnouncement(payload: { message: string }) {
  // 여러 room에 동시에 브로드캐스트
  this.rooms.broadcastToRoom(['ticket:active', 'staff:updates'], 'announcement', {
    text: payload.message
  });
}
```

`broadcastToRoom` 메서드는 단일 문자열 또는 문자열 배열을 모두 수용합니다.

이는 기본 Socket.IO 동작과 일치하지만, 깔끔하게 주입 가능한 서비스 인터페이스를 통해 제공됩니다.

## 14.8 Handling volatile messages

가끔은 *지금 이 순간*에만 유용한 메시지를 보내고 싶을 때가 있습니다.

클라이언트가 일시적으로 연결이 끊겼을 때, 재연결 시 메시지를 받게 하고 싶지 않은 경우입니다(Socket.IO의 기본 buffering 동작과 반대).

FluoShop의 예로는 "사용자가 입력 중입니다" 표시나 대시보드의 실시간 커서 위치 등이 있습니다.

`SocketIoRoomService`를 사용하면 클라이언트에 도달할 수 없는 경우 폐기되는 volatile 메시지를 보낼 수 있습니다.

## 14.9 Testing Socket.IO gateways

fluo gateway는 단순한 클래스이므로 테스트하기 쉽습니다.

`SocketIoRoomService`를 mock하여, 실제 네트워크 소켓을 구동하지 않고도 gateway가 올바른 room에 참여하고 예상된 이벤트를 브로드캐스트하는지 검증할 수 있습니다.

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

이러한 테스트 가능성은 fluo가 소켓 객체에 메서드를 붙이는 대신 room 관리를 위한 서비스 기반 접근 방식을 사용하는 핵심적인 이유입니다.

## 14.10 FluoShop support chat flow

Socket.IO를 통해 FluoShop 지원 시스템은 대규모로 작동합니다.

1. 고객이 지원 페이지에 접속하면 `/support` namespace로의 연결이 트리거됩니다.
2. `auth.connection` guard가 고객의 세션을 검증합니다.
3. 고객이 "티켓 열기"를 클릭하면 gateway가 고객의 소켓을 `ticket:{id}` room에 참여시킵니다.
4. 상담원(admin namespace)은 모든 활성 티켓을 볼 수 있습니다.
5. 메시지는 특정 room으로 브로드캐스트되어 개인 정보 보호와 성능을 모두 보장합니다.
6. Bun 환경에서는 시스템 전체가 고효율 native engine 위에서 작동합니다.

이 아키텍처는 FluoShop이 성장하는 커뮤니티를 전문적인 수준의 실시간 인프라로 수용할 수 있게 해줍니다.

## 14.11 Summary

- `@fluojs/socket.io`는 room, namespace, broadcasting 기능을 fluo gateway 시스템에 가져옵니다.
- `SocketIoRoomService`는 주입과 테스트가 가능한 room 관리를 위한 고수준 API를 제공합니다.
- 연결 및 메시지에 대한 명시적인 `auth` guard는 세밀한 보안을 제공합니다.
- `SOCKETIO_SERVER`를 통해 필요할 때 저수준 서버 접근이 가능합니다.
- Native Bun 지원은 현대적인 runtime에서 최대 성능을 보장합니다.
- CORS 기본값은 안정성을 위해 `false`이며, 명시적인 origin 설정이 필요합니다.

Socket.IO는 단순한 "ping-pong" 소켓과 실제 다중 사용자 애플리케이션 사이의 다리입니다.

이를 fluo decorator 시스템에 통합함으로써, FluoShop은 이전 장들에서 구축한 깔끔하고 모듈화된 아키텍처를 유지하면서 v4의 강력한 기능을 얻게 됩니다.
