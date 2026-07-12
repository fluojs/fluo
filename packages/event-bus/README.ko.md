# @fluojs/event-bus

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 인프로세스(In-process) 이벤트 발행 및 구독 패키지입니다. 데코레이터 기반의 핸들러 탐색 기능을 제공하며, Redis Pub/Sub과 같은 외부 트랜스포트 어댑터를 통해 프로세스 간 통신을 지원합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [일반적인 패턴](#일반적인-패턴)
- [공개 API 개요](#공개-api-개요)
- [런타임별 및 통합 서브패스](#런타임별-및-통합-서브패스)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/event-bus
```

## 사용 시점

- 직접적인 서비스 호출 대신 이벤트를 통해 컴포넌트 간의 결합도를 낮추고 싶을 때.
- 하나의 동작에 대해 시스템의 여러 부분에서 반응해야 할 때 (예: 사용자 가입 시 환영 이메일 발송과 대시보드 업데이트를 동시에 수행).
- 분산 환경 지원이 선택적으로 필요한 간단한 인메모리 이벤트 버스가 필요할 때.

## 빠른 시작

### 1. 이벤트 및 핸들러 정의

이벤트 클래스를 정의하고, 핸들러 메서드에 `@OnEvent` 데코레이터를 사용합니다.

```typescript
import { OnEvent } from '@fluojs/event-bus';

export class UserSignedUpEvent {
  constructor(public readonly email: string) {}
}

export class NotificationService {
  @OnEvent(UserSignedUpEvent)
  async notify(event: UserSignedUpEvent) {
    console.log(`환영 이메일 전송 대상: ${event.email}`);
  }
}
```

### 2. 모듈 등록 및 이벤트 발행

`EventBusModule`을 등록하고 `EventBusLifecycleService`를 주입받아 이벤트를 발행합니다.

인프로세스 이벤트 버스 등록은 `EventBusModule.forRoot(...)`로 구성합니다. Event-bus provider는 기본적으로 global(`global: true`)이므로 root graph를 import하는 모듈에서 `EventBusLifecycleService`와 `EVENT_BUS` 호환성 토큰을 사용할 수 있습니다. 모듈-local visibility가 필요하면 `EventBusModule.forRoot({ global: false })`를 전달하세요.

```typescript
import { Module, Inject } from '@fluojs/core';
import { EventBusModule, EventBusLifecycleService } from '@fluojs/event-bus';

@Inject(EventBusLifecycleService)
export class UserService {
  constructor(private readonly eventBus: EventBusLifecycleService) {}

  async signUp(email: string) {
    // 사용자 저장 로직...
    await this.eventBus.publish(new UserSignedUpEvent(email));
  }
}

@Module({
  imports: [EventBusModule.forRoot()],
  providers: [NotificationService, UserService],
})
export class AppModule {}
```

`publish(event, options?)`는 `signal`, `timeoutMs`, `waitForHandlers`를 지원합니다. `waitForHandlers`의 기본값은 `true`이며, 기다리는 로컬 핸들러와 기다리는 트랜스포트 publish는 동일한 timeout 및 cancellation bound를 공유합니다. 이러한 bound가 실제 handler 또는 transport 작업이 끝나기 전에 호출자에게 반환되는 publish promise를 settle하더라도, shutdown은 해당 underlying awaited work가 settle되거나 shutdown drain bound가 만료될 때까지 계속 추적합니다. `waitForHandlers`를 `false`로 설정하면 publish가 즉시 반환되고 timeout bound를 적용하지 않지만, handler와 transport 작업은 background에서 계속 실행되며 shutdown drain 추적 대상에 남습니다. Shutdown 중에는 이벤트 버스가 진행 중인 awaited/background publish 및 inbound transport handler 작업을 drain한 뒤 트랜스포트를 닫고, lifecycle이 stopping에 진입한 뒤의 새 publish 호출과 shutdown 시작 뒤 도착한 inbound transport callback은 무시합니다. Shutdown drain은 기본값이 5000ms인 `EventBusModule.forRoot({ shutdown: { drainTimeoutMs } })`로 제한됩니다. 활성 dispatch 작업이 이 bound 이후에도 멈춰 있으면 bus는 degraded status diagnostic을 기록하고 경고를 남긴 뒤, 애플리케이션 close를 무기한 hang시키지 않고 transport cleanup을 계속합니다.

## 일반적인 패턴

### 분산 팬아웃 (Redis)

트랜스포트 어댑터를 연결하여 이벤트 버스를 다른 프로세스로 확장할 수 있습니다.

```typescript
import { RedisEventBusTransport } from '@fluojs/event-bus/redis';

EventBusModule.forRoot({
  transport: new RedisEventBusTransport({ 
    publishClient: redis, 
    subscribeClient: redisSubscriber 
  }),
})
```

Redis Pub/Sub은 durable work queue가 아니라 fan-out transport입니다. 여러 애플리케이션 인스턴스가 같은 이벤트 채널을 구독하면 각 인스턴스가 같은 published fact를 볼 수 있습니다. 따라서 상태를 변경하거나 알림을 보내거나 외부 시스템을 호출하는 handler는 idempotent해야 합니다. Payload에 안정적인 event identifier 또는 business key를 담고, 이미 적용한 reaction을 기록하며, 반복 전달이 side effect를 두 번 실행하는 대신 같은 결과로 수렴하도록 만드세요.

`@OnEvent(...)` handler는 작고 bounded하게 유지하세요. 빠른 local projection, cache invalidation, 가벼운 notification처럼 publish timeout과 shutdown drain window 안에 끝낼 수 있는 reaction에 적합합니다. Reaction이 느리거나, failure-prone이거나, retry 가능하거나, operator-visible dead-letter handling이 필요하다면 해당 작업을 inline으로 수행하지 말고 event handler에서 `@fluojs/queue`의 durable job으로 hand off하세요. Handoff에는 애플리케이션이 소유한 unique claim을 사용하고, `queue.enqueue(...)`가 성공한 뒤에만 handoff를 enqueued로 표시하세요. Enqueue가 실패하면 pending claim을 해제해 이후 duplicate event가 안전하게 다시 시도할 수 있게 합니다.

아래 예제의 `this.reactions` helper는 `@fluojs/event-bus`나 `@fluojs/queue` API가 아니라 애플리케이션이 소유한 claim store를 나타냅니다. Business key를 atomic하게 claim하고 stale pending claim을 애플리케이션의 retry policy에 따라 복구할 수 있는 저장소로 구현하세요.

```typescript
import { Inject } from '@fluojs/core';
import { OnEvent } from '@fluojs/event-bus';
import { QueueLifecycleService } from '@fluojs/queue';

export class GenerateInvoiceJob {
  constructor(public readonly orderId: string) {}
}

@Inject(QueueLifecycleService)
export class BillingEventsHandler {
  constructor(private readonly queue: QueueLifecycleService) {}

  @OnEvent(OrderPlacedEvent)
  async enqueueInvoice(event: OrderPlacedEvent) {
    const handoffKey = `${event.orderId}:invoice`;

    if (!(await this.reactions.claimPending(handoffKey))) {
      return;
    }

    try {
      await this.queue.enqueue(new GenerateInvoiceJob(event.orderId));
      await this.reactions.markEnqueued(handoffKey);
    } catch (error) {
      await this.reactions.releasePending(handoffKey);
      throw error;
    }
  }
}
```

비즈니스 사실이 발생했음을 표현할 때는 event bus를 사용하세요. Reaction에 retry, backoff, workload isolation, dead-letter inspection이 필요하면 Queue를 사용하세요. Claim이 pending인 동안 프로세스가 종료될 수 있다면 애플리케이션의 retry policy에 맞게 stale pending record를 복구하도록 애플리케이션 소유 claim store를 설계하세요.

### 버전이 명시된 이벤트 키

`static eventKey`를 사용하여 클래스 이름 변경이나 코드 압축(minification)과 관계없이 안정적인 채널 이름을 유지할 수 있습니다.

```typescript
class UserRegisteredEvent {
  static readonly eventKey = 'user.registered.v1';
}
```

핸들러는 imported module의 singleton provider와 controller에서 발견됩니다. Discovery는 여러 provider가 같은 구현 class를 공유하더라도 서로 다른 singleton provider identity를 유지하며, 같은 provider token과 handler method가 중복 등록된 경우에는 한 번만 호출합니다. Event-bus bootstrap은 ready 상태를 보고하기 전에 발견된 모든 handler target을 resolve하며, 실제 handler target resolution이 실패하면 handler를 조용히 건너뛰고 ready를 보고하는 대신 bootstrap을 실패시킵니다. Discovery는 이미 handler metadata를 가진 singleton `useValue` instance와 provider token 자체가 `@OnEvent(...)` metadata를 가진 handler class인 singleton `useFactory` provider만 검사하므로, event-bus bootstrap 중 관련 없는 factory provider는 호출되지 않습니다. 각 핸들러는 격리된 clone payload를 받으며, class inheritance는 `instanceof` 매칭으로 지원됩니다. 외부 트랜스포트를 구성하면 subclass event publish는 publisher process에 해당 타입의 local handler가 없더라도 subclass channel과 prototype chain의 모든 inherited event channel로 fan-out됩니다. Subclass가 직접 `static eventKey`를 선언한 경우에만 그 값을 사용하며, 그렇지 않으면 subclass channel은 class name을 유지하고 base class는 자신의 stable key를 유지합니다.

## 공개 API 개요

### 핵심 구성 요소
- `EventBusModule.forRoot({ global?, publish?, shutdown?, transport? })`: 이벤트 버스 등록을 위한 기본 진입점입니다. `global`의 기본값은 `true`이며, event-bus provider를 event-bus 모듈을 import한 모듈을 통해서만 보이게 하려면 `global: false`를 설정하세요.
- `EventBusLifecycleService`: 이벤트 발행(`publish(event, options?)`)과 platform status snapshot 생성을 위한 기본 서비스입니다.
- `@OnEvent(EventClass)`: 특정 메서드를 이벤트 핸들러로 지정하는 데코레이터입니다.
- `EVENT_BUS`: 발행 facade를 위한 호환성 주입 토큰입니다.
- `createEventBusPlatformStatusSnapshot(...)`: diagnostics와 health surface에서 사용하는 상태 스냅샷 헬퍼입니다.

### 인터페이스
- `EventBusTransport`: 외부 트랜스포트 어댑터 구현을 위한 계약입니다.
- `EventBus`, `EventPublishOptions`, `EventBusModuleOptions`, `EventType`: 발행, 기본값, 트랜스포트, 안정적인 이벤트 키를 위한 타입 전용 계약입니다.
- `EventBusLifecycleState`, `EventBusStatusAdapterInput`, `EventBusPlatformStatusSnapshot`: status snapshot 계약입니다.

Transport bootstrap은 unique event channel마다 한 번만 subscribe합니다. `eventKey`가 있으면 transport channel 이름을 제어합니다. Bootstrap 중 이후 transport subscription이 실패하면 이벤트 버스는 이미 열린 channel을 rollback하기 위해 subscription error를 다시 던지기 전에 transport를 닫습니다. 잘못된 JSON transport message는 무시되며, shutdown 시작 뒤 도착한 inbound transport message는 local handler dispatch 전에 무시됩니다.

## 런타임별 및 통합 서브패스

| 관심사 | 서브패스 | 내보내는 항목 |
| --- | --- | --- |
| Redis Pub/Sub 트랜스포트 | `@fluojs/event-bus/redis` | `RedisEventBusTransport`, `RedisEventBusTransportOptions` |

`RedisEventBusTransport`는 명시적인 `@fluojs/event-bus/redis` 서브패스에만 유지되어 루트 `@fluojs/event-bus` 진입점이 모듈 등록, 로컬 발행, 데코레이터, 타입 전용 계약에 집중하도록 합니다. 이 트랜스포트는 shutdown 중 자신이 등록한 채널을 unsubscribe하고 message listener를 분리하지만, 호출자가 소유한 Redis 클라이언트를 disconnect하지 않습니다.

## 관련 패키지

- `@fluojs/cqrs`: 더 정형화된 아키텍처 패턴을 위해 이벤트 버스 위에 구축된 패키지입니다.
- `@fluojs/redis`: `RedisEventBusTransport` 사용 시 필요한 클라이언트를 제공합니다.

## 예제 소스

- `packages/event-bus/src/module.test.ts`: 핸들러 탐색 및 발행/구독 테스트 예제.
- `packages/event-bus/src/public-surface.test.ts`: 공개 API 계약 검증 예제.
- `packages/event-bus/src/status.test.ts`: status snapshot semantic 테스트 예제.
- `packages/event-bus/src/transports/redis-transport.test.ts`: Redis transport 동작 테스트 예제.
