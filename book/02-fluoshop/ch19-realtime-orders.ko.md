# 주문 상태를 실시간으로 보여주기

<!-- book:volume=02-fluoshop;chapter=19 -->

[이전: 이메일·Slack·Discord로 같은 사건 전달하기](./ch18-notification-channels.ko.md) · [목차](./toc.ko.md) · [다음: 운영 대시보드에 맞는 조회 API 만들기](./ch20-graphql-dashboard.ko.md)

## 새로고침하지 않았다는 이유로 결제가 실패해 보인다

고객은 FluoBlog의 상점에서 티셔츠를 결제하고 주문 화면으로 돌아왔다. 서버에는 이미 `paid`가 저장되었고 확인 메일도 전송되었다. 하지만 결제 전에 받아 둔 화면에는 여전히 `pending_payment`가 보인다. 고객은 구매 버튼을 다시 누르고, 운영자는 중복 결제 문의를 받는다. 앞서 멱등성 경계를 마련했기 때문에 주문이 중복 생성되지는 않지만, 잘못된 화면은 불필요한 요청과 불신을 만든다.

가장 먼저 할 수 있는 해결은 [16장의 인증된 `GET /orders/:id`](./ch16-cqrs-projections.ko.md)를 다시 조회하는 것이다. 이 API는 원본 주문 DTO가 아니라 조회 모델의 `ready`, `pending`, `not_found` 결과를 반환한다. 결제 후 복귀 시 재조회는 실시간 연결이 있어도 필요하지만, projection이 아직 반영되지 않은 202를 결제 실패로 표시해서는 안 된다. 주문량이 작고 조회 모델의 지연을 허용할 수 있다면 제한된 재조회만으로도 충분하다. WebSocket을 쓰기 전에 갱신 간격, 고객 체류 시간, 동시 접속 수를 측정해야 연결 유지 비용과 조회 비용을 비교할 수 있다.

이 장에서 실시간 연결을 선택하는 이유는 같은 주문 화면에 머무는 고객과 포장 담당자에게 상태 변화를 곧바로 알리기 위해서다. 모든 데이터를 스트림으로 바꾸려는 것이 아니다. 주문 저장과 조회 API는 그대로 두고, Socket.IO를 변화 전달 경로로 더한다. 재고 판단이나 결제 승인은 소켓이 보내는 값으로 결정하지 않는다. 고객이 보내는 것은 관찰하려는 주문 ID이며, 그 주문의 소유자는 서버가 기존 인증 주체와 비교한다.

## 게이트웨이 문법과 전송 프로토콜을 구분한다

`@fluojs/websockets`는 `@WebSocketGateway`, `@OnMessage`, 연결 수명주기 데코레이터와 공통 방 계약을 제공한다. `@fluojs/socket.io`는 그 작성 모델을 Socket.IO v4 서버에 연결한다. 같은 데코레이터를 쓴다고 두 전송이 호환되는 것은 아니다. 브라우저의 `new WebSocket(...)`은 Socket.IO 클라이언트가 아니며, Socket.IO의 namespace와 ACK를 그대로 말하지 못한다.

이 장의 런타임은 기존 앱과 같은 Node24·Fastify다. 패키지의 Node 지원 범위는 `>=24.0.0 <27`이며 Socket.IO peer는 `^4.8.3`을 요구한다. 클라이언트도 호환되는 Socket.IO v4를 사용한다. `SocketIoModule.forRoot()`를 기존 애플리케이션 listener에 연결하고 별도 실시간 서버나 별도 포트를 만들지 않는다. `@WebSocketGateway({ path: '/orders' })`에서 `/orders`는 **namespace**다. Engine.IO의 HTTP 연결 경로는 `/socket.io/`로 유지되며 HTTP의 `GET /orders/:id`와 충돌하지 않는다.

```sh
pnpm add @fluojs/socket.io @fluojs/websockets socket.io@^4.8.3
pnpm add socket.io-client@^4.8.3
```

위 명령은 독자가 만든 `fluo-blog`에서 필요한 패키지를 추가하는 명령이다. 이번 집필에서는 설치나 기존 루트 빌드를 다시 실행하지 않았다. 기존 프로젝트에서 이미 설치했다면 lockfile의 실제 해석 버전을 확인하면 된다. raw WebSocket 모듈과 Socket.IO 모듈을 같은 게이트웨이에 동시에 등록하지 않는다.

## 관찰 권한을 연결 수명과 함께 관리한다

HTTP에서 로그인했다고 이후 모든 소켓 메시지가 자동으로 인증되는 것은 아니다. Socket.IO handshake의 `auth.token`은 클라이언트 입력이다. 이 장은 [1권 14장](../01-fluoblog/ch14-authentication.ko.md)의 `AuthService.login`이 반환한 `accessToken`을 그대로 받아 `BlogTokenAuthenticator.authenticateToken`에 전달한다. 같은 서명·issuer·audience·만료 검증과 현재 활성 계정·`authVersion` 확인을 재사용한다. 새 JWT 설정이나 사용자 테이블을 만들지 않는다.

그 인증기는 만료·로그아웃·관리자 폐기를 구독하는 API를 제공하지 않는다. 현재 로그아웃은 클라이언트 토큰 삭제이며, 서버는 다음 인증 때 계정 상태와 `authVersion`을 읽는다. 따라서 여기서는 원자적인 폐기 이벤트를 약속하는 `RealtimeSessionPort`를 두지 않는다. 아래에 실제 인증 어댑터를 구현하고, **연결 준비, 구독 요청, 초기 스냅샷 ACK 직전, 각 수신자에게 변경 정보를 보내기 직전**에 재검증한다. 방에 가입했다는 사실은 이후 송신의 허가증이 아니다.

주문 조회는 인증된 subject와 주문 ID를 함께 조건에 넣는다. 없거나 다른 고객의 주문이면 `null`이며 이메일·주소·결제 토큰은 선택하지 않는다. 지연된 projection이 아니라 커밋된 현재 주문을 읽어 구독 직전의 변화를 따라잡는다. 다음 `src/orders/realtime/contracts.ts`는 **완전한 계약 파일**이다. 주문 버전은 0에서 시작하고 금액은 십진 문자열로 전송한다.

```ts
export type OrderStatus =
  | 'pending_payment' | 'paid' | 'fulfilling' | 'shipped'
  | 'cancelled' | 'refund_pending' | 'refunded';

export type OrderView = Readonly<{
  id: string;
  status: OrderStatus;
  currency: 'KRW';
  totalMinor: string;
  version: number;
}>;

export interface OrderRealtimeRead {
  findForCustomer(customerId: string, orderId: string): Promise<OrderView | null>;
}

export const ORDER_REALTIME_READ = Symbol('orders.realtime.read');
```

다음 `src/orders/realtime/read.ts`는 **완전한 조회 어댑터**다. 6장의 `Order` 모델로 생성한 Prisma client와 기존 전역 `BlogDatabaseModule`의 `PrismaService`를 사용한다. 저장된 금액이나 통화가 계약을 위반하면 인증 실패가 아니라 데이터 오류다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import type { OrderRealtimeRead, OrderView } from './contracts.js';

@Inject(PrismaService)
export class PrismaOrderRealtimeRead implements OrderRealtimeRead {
  constructor(private readonly prisma: PrismaServiceFacade<PrismaClient>) {}

  async findForCustomer(customerId: string, orderId: string): Promise<OrderView | null> {
    const row = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: { id: true, status: true, currency: true, totalMinor: true, version: true },
    });
    if (!row) return null;
    if (row.currency !== 'KRW' || row.totalMinor < 0n
      || !Number.isSafeInteger(row.version) || row.version < 0) {
      throw new Error('Invalid stored order snapshot.');
    }
    return { ...row, currency: row.currency, totalMinor: row.totalMinor.toString() };
  }
}
```

`src/orders/realtime/sessions.ts` 역시 **완전한 파일**이다. lease는 검증된 토큰의 로컬 사용 수명이지 영속 세션 레코드가 아니다. `close`는 보관한 토큰 참조를 비우고 이후 사용을 거부한다. 계정 listener나 폐기 구독을 만들지 않으며 만료 timer도 없다. 유휴 연결은 만료 후 다음 구독·송신 시도까지 남을 수 있지만, 만료된 자격으로 새 스냅샷을 보내지는 않는다. 1권의 `requireExp: true`, `clockSkewSeconds: 0`, 900초 수명을 유지한다.

```ts
import { Inject } from '@fluojs/core';
import {
  AuthenticationExpiredError, AuthenticationFailedError, AuthenticationRequiredError,
} from '@fluojs/passport';
import { BlogTokenAuthenticator } from '../../auth/blog-token-authenticator.js';

export function isAuthenticationFailure(error: unknown): boolean {
  return error instanceof AuthenticationRequiredError
    || error instanceof AuthenticationFailedError
    || error instanceof AuthenticationExpiredError;
}

export class RealtimeSessionLease {
  private closed = false;

  constructor(
    private readonly tokens: BlogTokenAuthenticator,
    private token: string,
    readonly subject: string,
    private readonly expiresAt: number,
  ) {}

  assertActive(): void {
    if (this.closed) throw new AuthenticationRequiredError();
    if (Date.now() >= this.expiresAt) throw new AuthenticationExpiredError();
  }

  async revalidate(): Promise<void> {
    this.assertActive();
    const principal = await this.tokens.authenticateToken(this.token);
    this.assertActive();
    if (principal.subject !== this.subject) throw new AuthenticationFailedError();
  }

  close(): void {
    this.closed = true;
    this.token = '';
  }
}

@Inject(BlogTokenAuthenticator)
export class BlogRealtimeSessions {
  constructor(private readonly tokens: BlogTokenAuthenticator) {}

  async open(token: unknown): Promise<RealtimeSessionLease> {
    if (typeof token !== 'string' || token.length === 0) {
      throw new AuthenticationRequiredError();
    }
    const principal = await this.tokens.authenticateToken(token);
    const exp = principal.claims.exp;
    if (typeof exp !== 'number' || !Number.isFinite(exp)) {
      throw new AuthenticationFailedError('Token expiration is required.');
    }
    const lease = new RealtimeSessionLease(this.tokens, token, principal.subject, exp * 1000);
    try {
      lease.assertActive();
      return lease;
    } catch (error: unknown) {
      lease.close();
      throw error;
    }
  }
}
```

서명 검증 중에는 유효했어도 계정 DB 조회가 끝날 때 이미 만료될 수 있다. 그래서 `open`과 `revalidate`의 마지막, 그리고 실제 송신 바로 앞에서 `assertActive`로 실제 시각을 다시 확인한다. 인증 예외만 `UNAUTHENTICATED`로 분류하고 DB·설정 오류는 그대로 전파한다. 토큰을 디코딩만 하거나 모든 예외를 `null`로 바꾸는 어댑터로 대체하지 않는다.

## 방에 먼저 들어간 뒤 현재 상태를 다시 읽는다

다음 `src/orders/realtime/module.ts`는 **완전한 통합 파일**이다. `AuthModule`의 export를 통해 실제 `BlogTokenAuthenticator`가 주입된다. Socket.IO에는 비동기 DI 등록 옵션을 만들어 넣지 않고, DI가 가능한 게이트웨이의 `@OnConnect`에서 연결 인증을 수행한다. 이 시점은 namespace 연결 이후이므로 인증 오류는 HTTP 401 handshake 응답이 아니다. `session.error`와 연결 종료로 알리며, `connect` 이벤트 자체를 로그인 성공으로 보지 않는다. 연결 handler가 준비되는 동안의 인바운드 메시지는 패키지의 제한된 버퍼를 거치고, `orders.watch`도 독립적으로 재검증한다.

```ts
import { Inject, Module } from '@fluojs/core';
import { AuthenticationRequiredError } from '@fluojs/passport';
import { SocketIoModule, type SocketIoHandshakeRequest } from '@fluojs/socket.io';
import { OnConnect, OnMessage, WebSocketGateway } from '@fluojs/websockets';
import type { Socket } from 'socket.io';
import { AuthModule } from '../../auth/auth.module.js';
import { ORDER_REALTIME_READ, type OrderRealtimeRead, type OrderView } from './contracts.js';
import { PrismaOrderRealtimeRead } from './read.js';
import { BlogRealtimeSessions, isAuthenticationFailure, type RealtimeSessionLease } from './sessions.js';

type Binding = {
  lease: RealtimeSessionLease | undefined;
  onDisconnect: () => void;
};

@Inject(BlogRealtimeSessions)
export class SessionBindings {
  private readonly bindings = new Map<Socket, Binding>();
  private stopping = false;

  constructor(private readonly sessions: BlogRealtimeSessions) {}

  async accept(socket: Socket): Promise<boolean> {
    if (this.stopping || !socket.connected) return false;
    const binding: Binding = {
      lease: undefined,
      onDisconnect: () => this.remove(socket),
    };
    this.bindings.set(socket, binding);
    socket.once('disconnect', binding.onDisconnect);
    try {
      const lease = await this.sessions.open(socket.handshake.auth.token);
      if (this.stopping || !socket.connected || this.bindings.get(socket) !== binding) {
        lease.close();
        this.remove(socket);
        return false;
      }
      binding.lease = lease;
      return true;
    } catch (error: unknown) {
      this.remove(socket);
      throw error;
    }
  }

  async require(socket: Socket): Promise<RealtimeSessionLease> {
    const lease = this.bindings.get(socket)?.lease;
    if (!lease) throw new AuthenticationRequiredError();
    await lease.revalidate();
    this.assertCurrent(socket, lease);
    return lease;
  }

  assertCurrent(socket: Socket, lease: RealtimeSessionLease): void {
    if (this.stopping || !socket.connected || this.bindings.get(socket)?.lease !== lease) {
      throw new AuthenticationRequiredError();
    }
    lease.assertActive();
  }

  socketsIn(room: string): Socket[] {
    return [...this.bindings.keys()].filter(socket => socket.rooms.has(room));
  }

  private remove(socket: Socket): void {
    const binding = this.bindings.get(socket);
    this.bindings.delete(socket);
    if (binding) {
      socket.off('disconnect', binding.onDisconnect);
      binding.lease?.close();
    }
  }

  close(socket: Socket): void {
    this.remove(socket);
    socket.disconnect(true);
  }

  onApplicationShutdown(): void {
    this.stopping = true;
    for (const socket of [...this.bindings.keys()]) this.close(socket);
  }
}

type WatchAck = (reply:
  | { ok: true; order: OrderView }
  | { ok: false; error: string }
) => void;

@Inject(ORDER_REALTIME_READ, SessionBindings)
@WebSocketGateway({ path: '/orders' })
export class OrdersGateway {
  private readonly watching = new WeakSet<Socket>();

  constructor(
    private readonly orders: OrderRealtimeRead,
    private readonly sessions: SessionBindings,
  ) {}

  @OnConnect()
  async connected(socket: Socket): Promise<void> {
    try {
      if (!await this.sessions.accept(socket)) this.sessions.close(socket);
    } catch (error: unknown) {
      socket.emit('session.error', {
        code: isAuthenticationFailure(error) ? 'UNAUTHENTICATED' : 'UNAVAILABLE',
      });
      this.sessions.close(socket);
      if (!isAuthenticationFailure(error)) throw error;
    }
  }

  @OnMessage('orders.watch')
  async watch(
    payload: unknown,
    socket: Socket,
    _request: SocketIoHandshakeRequest,
    ack?: WatchAck,
  ): Promise<void> {
    if (typeof ack !== 'function') return;
    if (!payload || typeof payload !== 'object'
      || !('orderId' in payload) || typeof payload.orderId !== 'string'
      || !/^[A-Za-z0-9_-]{1,80}$/.test(payload.orderId)) {
      ack({ ok: false, error: 'INVALID_ORDER_ID' });
      return;
    }
    if (this.watching.has(socket)) {
      ack({ ok: false, error: 'WATCH_IN_PROGRESS' });
      return;
    }
    this.watching.add(socket);
    const orderId = payload.orderId;
    const room = 'order:' + orderId;
    try {
      const lease = await this.sessions.require(socket);
      const allowed = await this.orders.findForCustomer(lease.subject, orderId);
      if (!allowed) {
        await socket.leave(room);
        ack({ ok: false, error: 'NOT_FOUND_OR_FORBIDDEN' });
        return;
      }
      this.sessions.assertCurrent(socket, lease);
      for (const joined of socket.rooms) {
        if (joined.startsWith('order:') && joined !== room) await socket.leave(joined);
      }
      await socket.join(room);
      const current = await this.orders.findForCustomer(lease.subject, orderId);
      if (!current) {
        await socket.leave(room);
        ack({ ok: false, error: 'NOT_FOUND_OR_FORBIDDEN' });
        return;
      }
      await this.sessions.require(socket);
      this.sessions.assertCurrent(socket, lease);
      ack({ ok: true, order: current });
    } catch (error: unknown) {
      ack({ ok: false, error: isAuthenticationFailure(error) ? 'UNAUTHENTICATED' : 'UNAVAILABLE' });
      this.sessions.close(socket);
      if (!isAuthenticationFailure(error)) throw error;
    } finally {
      this.watching.delete(socket);
    }
  }
}

@Inject(ORDER_REALTIME_READ, SessionBindings)
export class OrderRealtimePublisher {
  constructor(
    private readonly orders: OrderRealtimeRead,
    private readonly sessions: SessionBindings,
  ) {}

  async publish(order: OrderView): Promise<void> {
    const room = 'order:' + order.id;
    const results = await Promise.allSettled(this.sessions.socketsIn(room).map(async socket => {
      try {
        const lease = await this.sessions.require(socket);
        const current = await this.orders.findForCustomer(lease.subject, order.id);
        if (!current) {
          await socket.leave(room);
          return;
        }
        await this.sessions.require(socket);
        this.sessions.assertCurrent(socket, lease);
        if (socket.rooms.has(room)) socket.emit('orders.changed', current);
      } catch (error: unknown) {
        socket.emit('session.error', {
          code: isAuthenticationFailure(error) ? 'UNAUTHENTICATED' : 'UNAVAILABLE',
        });
        this.sessions.close(socket);
        if (!isAuthenticationFailure(error)) throw error;
      }
    }));
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length > 0) throw new AggregateError(failures, 'Realtime delivery unavailable.');
  }
}

@Module({
  imports: [
    AuthModule,
    SocketIoModule.forRoot({
      auth: {
        connection({ socket, activeConnectionCount }) {
          const origin = socket.handshake.headers.origin;
          return (!origin || origin === 'https://shop.example.com') && activeConnectionCount < 500;
        },
        message({ event }) {
          return event === 'orders.watch'
            ? true : { message: 'Forbidden event', disconnect: true };
        },
      },
      cors: { origin: ['https://shop.example.com'], credentials: false },
      engine: { maxHttpBufferSize: 65_536 },
      buffer: { maxPendingMessagesPerSocket: 16, overflowPolicy: 'close' },
      shutdown: { timeoutMs: 5000 },
    }),
  ],
  providers: [
    { provide: ORDER_REALTIME_READ, useClass: PrismaOrderRealtimeRead },
    BlogRealtimeSessions, SessionBindings, OrdersGateway, OrderRealtimePublisher,
  ],
  exports: [OrderRealtimePublisher],
})
export class RealtimeOrdersModule {}
```

기존 `src/app.ts`에는 `import { RealtimeOrdersModule } from './orders/realtime/module.js';`를 추가하고 `AppModule`의 기존 `imports` 배열에 `RealtimeOrdersModule`을 한 번 넣는다. 기존 `BlogDatabaseModule`의 단일 전역 등록, `AuthModule`, HTTP listener와 Fastify 종료 경로를 유지한다. 발행하는 Outbox 처리기의 모듈은 `RealtimeOrdersModule`을 import하고, 처리기에는 class-level `@Inject(OrderRealtimePublisher)`와 생성자 의존성을 추가해 `await publisher.publish(committedOrder)`를 호출한다. Socket.IO 모듈을 다른 곳에서 중복 등록하지 않는다. 개발 브라우저의 Origin이 다르면 서버가 신뢰하는 개발 Origin으로 두 설정을 함께 바꾼다. Origin 검사는 토큰 검증을 대신하지 않는다.

첫 조회는 소유권 확인이고, 방 가입 뒤 두 번째 조회는 따라잡기다. 조회하고 가입만 하면 그 사이 변화를 놓친다. 가입 뒤 사건은 수신자별 publisher가 전달하고 가입 이전까지의 변화는 두 번째 조회로 받는다. 조회 ACK보다 새 이벤트가 먼저 도착할 수 있으므로 다음 절의 버전 비교가 필요하다. `socket.join`은 native Socket.IO의 await 가능한 가입 경계다. 공통 `SocketIoRoomService.joinRoom`은 `void`이고 가입 완료를 기다리는 계약이 아니다.

방은 이 프로세스에서 관찰자를 찾는 인덱스로만 사용한다. `broadcastToRoom`은 송신 직전 인증·주문 소유권 검사를 우회하므로 이 publisher에서 사용하지 않는다. 현재 snapshot을 수신자마다 다시 읽고 송신 전에 계정 상태를 한 번 더 확인한다. 이는 구독자 수만큼 DB 비용을 내는 작은 상점의 정책이다. 서버 폐기 알림 기능이 없는 상태에서 성능을 이유로 토큰을 연결 시 한 번만 검사하는 방송으로 바꾸면 보안 계약도 달라진다. 운영자가 여러 고객의 주문을 보는 구독은 아직 제공하지 않으며 다음 장의 GraphQL 운영자 권한이 이 고객 소켓에 자동 적용되지 않는다.

소켓 하나의 동시 구독은 `WATCH_IN_PROGRESS`로 거절하고, 성공한 구독은 이전 주문 방을 떠난다. 소유권이 없는 ID는 가입하지 않으며, 기존 구독의 주문이 더 이상 허용되지 않으면 publisher가 그 방을 떠나게 한다. `customerId`나 방 이름을 payload에 넣어도 서버는 사용하지 않는다. `activeConnectionCount`는 간단한 입장 제한이며 동시에 진행 중인 인증을 원자적으로 예약하는 전역 카운터는 아니다.

연결이 끊기거나 앱이 종료되면 자신이 등록한 disconnect listener를 해제하고 lease를 닫는다. 인증 완료가 늦게 돌아와도 연결·종료 상태와 binding의 동일성을 확인하여 버린다. 이미 진행 중인 DB 호출을 취소하는 것은 아니지만 그 결과로 연결을 되살리거나 송신하지 않는다. `close`로 모든 방을 떠나는 동작은 이 장의 기본 메모리 Socket.IO adapter를 전제로 한다.

재검증이 폐기와 송신을 DB 트랜잭션 하나로 묶지는 않는다. 마지막 계정 조회 직후 `authVersion`이 증가하면 이미 승인 중인 한 작업의 ACK·frame은 전송될 수 있고, 버퍼에 들어간 frame도 회수할 수 없다. 다음 검증은 변경을 읽어 차단한다. 그러므로 관리자 폐기는 **다음 인증 경계에서 관찰되는 폐기**이며 즉시 push 폐기가 아니다. 유휴 연결 종료 지연에는 시간 상한을 약속하지 않는다. 반면 `exp`는 동기적인 마지막 검사에서 차단하되 검사 후 네트워크 도착까지의 시간은 통제하지 못한다. 이 범위가 부족한 제품은 별도 서버 세션·폐기 전달 설계를 해야 하며, 기존 계정 서비스가 이미 제공한다고 가정해서는 안 된다.

handler 반환값은 ACK로 자동 변환되지 않는다. 인자는 `(payload, socket, request, acknowledgement)`이고 코드가 직접 호출한다. 인증 오류는 주문 데이터 없이 `UNAUTHENTICATED`, 인프라 오류는 `UNAVAILABLE`로 응답하고 연결을 정리한다. 후자는 원래 오류를 다시 던져 게이트웨이의 오류 로그나 publisher 호출자의 오류 처리로 보낸다. 종료 직전 오류 frame 자체의 수신은 보장하지 않으므로 클라이언트는 disconnect도 처리해야 한다.

## 상태 이름의 순서가 아니라 버전을 비교한다

고객이 버전 3의 `shipped`를 본 뒤 지연된 버전 2의 `fulfilling` 메시지를 받았다고 하자. 이 예제의 정상 경로는 `pending_payment` 버전 0, `paid` 버전 1, `fulfilling` 버전 2, `shipped` 버전 3이다. 메시지 수신 시각으로 덮어쓰면 화면이 뒤로 돌아간다. 상태에 숫자 순서를 매기는 것도 올바르지 않다. `paid` 뒤에는 배송과 환불이라는 분기가 있고, 시간상 나중 상태가 언제나 더 큰 enum 값인 것은 아니다. 순서는 주문의 단조 증가 `version`으로 판단한다.

다음 `src/orders/realtime/order-feed.ts`는 **완전한 브라우저 파일**이다. 같은 프로젝트의 계약 타입을 가져오며, 이벤트에는 전체 고객용 스냅샷이 담긴다는 전제를 사용한다. 그러므로 버전 0에서 3으로 건너뛰어도 3의 전체 상태를 채택할 수 있다. 이것은 서버에서 중간 전이를 생략한다는 뜻이 아니다. `OrderTransitionsService.apply`가 각 전이의 버전과 `OrderTransition` 감사를 남기고, 화면만 최신 스냅샷으로 따라잡는 것이다. 항목별 증분만 보냈다면 중간 버전 누락 시 재조회해야 하므로 같은 함수를 사용할 수 없다.

```ts
import { io } from 'socket.io-client';
import type { OrderStatus, OrderView } from './contracts.js';

const statuses = new Set<string>([
  'pending_payment', 'paid', 'fulfilling', 'shipped',
  'cancelled', 'refund_pending', 'refunded',
]);

export function parseOrderView(value: unknown): OrderView | null {
  if (!value || typeof value !== 'object') return null;
  if (!('id' in value) || typeof value.id !== 'string') return null;
  if (!('status' in value) || typeof value.status !== 'string'
    || !statuses.has(value.status)) return null;
  if (!('currency' in value) || value.currency !== 'KRW') return null;
  if (!('totalMinor' in value) || typeof value.totalMinor !== 'string'
    || !/^(0|[1-9][0-9]*)$/.test(value.totalMinor)) return null;
  if (!('version' in value) || typeof value.version !== 'number'
    || !Number.isSafeInteger(value.version) || value.version < 0) return null;
  return {
    id: value.id,
    status: value.status as OrderStatus,
    currency: value.currency,
    totalMinor: value.totalMinor,
    version: value.version,
  };
}

export function advanceView(
  current: OrderView | null,
  incoming: OrderView,
  orderId: string,
): OrderView | null {
  if (incoming.id !== orderId) return current;
  if (current && incoming.version <= current.version) return current;
  return incoming;
}

export function connectOrderPage(
  orderId: string,
  token: string,
  render: (order: OrderView) => void,
  connection: (state: 'syncing' | 'live' | 'stale') => void,
): () => void {
  const socket = io('/orders', {
    autoConnect: false,
    auth: { token },
    transports: ['websocket'],
  });
  let current: OrderView | null = null;
  let stopped = false;

  function receive(payload: unknown): void {
    if (stopped) return;
    const incoming = parseOrderView(payload);
    if (!incoming) return;
    const next = advanceView(current, incoming, orderId);
    if (next && next !== current) {
      current = next;
      render(next);
    }
  }

  function synchronize(): void {
    connection('syncing');
    socket.timeout(5000).emit(
      'orders.watch', { orderId },
      (error: Error | null, reply: unknown) => {
        if (stopped) return;
        if (error || !reply || typeof reply !== 'object'
          || !('ok' in reply) || reply.ok !== true
          || !('order' in reply)) {
          connection('stale');
          return;
        }
        const snapshot = parseOrderView(reply.order);
        if (!snapshot || snapshot.id !== orderId || !socket.connected) {
          connection('stale');
          return;
        }
        receive(snapshot);
        connection('live');
      },
    );
  }

  socket.on('orders.changed', receive);
  socket.on('connect', synchronize);
  socket.on('disconnect', () => connection('stale'));
  socket.on('connect_error', () => connection('stale'));
  socket.connect();

  return () => {
    stopped = true;
    socket.removeAllListeners();
    socket.disconnect();
  };
}
```

클라이언트는 이벤트 listener를 등록한 뒤 연결한다. 연결 완료 때마다 구독과 현재 상태 조회를 다시 요청하므로 일시적인 네트워크 단절 후의 자동 재연결도 같은 절차를 통과한다. `live`는 연결과 초기 동기화가 성공했다는 화면 상태이지 서버 저장과 화면 표시의 원자적 보장이 아니다. ACK가 오지 않거나 오류가 나면 기존 주문을 지우지 않고 `stale`로 표시한다. 사용자는 마지막 확인 정보를 보면서 재시도하거나 기존 `GET /orders/:id`로 새로고침할 수 있어야 한다.

위 브라우저 파일이 자동으로 수행하는 복구는 재연결 후 `orders.watch` ACK를 다시 받는 경로다. HTTP 새로고침 버튼을 연결할 때는 별도의 REST 응답 경계를 지킨다. 같은 로그인 토큰을 `Authorization: Bearer <token>`으로 보내고, 이미 표시한 주문 버전 또는 쓰기 응답으로 아는 최소 버전을 `minimumVersion`에 전달한다. 둘 다 없다면 0이며, 16장의 파서는 이 값을 생략해도 0으로 처리한다. 명시한 값은 선행 0 없는 십진 정수와 Prisma `Int` 범위 0~2,147,483,647을 따라야 한다.

HTTP 200의 body는 `{ kind: 'ready', order }`다. **body 전체가 아니라 `body.order`만** `parseOrderView`로 검증하고 기존 `advanceView`로 합친다. HTTP 202는 `{ kind: 'pending', observedVersion }`이며 `observedVersion`은 숫자 또는 `null`이다. 이때는 마지막 화면을 유지하고 반영 중임을 표시하며, snapshot으로 취급하거나 결제를 다시 요청하지 않는다. 404의 `{ kind: 'not_found' }`는 없는 주문과 다른 고객의 주문을 동일하게 숨긴다. 401은 재인증, 인프라 5xx는 일시적인 조회 장애로 다루며 둘을 `not_found`로 바꾸지 않는다. Socket.IO ACK의 `{ ok: true, order }`와 REST의 `kind` 봉투를 같은 파서로 처리하지 않는다. HTTP `ready`도 요구한 최소 버전 이상인 projection이라는 뜻이지 항상 원본의 최신 버전이라는 보장은 아니다. 반면 이 장의 소켓 따라잡기는 원본 `Order`를 직접 읽는다.

로그아웃 버튼은 로컬 토큰을 지우는 것과 함께 즉시 이 정리 함수를 호출해야 한다. 서버에 로그아웃 사건이 전달되는 것은 아니다. 다른 곳에 복사된 토큰은 계정 세대가 바뀌거나 만료되지 않는 한 여전히 검증될 수 있다. 서버가 재검증 실패로 연결을 닫으면 이전 토큰으로 무조건 재연결하지 않고, 계정 화면에서 다시 로그인한 뒤 새 `LoginResult.accessToken`으로 `connectOrderPage`를 구성한다. 반환한 정리 함수는 이 함수가 만든 소켓과 listener만 정리한다. React 화면에서는 주문 ID가 바뀌거나 컴포넌트가 내려갈 때 호출한다. 같은 소켓을 앱 전역에서 공유하는 설계라면 `removeAllListeners`가 다른 기능을 제거할 수 있으므로 이벤트별 해제와 별도 소유권 설계로 바꿔야 한다.

## 순서·누락·권한 실패를 다른 실험으로 만든다

다음은 `src/orders/realtime/order-feed.test.ts`의 **완전한 단위 테스트 파일**이다. 상태 문자열 순위가 아니라 버전을 사용한다는 핵심 회귀를 검증한다. 실시간 전송과 무관한 순수 계산이므로 소켓을 열거나 시간을 기다릴 필요가 없다.

```ts
import { describe, expect, it } from 'vitest';
import { advanceView, parseOrderView } from './order-feed.js';
import type { OrderView } from './contracts.js';

describe('order view version ordering', () => {
  const newest: OrderView = {
    id: 'order-1', status: 'shipped', currency: 'KRW',
    totalMinor: '29000', version: 3,
  };

  it('accepts version zero and advances to the first paid version', () => {
    const initial: OrderView = {
      ...newest, status: 'pending_payment', version: 0,
    };
    const paid: OrderView = { ...initial, status: 'paid', version: 1 };
    expect(parseOrderView(initial)).toEqual(initial);
    expect(advanceView(null, initial, 'order-1')).toEqual(initial);
    expect(advanceView(initial, paid, 'order-1')).toEqual(paid);
    expect(parseOrderView({ ...initial, version: -1 })).toBeNull();
    expect(parseOrderView({ ...initial, version: 0.5 })).toBeNull();
  });

  it('ignores duplicates, older versions, and another order', () => {
    expect(advanceView(newest, { ...newest }, 'order-1')).toBe(newest);
    expect(advanceView(newest, {
      ...newest, status: 'fulfilling', version: 2,
    }, 'order-1')).toBe(newest);
    expect(advanceView(null, {
      ...newest, id: 'order-2',
    }, 'order-1')).toBeNull();
  });

  it('accepts a newer full snapshot and rejects malformed money', () => {
    expect(advanceView(null, newest, 'order-1')).toEqual(newest);
    expect(parseOrderView({ ...newest, totalMinor: 29000 })).toBeNull();
    expect(parseOrderView({ ...newest, totalMinor: '29000.5' })).toBeNull();
  });
});
```

```sh
pnpm exec vitest run src/orders/realtime/order-feed.test.ts
```

다음 `src/orders/realtime/sessions.test.ts`는 **완전한 인증 어댑터 단위 실험**이다. 실제 서명자·검증기·1권 공유 인증기를 쓰고 계정 조회만 제어한다. principal이나 폐기 이벤트를 만들어 넣지 않는다. 고정 시각과 Promise 장벽으로 정확한 만료 및 정리 경합을 재현한다. DB와 Socket.IO 전송을 검증하는 테스트는 아니다.

```ts
import { describe, expect, it, vi } from 'vitest';
import { DefaultJwtSigner, DefaultJwtVerifier, type JwtVerifierOptions } from '@fluojs/jwt';
import { AuthenticationExpiredError, AuthenticationFailedError, AuthenticationRequiredError } from '@fluojs/passport';
import { BlogTokenAuthenticator } from '../../auth/blog-token-authenticator.js';
import { BlogRealtimeSessions, isAuthenticationFailure } from './sessions.js';

const options: JwtVerifierOptions = {
  algorithms: ['HS256'], secret: 'test-only-key-not-for-production',
  issuer: 'fluo-blog', audience: 'fluo-blog-web',
  accessTokenTtlSeconds: 900, requireExp: true, clockSkewSeconds: 0,
};

describe('realtime authentication boundaries', () => {
  it('revalidates the account generation and preserves infrastructure errors', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const verifier = new DefaultJwtVerifier(options);
    let generation = 1;
    let failure: Error | undefined;
    const tokens = new BlogTokenAuthenticator(verifier, {
      async findActiveSubject(id: string) {
        if (failure) throw failure;
        return { id, displayName: 'Reader', authVersion: generation };
      },
    });
    const sessions = new BlogRealtimeSessions(tokens);
    try {
      const token = await new DefaultJwtSigner(options).signAccessToken({
        sub: 'reader-a', authVersion: 1, scopes: ['posts:write'],
      });
      const lease = await sessions.open(token);
      expect(lease.subject).toBe('reader-a');
      await expect(lease.revalidate()).resolves.toBeUndefined();
      generation = 2;
      await expect(lease.revalidate()).rejects.toBeInstanceOf(AuthenticationFailedError);
      generation = 1;
      failure = new Error('Database unavailable');
      await expect(lease.revalidate()).rejects.toBe(failure);
      expect(isAuthenticationFailure(failure)).toBe(false);
      failure = undefined;
      clock.mockReturnValue(1_800_000_900_000);
      expect(() => lease.assertActive()).toThrow(AuthenticationExpiredError);
      await expect(sessions.open(token)).rejects.toBeInstanceOf(AuthenticationExpiredError);
      lease.close();
      lease.close();
      await expect(lease.revalidate()).rejects.toBeInstanceOf(AuthenticationRequiredError);
    } finally {
      verifier.dispose();
      clock.mockRestore();
    }
  });

  it('rejects expiration reached during the account lookup', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const verifier = new DefaultJwtVerifier(options);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const tokens = new BlogTokenAuthenticator(verifier, {
      async findActiveSubject(id: string) {
        entered.resolve();
        await release.promise;
        return { id, displayName: 'Reader', authVersion: 1 };
      },
    });
    try {
      const token = await new DefaultJwtSigner(options).signAccessToken({
        sub: 'reader-a', authVersion: 1, scopes: ['posts:write'],
      });
      const opening = new BlogRealtimeSessions(tokens).open(token);
      const rejected = expect(opening).rejects.toBeInstanceOf(AuthenticationExpiredError);
      await entered.promise;
      clock.mockReturnValue(1_800_000_900_000);
      release.resolve();
      await rejected;
    } finally {
      release.resolve();
      verifier.dispose();
      clock.mockRestore();
    }
  });
});
```

```sh
pnpm exec vitest run src/orders/realtime/order-feed.test.ts src/orders/realtime/sessions.test.ts
```

전송 통합 실험에는 1권의 마이그레이션과 `JWT_SECRET`으로 실행한 앱, 6장의 주문 모델, 호환되는 Socket.IO 클라이언트가 필요하다. 기존 가입·로그인 경로로 두 활성 계정을 만들고 각각 `LoginResult.accessToken`을 handshake에 전달한다. 첫 계정의 주문을 두 번째 계정이 요청하면 `NOT_FOUND_OR_FORBIDDEN`이며 주문 방에 없어야 한다. 다른 `customerId`를 payload에 넣어도 결과는 같다. 허용 고객의 수신 이벤트는 발행 전에 Promise로 구독하고 방 구성 검사와 그 수신을 장벽으로 사용한다. 금지 고객에게 일정 시간 메시지가 안 왔다는 관찰만으로 권한 시험을 통과시키지 않는다.

첫 권한 조회와 방 가입 사이에 주문을 갱신하면 두 번째 조회가 새 버전을 반환해야 한다. 가입 직후 버전 3을 발행하고 ACK에는 버전 2를 반환하는 순서도 제어해 화면이 3에 머무는지 확인한다. 동시 구독은 첫 조회를 장벽에 멈춘 동안 두 번째 watch가 `WATCH_IN_PROGRESS`인지 확인한다. 이벤트 순서는 호출 장벽으로 제어하고 timeout은 테스트 실패를 끝내는 상한으로만 사용한다.

폐기 실험에서는 실제 계정의 `authVersion` 증가 또는 `disabled` 변경을 커밋한 다음, watch와 publisher를 각각 호출한다. 둘 다 주문 payload 없이 연결을 닫아야 한다. 계정 조회 DB 오류는 `UNAVAILABLE`이고 원래 오류가 로그 또는 publisher 호출자까지 전달되어야 한다. 실제 시각을 `exp`로 이동한 경우와 마지막 계정 조회 중 만료에 도달한 경우도 분리한다. 로그아웃은 브라우저의 정리 함수를 호출하는 시험이지 존재하지 않는 서버 `onInvalidated`를 호출하는 시험이 아니다.

정리 경합은 실제 `BlogRealtimeSessions.open` 내부 계정 조회를 장벽에 멈춘 뒤 disconnect 또는 `SessionBindings.onApplicationShutdown`을 실행한다. 장벽을 풀면 `accept`는 `false`, 늦게 만든 lease는 닫힌 상태이고 이 바인딩이 등록한 disconnect listener는 0개여야 한다. 송신 쪽도 계정·주문 조회 중 종료하고 장벽을 푼 뒤 `publish` 완료까지 기다려 주문 emit 횟수가 0인지 확인한다. 이미 시작한 DB 작업의 취소나 이미 송신한 frame의 회수까지 보장하는 시험으로 확대하지 않는다.

이 원고의 어댑터는 본문에 구현했지만 위 PostgreSQL·실제 listener 통합은 실행하지 않았다. 단위 실험과 실제 전송·DB 검증은 구분한다. 아래 패키지 테스트는 Socket.IO 연결·guard·종료 계약의 근거이지 이 상점의 인증 통합을 대신 검증한 증거는 아니다.

## 메시지 전달을 주문 저장의 증거로 쓰지 않는다

`OrderRealtimePublisher.publish`는 이미 커밋된 `OrderView`만 받는다. 버전은 `OrderTransitionsService.apply`가 상태·`OrderTransition` 감사와 함께 저장한 값을 그대로 사용하고, 소켓 발행이나 재시도 횟수로 다시 증가시키지 않는다. 주문 트랜잭션 안에서 먼저 emit한 뒤 DB를 저장하면 저장 실패한 상태가 고객 화면에 나타난다. 반대로 커밋 후 프로세스가 죽어 emit하지 못할 수 있으므로, 확정 사건은 앞서 만든 Outbox에서 읽어 이 publisher를 호출한다. Outbox 재전달로 같은 버전이 여러 번 와도 클라이언트는 중복을 버린다. 이 publisher가 반환했다는 사실은 모든 고객의 수신 확인이 아니다.

한 프로세스의 방에 가입한 고객에게 다른 프로세스가 자동으로 전송하지도 않는다. 이 구현의 binding과 수신자별 검증은 로컬 소켓만 다루므로 단일 listener를 전제로 한다. 인스턴스를 늘리면 각 소켓 소유 프로세스가 커밋된 주문 사건을 받아 자기 고객을 재검증하도록 사건 전달 경계를 따로 설계해야 한다. 하나의 Outbox 소비자가 한 프로세스의 publisher만 호출하거나 Socket.IO 공유 adapter만 추가해서는 이 경계가 완성되지 않는다. Redis를 이미 쓴다고 Socket.IO가 그 Redis를 자동으로 찾아 연결하는 것도 아니다. 연결 라우팅과 장애 후 재조회, polling을 허용할 때의 세션 유지 조건도 별도로 확인한다.

느린 고객에게 모든 중간 상태를 쌓아 보내는 것도 피한다. 이 장은 버전이 붙은 전체 스냅샷이므로 최신 상태로 수렴하는 것이 목표다. 그러나 `buffer.maxPendingMessagesPerSocket`은 **연결 handler가 준비되기 전의 인바운드 버퍼**이지 모든 아웃바운드 메시지의 상한이 아니다. 이 값을 낮췄다고 느린 클라이언트의 송신 메모리 문제가 해결되었다고 주장할 수 없다. 큰 주문 항목 전체 대신 작은 상태 스냅샷을 보내고, 메시지 빈도와 느린 연결의 종료 정책을 별도로 측정한다.

raw WebSocket을 선택했다면 wire 형태와 제한도 다시 정해야 한다. 공통 room 방송은 `{ event, data }` JSON frame을 보내며 raw handler의 네 번째 인자는 Socket.IO ACK가 아니라 `socketId`다. 기본 handler 반환은 무시되고, 명시적 `send` 또는 `replies: { mode: 'event-envelope' }` 설정이 필요하다. Node raw adapter에는 별도의 heartbeat와 backpressure 옵션이 있지만 그 설정을 Socket.IO 옵션에 그대로 넣을 수 없다. 두 패키지가 공유하는 문법보다 실제 전송 계약을 기준으로 선택한다.

종료 시 Socket.IO는 수락된 게이트웨이 작업과 클라이언트 정리를 제한된 시간 안에 수행하고, 기반 HTTP listener 소유권은 platform adapter에 남긴다. 종료 중 새 연결을 받지 않는 것과 남은 작업을 정리하는 것은 모두 필요하다. 시간이 초과한 연결은 다시 접속해서 최신 상태를 확인할 수 있어야 하므로 화면 복구 경로가 마지막 안전망이다.

이제 고객 주문 화면은 연결 중에는 변화를 빠르게 받고, 중복·지연에는 버전으로 대응하며, 다시 연결될 때 현재 상태를 읽는다. 결제와 재고의 권위는 계속 서버의 업무 모델에 있다. 다음 장에서는 고객 한 명의 주문이 아니라 운영자가 많은 주문과 계정 정보를 함께 보는 조회를 만든다. 실시간 전달 방식을 바꾸기보다 필요한 데이터를 적은 조회로 조합하는 문제가 중심이 된다.

## 근거와 검증 범위

- [공유 구현 경계](../EDITORIAL.ko.md): 단일 DB 등록, 주문 초기 버전 0, 상태 전이와 감사의 원자성.
- [1권 실제 인증 구현](../01-fluoblog/ch14-authentication.ko.md): `LoginResult`, `BlogTokenAuthenticator`, `AuthModule` export와 로컬 로그아웃의 한계.
- [Passport 인증 오류](../../packages/passport/src/errors.ts), [JWT 검증](../../packages/jwt/src/signing/verifier.ts): 인증 실패와 인프라 오류 구분, 만료 확인.
- [주문 모델](./ch06-order-state-machine.ko.md), [Prisma 계약](../../packages/prisma/README.ko.md): 기존 원장의 소유권 조건 조회.
- [Socket.IO 계약](../../packages/socket.io/README.ko.md), [공개 export](../../packages/socket.io/src/index.ts), [옵션·guard·room 타입](../../packages/socket.io/src/types.ts): namespace, ACK, Node 지원 범위.
- [Socket.IO adapter 구현](../../packages/socket.io/src/adapter.ts): native join 호출, namespace별 방송, listener 소유권.
- [게이트웨이 작성 계약](../../packages/websockets/README.ko.md), [공개 export](../../packages/websockets/src/index.ts), [데코레이터 구현](../../packages/websockets/src/decorators.ts): 공유 문법과 raw WebSocket의 차이.
- [Socket.IO 모듈 테스트](../../packages/socket.io/src/module.test.ts), [종료 중 입장 테스트](../../packages/socket.io/src/shutdown-admission.test.ts), [종료 수명주기 테스트](../../packages/socket.io/src/shutdown-lifecycle.test.ts): 실제 전송·종료 경계의 근거. 이번 집필에서 재실행하지 않았다.
