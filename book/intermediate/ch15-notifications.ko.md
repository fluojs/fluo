<!-- packages: @fluojs/notifications, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 15. Notification Orchestration

이 장은 FluoShop의 여러 이벤트와 업무 흐름 위에 채널 독립적인 notification orchestration 계층을 세우는 방법을 설명합니다. Chapter 14에서 실시간 상호작용을 다뤘다면, 이제는 이메일, Slack, Discord 같은 후속 전달 채널을 현재 `@fluojs/notifications` 공개 API에 맞는 하나의 명시적인 dispatch boundary로 묶습니다.

## Learning Objectives
- notification orchestration이 채널별 SDK 호출을 직접 흩뿌리는 방식보다 왜 안전한지 이해합니다.
- `NotificationChannel` 계약과 `NotificationsService`의 역할을 구분해 설명합니다.
- `NotificationsModule.forRoot(...)`와 `NotificationsModule.forRootAsync(...)`로 채널과 dispatch 구성을 등록합니다.
- 기본 global provider visibility와 `global: false`가 notification provider를 module-local로 유지하는 시점을 설명합니다.
- `dispatch(...)`로 단건 알림을 보내고, `dispatchMany(...)`로 batch를 보내며, `NotificationDispatchBatchResult` 요약을 해석합니다.
- queue-backed delivery가 concrete queue 구현을 foundation 패키지 밖에 둔 채 대량 전송을 request path 밖으로 분리하는 방식을 분석합니다.
- lifecycle event publication이 concrete event bus에 패키지를 결합하지 않고도 알림 관측성과 실패 추적에 어떻게 기여하는지 정리합니다.
- `NotificationsService.createPlatformStatusSnapshot()`과 `createNotificationsPlatformStatusSnapshot(...)`으로 status snapshot을 만들고 읽습니다.
- FluoShop order success flow에서 notification dispatch가 어떤 후속 책임을 맡는지 설명합니다.

## Prerequisites
- Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8, Chapter 9, Chapter 10, Chapter 11, Chapter 12, Chapter 13, Chapter 14 완료.
- event-driven 후속 처리와 channel-based delivery 개념에 대한 기초 이해.
- queue, lifecycle event, status diagnostics를 활용한 비동기 전송 운영 감각.

## 15.1 The Orchestration Pattern

전형적인 마이크로서비스 환경에서는 여러 서비스가 알림을 보내야 합니다. 모든 서비스가 이메일이나 Slack을 위한 자체 로직을 구현하면 아키텍처는 취약해집니다. fluo는 **오케스트레이션(Orchestration)**을 통해 이 문제를 다루며, `NotificationsService`를 중앙 허브로 둡니다. 이 서비스는 이메일을 보내는 *방법*은 모르지만, 어떤 *채널*이 이메일을 담당하는지는 알고 있습니다. 덕분에 업무 로직은 채널별 SDK 대신 하나의 명시적인 dispatch 계약에 의존할 수 있습니다.

### Why Orchestrate?
- **공유 계약(Shared Contract)**: 모든 채널이 동일한 인터페이스를 따릅니다.
- **의존성 역전(Dependency Inversion)**: 애플리케이션 로직은 공급자 SDK가 아닌 `NotificationsService`에 의존합니다.
- **배치 의미(Batch Semantics)**: `dispatchMany(...)`는 성공, queued, 실패 작업을 하나의 batch summary로 돌려줍니다.
- **관측 가능성(Observability)**: lifecycle event와 status snapshot이 모든 전송 시도와 optional integration seam을 설명합니다.
- **탄력성(Resilience)**: 선택적인 큐 지원을 통해 알림 폭주가 메인 요청 경로를 막지 않게 합니다.

## 15.2 Defining a Notification Channel

채널은 애플리케이션이 소유한 `NotificationChannel` 값입니다. 보통 provider나 SDK를 감싸지만, `@fluojs/notifications`는 `channels`로 전달된 object만 받으며 NestJS provider metadata나 decorator에서 channel class를 discovery하지 않습니다. 채널은 fluo orchestrator와 외부 서비스 사이의 다리 역할을 하며, 각 채널이 서로 다른 전송 방식을 쓰더라도 애플리케이션에는 같은 모양의 계약을 제공합니다.

```typescript
import { type NotificationChannel } from '@fluojs/notifications';

const logChannel: NotificationChannel = {
  channel: 'logger',
  async send(notification) {
    console.log(`[Notification] ${notification.subject}:`, notification.payload);

    return {
      externalId: `log-${Date.now()}`,
      metadata: { sentAt: new Date().toISOString() },
    };
  },
};
```

`send` 메서드는 계약의 핵심입니다. 표준화된 알림 객체를 받고 전송 영수증을 반환하므로, 호출자는 Slack, 이메일, Discord 같은 채널별 세부 응답을 직접 해석하지 않아도 됩니다. Provider별 integration이 이미 자체 큐로 작업을 넘겼다면 채널은 `status: 'queued'`를 설정할 수 있고, 그렇지 않으면 orchestrator는 직접 전송을 `delivered`로 기록합니다.

## 15.3 Registering the Notifications Module

오케스트레이션 계층을 사용하려면 `NotificationsModule`을 등록해야 합니다. 이 등록은 명시적인 `NotificationChannel` 값, queue option, lifecycle event publication, provider visibility를 애플리케이션 시작 시점에 한곳에서 고정하는 역할을 합니다.

```typescript
import { Module } from '@fluojs/core';
import { NotificationsModule } from '@fluojs/notifications';

@Module({
  imports: [
    NotificationsModule.forRoot({
      channels: [logChannel],
    }),
  ],
})
export class AppModule {}
```

이 등록 이후 `NotificationsService`를 주입할 수 있습니다. 서비스는 등록된 채널 목록을 기준으로 요청된 알림을 적절한 transport나 queue 경계로 넘깁니다. `NotificationsModule.forRoot(...)`와 `NotificationsModule.forRootAsync(...)`는 기본적으로 `NotificationsService`, `NOTIFICATIONS`, `NOTIFICATION_CHANNELS`를 global로 export합니다. 이 provider들이 notifications module을 import한 module 안에서만 보이도록 유지하려면 `global: false`를 설정합니다.

채널이나 optional seam이 정적 module option이 아니라 DI로 해석된 설정에서 나와야 한다면 `forRootAsync(...)`를 사용합니다.

```typescript
import { ConfigService } from '@fluojs/config';
import { Module } from '@fluojs/core';
import {
  NotificationsModule,
  type NotificationChannel,
} from '@fluojs/notifications';

type NotificationConfig = {
  notifications: {
    emailChannelName?: string;
  };
};

function createEmailChannel(config: ConfigService<NotificationConfig>): NotificationChannel {
  const channelName = config.get('notifications.emailChannelName') ?? 'email';

  return {
    channel: channelName,
    async send(notification) {
      console.log('email notification 전송', notification.subject);

      return {
        metadata: { provider: channelName },
      };
    },
  };
}

@Module({
  imports: [
    NotificationsModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<NotificationConfig>) => ({
        channels: [createEmailChannel(config)],
      }),
      global: false,
    }),
  ],
})
export class NotificationsFeatureModule {}
```

`forRootAsync(...)`는 fluo의 명시적 injected-factory 스타일을 따릅니다. 애플리케이션이 소유한 provider가 `channels` 배열을 포함한 최종 options object를 만들고, notifications 패키지는 `process.env`를 직접 읽지 않습니다. Async registration 형태는 `forRootAsync({ inject, useFactory, global? })`이며, NestJS provider-discovery 또는 decorator-metadata scan이 아닙니다.

## 15.4 Dispatching Notifications

등록이 끝나면 provider에 `NotificationsService`를 주입할 수 있습니다. 도메인 서비스는 채널 구현체를 직접 알 필요 없이, 어떤 이벤트를 어떤 채널로 보낼지만 표현하면 됩니다.

```typescript
import { Inject } from '@fluojs/core';
import { NotificationsService } from '@fluojs/notifications';

@Inject(NotificationsService)
export class WelcomeService {
  constructor(private readonly notifications: NotificationsService) {}

  async sendWelcome(email: string) {
    await this.notifications.dispatch({
      channel: 'email',
      recipients: [email],
      subject: 'FluoShop에 오신 것을 환영합니다!',
      payload: {
        template: 'welcome',
        userId: '123',
      },
    });
  }
}
```

`dispatch(...)` 메서드는 비동기적입니다. 알림이 채널 또는 큐로 성공적으로 전달되면 완료되며, 실제 외부 전송이 queue 뒤에서 처리되는 경우에도 호출부는 같은 계약을 사용합니다. Queue adapter가 구성되어 있어도 단건 dispatch는 기본적으로 직접 전송됩니다. 단건 알림을 명시적으로 enqueue하려면 `{ queue: true }`를 전달하고, 직접 전송을 강제하려면 `{ queue: false }`를 전달합니다.

## 15.5 Batch Dispatch with `dispatchMany(...)`

하나의 workflow가 여러 알림을 내보내야 한다면 `dispatchMany(...)`를 사용합니다. 이 메서드는 ordered success result, queued count, 그리고 tolerant error handling이 활성화된 경우 captured failure를 담은 `NotificationDispatchBatchResult`를 반환합니다.

```typescript
@Inject(NotificationsService)
export class CampaignNotifications {
  constructor(private readonly notifications: NotificationsService) {}

  async sendLaunchDigest(recipients: readonly string[]) {
    const result = await this.notifications.dispatchMany(
      recipients.map((email) => ({
        channel: 'email',
        recipients: [email],
        subject: 'FluoShop launch digest',
        payload: {
          template: 'launch-digest',
        },
      })),
      { continueOnError: true },
    );

    if (result.failed > 0) {
      console.warn('일부 launch notification이 실패했습니다', result.failures);
    }

    return result;
  }
}
```

`continueOnError`가 없으면 direct batch dispatch는 첫 실패에서 throw합니다. `continueOnError: true`이면 서비스는 direct delivery와 sequential queue fallback 경로를 계속 진행하고, 성공 결과는 `results`에, 실패 시도는 `failures`에 보존합니다. 빈 batch는 `succeeded`, `failed`, `queued` count가 모두 0인 결과로 resolve됩니다.

## 15.6 Queue-Backed Delivery

대량 전송 시나리오에서는 전송 작업을 background worker로 offload해야 할 수 있습니다. `@fluojs/notifications` 패키지는 queue seam을 제공하지만, `@fluojs/queue` 또는 다른 concrete queue 구현에 의존하지 않습니다. Queue adapter는 애플리케이션 소유 integration입니다. Foundation 패키지는 queue client나 worker를 create/import/close/drain하지 않습니다.

```typescript
NotificationsModule.forRoot({
  channels: [emailChannel],
  queue: {
    adapter: {
      async enqueue(job) {
        // @fluojs/queue 또는 애플리케이션 소유 queue와의 통합
        return queue.enqueue(job);
      },
      async enqueueMany(jobs) {
        return Promise.all(jobs.map((job) => queue.enqueue(job)));
      },
    },
    bulkThreshold: 50,
  },
});
```

`dispatchMany(...)`가 `bulkThreshold`에 도달하거나 옵션에서 `{ queue: true }`를 명시하면, service는 직접 전송 대신 queue adapter를 사용합니다. 각 queued job은 안정적인 idempotency key를 포함합니다. `notification.id`가 있으면 그 값을 보존하고, 없으면 notification envelope에서 key를 파생하므로 idempotent enqueue를 지원하는 queue backend가 반복 요청을 중복 제거할 수 있습니다. Adapter가 `enqueueMany(...)`를 구현하지 않으면 fluo는 input order대로 job을 하나씩 enqueue합니다. 이때 `continueOnError: true`이면 성공한 queued result를 보존하고 실패한 enqueue 시도는 batch failures 목록으로 반환합니다. Queue delivery가 요청되었지만 queue adapter가 등록되어 있지 않으면 `NotificationQueueNotConfiguredError`가 발생합니다.

## 15.7 Lifecycle Events

신뢰성을 위해서는 관측 가능성이 필요합니다. 오케스트레이션 계층은 event publisher를 통해 lifecycle event를 발행할 수 있습니다. 전송 시작, 성공, 실패가 이벤트로 남으면 운영자는 알림 누락을 더 빨리 추적할 수 있고, 재시도 정책도 같은 흐름에 연결할 수 있습니다. Foundation 패키지는 lifecycle event contract를 소유하지만, concrete event-bus delivery는 애플리케이션 소유로 남깁니다. Publisher가 감싼 event-bus resource를 foundation 패키지가 create/import/close/drain하지 않습니다.

```typescript
NotificationsModule.forRoot({
  channels: [emailChannel],
  events: {
    publishLifecycleEvents: true,
    publisher: {
      async publish(event) {
        // @fluojs/event-bus 또는 애플리케이션 소유 publisher와의 통합
        await eventBus.publish(event);
      },
    },
  },
});
```

### Published Events:
- `notification.dispatch.requested`: `dispatch(...)` 또는 `dispatchMany(...)`가 notification 처리를 시작했을 때.
- `notification.dispatch.queued`: 알림이 백그라운드 queue로 이동했거나 채널이 queued delivery를 보고했을 때.
- `notification.dispatch.delivered`: 채널이 성공적인 direct delivery를 확인했을 때.
- `notification.dispatch.failed`: 채널 해석, queue enqueue, provider delivery가 실패했을 때.

`events.publisher`가 구성되어 있으면 module registration 또는 dispatch 시점에 `publishLifecycleEvents: false`를 설정하지 않는 한 lifecycle publication은 기본으로 켜집니다. 채널 해석 실패는 영구적인 구성 오류입니다. 서비스는 `requested` 다음 `failed`를 발행하고, queue에 넣거나 provider를 호출하지 않은 채 `NotificationChannelNotFoundError`를 던집니다. Queue enqueue와 provider delivery 실패도 `failed`를 발행하지만, retry 정책은 underlying queue/provider error를 기준으로 판단해야 합니다. Queued bulk dispatch는 queue 미구성, channel 해석, 순차 fallback enqueue 실패를 포함해 `requested`를 발행한 모든 notification에 terminal `queued` 또는 `failed` 이벤트를 발행합니다. 채널이 `externalId`를 생략하면 서비스는 시간이나 난수가 아니라 notification envelope에서 deterministic fallback delivery id를 만듭니다.

성공 이벤트 publication failure는 이미 완료된 delivery를 애플리케이션 실패로 바꾸지 않도록 best-effort입니다. 반면 `notification.dispatch.failed` publication failure는 다르게 처리됩니다. 호출자는 원래 dispatch error와 publisher error를 모두 담은 `AggregateError`를 받으므로 실패 알림 reporting이 조용히 누락되지 않습니다.

## 15.8 Status Snapshots and Diagnostics

Notifications는 health/readiness endpoint가 concrete queue 또는 event-bus resource를 소유하지 않고도 notification wiring을 설명할 수 있도록 platform diagnostics를 노출합니다.

```typescript
import { Inject } from '@fluojs/core';
import {
  NotificationsService,
  createNotificationsPlatformStatusSnapshot,
} from '@fluojs/notifications';

@Inject(NotificationsService)
export class NotificationsDiagnostics {
  constructor(private readonly notifications: NotificationsService) {}

  currentStatus() {
    return this.notifications.createPlatformStatusSnapshot();
  }
}

const standaloneStatus = createNotificationsPlatformStatusSnapshot({
  bulkQueueThreshold: 50,
  channelsRegistered: 2,
  eventPublisherConfigured: true,
  queueConfigured: true,
});
```

`NotificationsService.createPlatformStatusSnapshot()`은 active module wiring을 읽습니다. `createNotificationsPlatformStatusSnapshot(...)`은 caller가 이미 count와 integration flag를 갖고 있을 때 사용할 수 있는 value-level helper입니다. Snapshot은 `readiness`, `health`, `ownership`, `operationMode`, `notifications.queue-adapter`와 `notifications.event-publisher` 같은 dependency diagnostics, 해당 seam이 구성된 경우의 `ownership.externallyManaged: true`, 그리고 foundation 패키지가 concrete queue 또는 event-bus resource를 create/close/drain하지 않음을 나타내는 `ownsResources: false`를 포함합니다.

## 15.9 FluoShop Context: Order Success Flow

FluoShop은 주문 확인을 위해 알림을 사용합니다. 이는 Part 2에서 구축한 event-driven 작업 위에 놓입니다. `OrderPlacedEvent`가 `OrderSaga`에 의해 포착되면 알림 dispatch가 트리거되고, 주문 처리와 사용자 알림은 느슨하게 연결된 후속 책임으로 분리됩니다.

```typescript
@OnEvent(OrderPlacedEvent)
async onOrderPlaced(event: OrderPlacedEvent) {
  await this.notifications.dispatch({
    channel: 'email',
    recipients: [event.userEmail],
    subject: `주문 #${event.orderId} 확인됨`,
    payload: {
      orderId: event.orderId,
      total: event.total,
    },
  });
}
```

이 decoupling 덕분에 주문 처리 로직은 SMTP 서버나 이메일 템플릿을 알 필요가 없습니다. 주문 도메인은 이벤트를 발행하고, 알림 계층은 그 이벤트를 사용자에게 전달하는 방식에 집중합니다.

## 15.10 Intentional Limitations

기초 패키지는 fluo의 **명시적 경계(Explicit Boundaries)** 철학을 따릅니다. 따라서 채널 선택과 transport 구성은 숨겨진 전역 상태가 아니라 모듈 설정과 provider 계약으로 드러납니다.

1. **기본 구현 또는 discovery 없음(No Default Implementations or Discovery)**: 내장된 email, Slack, Discord, queue, event-bus 구현을 제공하지 않고, provider decorator나 emitted metadata에서 channel을 discovery하지 않습니다. 이들은 전용 패키지나 애플리케이션 코드에 존재하며 명시적인 `NotificationChannel` 값으로 전달됩니다.
2. **암시적 환경 변수 없음(No Implicit Env)**: `process.env`를 읽지 않습니다. 모든 설정은 static option 또는 `forRootAsync(...)`를 통해 명시적으로 전달되어야 합니다.
3. **트랜스포트 불가지론(Transport Agnostic)**: queue와 event publication이 abstract seam이기 때문에 Node.js, Bun, Deno, Workers에서 작동합니다.
4. **리소스 소유 없음(No Resource Ownership)**: Status snapshot은 queue/event-bus integration을 externally managed로 보고하며, foundation 패키지는 해당 resource를 create/import/close/drain하지 않습니다.

이 제한은 기본 transport가 변경되더라도 orchestration 계층이 안정적으로 유지되도록 합니다. 확장이 필요할 때도 새 채널, queue adapter, event publisher를 같은 계약으로 추가하면 되므로 기존 호출부를 크게 바꿀 필요가 없습니다.

## 15.11 Public API Summary

### Module Registration
- `NotificationsModule.forRoot(options)`: static channel, optional queue/event seam, provider visibility를 등록합니다.
- `NotificationsModule.forRootAsync(options)`: `{ inject, useFactory, global? }`를 통해 DI에서 module option을 해석합니다.

### Services and Tokens
- `NotificationsService`: `dispatch(...)`, `dispatchMany(...)`, `createPlatformStatusSnapshot()`을 위한 기본 API.
- `NOTIFICATIONS`: `dispatch(...)`와 `dispatchMany(...)`를 노출하는 compatibility facade token.
- `NOTIFICATION_CHANNELS`: 정규화된 channel list를 위한 token.

### Dispatch and Channel Contracts
- `NotificationChannel`: 새로운 delivery Provider를 위한 계약.
- `NotificationDispatchRequest`: dispatch 시도를 위한 스키마.
- `NotificationDispatchOptions`: queue preference, abort signal, lifecycle publication을 위한 단건 dispatch control.
- `NotificationDispatchManyOptions`: `continueOnError`를 포함한 batch control.
- `NotificationDispatchResult`: 직접 또는 queued notification 하나에 대한 정규화된 결과.
- `NotificationDispatchBatchResult`: `dispatchMany(...)`가 반환하는 요약.
- `NotificationDispatchFailure`: tolerant batch operation이 반환하는 실패 entry.

### Queue, Events, Status, and Errors
- `NotificationsQueueAdapter`, `NotificationsQueueJob`, `NotificationsQueueOptions`: abstract queue seam과 job contract.
- `NotificationsEventPublisher`, `NotificationsEventsOptions`, `NotificationLifecycleEvent`, `NotificationLifecycleEventName`: lifecycle publication seam과 event contract.
- `NotificationsModuleOptions`, `NotificationsAsyncModuleOptions`: static/async module option contract.
- `createNotificationsPlatformStatusSnapshot(...)`, `NotificationsPlatformStatusSnapshot`, `NotificationsStatusAdapterInput`: status snapshot helper와 타입.
- `NotificationsConfigurationError`, `NotificationChannelNotFoundError`, `NotificationQueueNotConfiguredError`: 구성, channel lookup, queue misconfiguration error.

## Conclusion

오케스트레이션 계층은 fluo 메시징 전략의 중심입니다. dispatch 로직을 중앙에 모으면 관측 가능성, 탄력성, batch visibility, 명확한 관심사 분리를 얻을 수 있습니다. FluoShop에서는 이 구조가 사용자 알림과 운영 알림을 같은 모델로 다루는 기반이 됩니다. 다음 장에서는 가장 일반적인 알림 채널인 **이메일(Email)**을 구현합니다.
