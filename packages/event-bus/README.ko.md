# @konekti/event-bus

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


싱글톤 프로바이더와 컨트롤러 전반에서 데코레이터 기반 핸들러 검색 기능을 갖춘 Konekti 애플리케이션용 인프로세스(In-process) 이벤트 발행 패키지입니다. 프로세스 간 팬아웃(fan-out)을 위해 선택적으로 외부 트랜스포트 어댑터(예: Redis Pub/Sub)를 지원합니다.

## 설치

```bash
npm install @konekti/event-bus
```

## 빠른 시작

```typescript
import { Inject, Module } from '@konekti/core';
import { EventBusModule, EVENT_BUS, EventBus, OnEvent } from '@konekti/event-bus';

class UserRegisteredEvent {
  constructor(public readonly userId: string) {}
}

class WelcomeEmailService {
  @OnEvent(UserRegisteredEvent)
  async sendWelcomeEmail(event: UserRegisteredEvent) {
    // 이메일 전송
  }
}

@Inject([EVENT_BUS])
class UserService {
  constructor(private readonly eventBus: EventBus) {}

  async registerUser(userId: string) {
    await this.eventBus.publish(new UserRegisteredEvent(userId));
  }
}

@Module({
  imports: [EventBusModule.forRoot()],
  providers: [WelcomeEmailService, UserService],
})
export class AppModule {}
```

## API

- `EventBusModule.forRoot()` - 글로벌 `EVENT_BUS` 및 생명주기 검색 서비스를 등록합니다.
- `createEventBusProviders()` - 수동 구성을 위한 로우(raw) 프로바이더를 반환합니다.
- `EVENT_BUS` - 애플리케이션 이벤트 버스 인스턴스를 위한 DI 토큰입니다.
- `EventBus` - `publish(event, options?)` 메서드를 포함하는 인터페이스입니다.
- `EventBusTransport` - 외부 트랜스포트 어댑터를 위한 인터페이스입니다.
- `@OnEvent(EventClass)` - 프로바이더/컨트롤러 메서드를 이벤트 핸들러로 표시합니다.
- `createEventBusPlatformStatusSnapshot(input)` - 로컬/트랜스포트 lifecycle 및 degraded transport 진단을 공통 platform snapshot 필드로 매핑합니다.

### 루트 배럴 공개 표면 거버넌스 (0.x)

런타임 루트 배럴 거버넌스 테스트는 런타임 export를 기준으로 동작합니다. 아래에 문서화된 공개 TypeScript 전용 계약은 계속 패키지 API의 일부이지만, `Object.keys(...)` snapshot assertion에는 나타나지 않습니다.

- **supported**: `EventBusModule.forRoot`, `createEventBusProviders`, `EVENT_BUS`, `EventBus`, `EventBusTransport`, `@OnEvent`, status snapshot helper를 지원합니다.
- **compatibility-only**: `EVENT_BUS_OPTIONS` 및 metadata helper export(`defineEventHandlerMetadata`, `getEventHandlerMetadata`, `getEventHandlerMetadataEntries`, `eventBusMetadataSymbol`)는 0.x 호환성과 프레임워크/툴링 통합을 위해 export를 유지하지만, 신규 앱 레벨 import로는 권장하지 않습니다.
- **internal**: 문서화되지 않은 lifecycle/runtime wiring 세부사항은 루트 배럴이 현재 관련 symbol을 재노출하더라도 비계약 내부 동작입니다.

### 모듈 옵션

`EventBusModule.forRoot(options)`와 `createEventBusProviders(options)`는 다음 옵션을 허용합니다.

- `publish.timeoutMs` - `publish()`가 핸들러를 기다릴 때(`waitForHandlers: true`) 사용하는 핸들러별 대기 시간 제한입니다.
- `publish.waitForHandlers` - 기본 대기 모드입니다 (`true`는 대기하며 타임아웃 제한을 적용하고, `false`는 fire-and-forget 방식으로 디스패치합니다).
- `transport` - 프로세스 간 팬아웃을 위한 선택적 `EventBusTransport` 어댑터입니다.

### 트랜스포트 인터페이스

```typescript
interface EventBusTransport {
  publish(channel: string, payload: unknown): Promise<void>;
  subscribe(channel: string, handler: (payload: unknown) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
```

모든 외부 pub/sub 시스템을 연결하려면 이 인터페이스를 구현하세요.

### 이벤트 키 규약

트랜스포트 채널은 다음 규칙에 따라 이벤트 클래스에서 결정됩니다.

1. 이벤트 클래스에 `static eventKey = 'domain.event.v1'`가 정의되어 있으면 해당 문자열을 사용합니다.
2. 그렇지 않으면 하위 호환성을 위해 클래스 생성자 이름(class constructor name)을 기본값으로 사용합니다.

멀티 프로세스 배포의 경우, 버전이 명시된 키를 사용하는 것이 좋습니다.

```typescript
class UserRegisteredEvent {
  static readonly eventKey = 'user.registered.v1';

  constructor(public readonly userId: string) {}
}
```

 이는 트랜스포트 계약이 클래스 이름 변경이나 코드 미니피케이션(minification)에 결합되는 것을 방지하고, 스키마 진화를 명시적으로 만들어 줍니다.

### Redis Pub/Sub 어댑터

```bash
npm install ioredis
```

```typescript
import Redis from 'ioredis';
import { EventBusModule } from '@konekti/event-bus';
import { RedisEventBusTransport } from '@konekti/event-bus/redis';

const publishClient = new Redis();
const subscribeClient = new Redis();

@Module({
  imports: [
    EventBusModule.forRoot({
      transport: new RedisEventBusTransport({ publishClient, subscribeClient }),
    }),
  ],
})
export class AppModule {}
```

구독(subscribe) 모드의 클라이언트는 다른 명령을 실행할 수 없으므로 두 개의 별도 Redis 클라이언트가 필요합니다.

`RedisEventBusTransport`는 주입받은 Redis client의 lifecycle을 소유하지 않습니다. `close()` 시 transport가 등록한 채널 구독과 message listener만 정리하며, 호출자가 제공한 client에 대해 `quit()`이나 `disconnect()`를 호출하지 않습니다.

## 런타임 동작

- 핸들러 검색은 애플리케이션 부트스트랩 중에 `COMPILED_MODULES`를 통해 실행됩니다.
- 핸들러 인스턴스는 부트스트랩 중에 `RUNTIME_CONTAINER`에서 미리 해결(resolve)되며 발행 시 재사용됩니다.
- 이벤트는 `instanceof`를 사용하여 클래스별로 매칭되므로, 기본 클래스 핸들러는 파생된 이벤트를 수신합니다.
- 발행(Publishing)은 모든 매칭되는 로컬 핸들러로 디스패치됩니다. 트랜스포트가 구성된 경우, 매칭된 모든 핸들러 이벤트 타입의 트랜스포트 채널로 병렬 팬아웃됩니다.
- 트랜스포트가 구성된 경우, 이벤트 버스는 부트스트랩 시 발견된 각 이벤트 타입당 하나의 채널을 구독합니다. 들어오는 메시지는 `JSON.parse`로 역직렬화되어 매칭되는 로컬 핸들러로 디스패치됩니다.
- 들어오는 트랜스포트 메시지는 해당 구독 채널에 등록된 핸들러로만 디스패치되므로, 로컬/원격 상속 매칭 결과가 일관되게 유지됩니다.
- 특정 이벤트 타입의 채널 이름은 `eventType.eventKey`가 있으면 이를 사용하고, 없으면 클래스 생성자 이름을 사용합니다.
- 트랜스포트의 `close()`는 `onApplicationShutdown` 중에 호출됩니다.
- 타임아웃 제한은 대기 모드가 활성화된 경우(`waitForHandlers: true`)에만 적용됩니다. 비차단 모드(`false`)는 대기 없이 디스패치합니다.
- 핸들러 실패는 격리되어 `ApplicationLogger`를 통해 로깅됩니다.
- 요청/트랜지언트(Request/transient) 스코프 클래스의 `@OnEvent()`는 경고와 함께 무시됩니다.

## 비목표 (Non-goals)

- 큐잉, 재생(replay), 와일드카드 또는 순서 보장을 제공하지 않습니다.
- 명령형 `subscribe()` 또는 `unsubscribe()` API를 제공하지 않습니다.
- 내구성이나 영속성을 제공하지 않습니다 (이벤트는 크래시 발생 시 유실됩니다).

## 플랫폼 상태 스냅샷 시맨틱

`createEventBusPlatformStatusSnapshot(...)`(또는 `EventBusLifecycleService#createPlatformStatusSnapshot()`)으로 event-bus 라이프사이클 상태를 공통 platform snapshot 형태로 노출할 수 있습니다.

- `operationMode`: local-only 모드와 transport-backed 모드를 구분합니다.
- `readiness`: transport subscribe 실패를 `degraded`로 표면화합니다(무음 처리하지 않음).
- `health`: publish/subscribe/close 단계의 transport 실패를 degraded health 신호로 집계합니다.
- `details`: 탐색된 핸들러 수, 구독 채널 수, 기본 wait 모드, transport 실패 카운터를 포함합니다.
