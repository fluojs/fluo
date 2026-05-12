# @fluojs/notifications

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 채널 중립(notification channel-agnostic) 알림 오케스트레이션 패키지입니다. 알림 채널의 공통 계약을 고정하고, Nest-like 모듈 API를 제공하며, 선택적인 큐 기반 전달 심(seam)과 라이프사이클 이벤트 발행 심을 노출합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [일반적인 패턴](#일반적인-패턴)
  - [큐 기반 대량 전달](#큐-기반-대량-전달)
  - [이벤트 발행자를 통한 라이프사이클 발행](#이벤트-발행자를-통한-라이프사이클-발행)
  - [의도적인 제한 사항](#의도적인-제한-사항)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/notifications
```

## 사용 시점

- 여러 알림 채널에 대해 하나의 공통 dispatch 계약을 두고, sibling 패키지끼리 직접 결합되지 않게 하고 싶을 때.
- 애플리케이션 코드가 provider SDK나 전송 구현 세부사항 대신 `NotificationsService`에 의존해야 할 때.
- 대량 전달은 큐로 넘길 수 있어야 하지만, 기본 경로는 여전히 인프로세스 직접 전달이어야 할 때.
- 알림 라이프사이클 이벤트(requested, queued, delivered, failed)를 별도의 이벤트 발행 심으로 관찰하고 싶을 때.

## 빠른 시작

### 1. foundation 모듈 등록

알림 모듈 등록은 `NotificationsModule.forRoot(...)` 또는 `NotificationsModule.forRootAsync(...)`로 구성합니다.

```typescript
import { Module } from '@fluojs/core';
import {
  NotificationsModule,
  type NotificationChannel,
} from '@fluojs/notifications';

const emailChannel: NotificationChannel = {
  channel: 'email',
  async send(notification) {
    console.log('email 전송', notification.subject, notification.payload);

    return {
      externalId: 'email-123',
      metadata: { provider: 'demo-email' },
    };
  },
};

@Module({
  imports: [
    NotificationsModule.forRoot({
      channels: [emailChannel],
    }),
  ],
})
export class AppModule {}
```

### 2. `NotificationsService` 주입

```typescript
import { Inject } from '@fluojs/core';
import { NotificationsService } from '@fluojs/notifications';

@Inject(NotificationsService)
export class WelcomeService {
  constructor(private readonly notifications: NotificationsService) {}

  async sendWelcomeEmail(userId: string, email: string) {
    await this.notifications.dispatch({
      channel: 'email',
      recipients: [email],
      subject: 'fluo에 오신 것을 환영합니다',
      payload: {
        template: 'welcome-email',
        userId,
      },
    });
  }
}
```

`NotificationsModule.forRoot(...)`와 `NotificationsModule.forRootAsync(...)`는 `NotificationsService`, `NOTIFICATIONS`, `NOTIFICATION_CHANNELS`를 global provider로 export합니다. 애플리케이션 서비스는 fluo의 class-level `@Inject(...)` decorator로 의존성을 선언해야 standard-decorator DI container가 parameter decorator 없이 서비스를 resolve할 수 있습니다.

## 일반적인 패턴

### 큐 기반 대량 전달

많은 알림을 백그라운드 워커로 넘기고 싶다면 선택적인 queue seam을 사용합니다.

```typescript
NotificationsModule.forRoot({
  channels: [emailChannel],
  queue: {
    adapter: {
      async enqueue(job) {
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

Behavioral contract 메모:

- 알림 개수가 `bulkThreshold` 이상이면 대량 큐 위임이 시작됩니다.
- `dispatch()`는 queue adapter가 구성되어 있어도 기본적으로 직접 전달을 유지합니다. 단건 알림을 큐로 보내려면 `dispatch(..., { queue: true })`를 사용합니다.
- queue adapter가 있어도 직접 전달을 강제하려면 `dispatch(..., { queue: false })`를 사용합니다.
- 큐 기반 전달은 단건 dispatch에서는 opt-in이고, `dispatchMany(...)`에서는 threshold 기반으로 동작합니다.
- Queue job에는 `notification.id`가 있으면 그 값을, 없으면 notification envelope에서 파생한 deterministic `id` idempotency key가 포함됩니다. Queue adapter는 deduplication을 지원하는 backing queue에 이 값을 전달해야 합니다.
- `dispatchMany(..., { continueOnError: true })`는 direct delivery 또는 순차 queue fallback enqueue에서 첫 실패를 던지는 대신 실패들을 수집합니다.
- queue enqueue가 실패하면 서비스는 enqueue 에러를 다시 던지기 전에 결정적인 `notification.dispatch.failed` 라이프사이클 이벤트를 발행합니다. queued bulk dispatch는 queue 미구성, channel 해석, provider/adapter failure 경로를 포함해 이미 `requested`를 발행한 모든 notification에 대해 terminal `queued` 또는 `failed` 이벤트도 발행합니다.
- `enqueueMany(...)`가 없으면 대량 queue delivery는 input order대로 각 job을 개별 enqueue하는 방식으로 fallback합니다. `continueOnError: true`이면 성공한 enqueue는 `results`에 남고 실패한 enqueue는 `failures`로 반환됩니다. 그렇지 않으면 첫 enqueue failure를 다시 던지기 전에 아직 terminal 상태가 없는 나머지 requested fallback job에 `failed` 라이프사이클 이벤트를 발행합니다.
- foundation 패키지는 특정 큐 구현을 가정하거나 import하지 않습니다.

### 이벤트 발행자를 통한 라이프사이클 발행

foundation 패키지를 `@fluojs/event-bus` 구현에 직접 결합하지 않고도 caller-visible 라이프사이클 이벤트를 발행할 수 있습니다.

```typescript
NotificationsModule.forRoot({
  channels: [emailChannel],
  events: {
    publishLifecycleEvents: true,
    publisher: {
      async publish(event) {
        await eventBus.publish(event);
      },
    },
  },
});
```

발행되는 이벤트 이름:

- `notification.dispatch.requested`
- `notification.dispatch.queued`
- `notification.dispatch.delivered`
- `notification.dispatch.failed`

`events.publisher`가 구성되어 있으면 `publishLifecycleEvents: false`를 설정하지 않는 한 lifecycle event publication은 기본으로 켜집니다. 채널 delivery가 `externalId`를 생략하면 시간이나 난수에 의존하지 않고 notification envelope에서 파생한 deterministic fallback delivery id가 부여되어 dispatch result가 호출자에게 안정적으로 유지됩니다. 채널 해석 실패는 `NotificationChannelNotFoundError`를 던지기 전에 `requested` 이후 `failed` 이벤트를 발행하며, 이는 영구적인 구성 오류로 취급해야 합니다. Queue enqueue와 provider delivery 실패도 `failed` 이벤트를 발행하지만, retry 여부는 underlying adapter/provider error를 기준으로 분류해야 합니다. 성공 경로 lifecycle event의 publication failure는 이미 전달된 알림을 애플리케이션 실패로 바꾸지 않도록 best-effort로 유지됩니다. `notification.dispatch.failed` publication failure는 원래 dispatch error와 publisher error를 모두 포함하는 `AggregateError`로 호출자에게 드러나므로 failed-event 보장이 조용히 약해지지 않습니다.

### 의도적인 제한 사항

foundation 패키지는 의도적으로 다음을 **포함하지 않습니다**:

- 내장 email, Slack, Discord 구현
- 직접적인 `process.env` 접근
- `@fluojs/queue` 또는 `@fluojs/event-bus`의 concrete runtime 타입 의존성
- provider별 payload 의미를 공유 계약에 인코딩하는 것

이 제한 사항은 leaf 패키지가 하나의 안정적인 오케스트레이션 계층 위에서 독립적으로 진화할 수 있도록 하는 package contract의 일부입니다.

## 공개 API 개요

### 핵심

- `NotificationsModule.forRoot(options)` / `NotificationsModule.forRootAsync(options)`
- `NotificationsService`
- `NotificationsService.createPlatformStatusSnapshot()`
- `Notifications`
- `NOTIFICATIONS`
- `NOTIFICATION_CHANNELS`

### 계약(Contracts)

- `NotificationDispatchRequest`
- `NotificationDispatchOptions`
- `NotificationDispatchManyOptions`
- `NotificationDispatchResult`
- `NotificationDispatchBatchResult`
- `NotificationDispatchFailure`
- `NotificationDispatchStatus`
- `NotificationChannel`
- `NotificationChannelContext`
- `NotificationChannelDelivery`
- `NotificationPayload`
- `NotificationsQueueAdapter`
- `NotificationsQueueJob`
- `NotificationsQueueOptions`
- `NotificationsModuleOptions`
- `NotificationsAsyncModuleOptions`
- `NotificationsEventsOptions`
- `NotificationsEventPublisher`
- `NotificationLifecycleEvent`
- `NotificationLifecycleEventName`

### 상태 및 에러

- `createNotificationsPlatformStatusSnapshot(...)`
- `NotificationsPlatformStatusSnapshot`
- `NotificationsStatusAdapterInput`
- `NotificationsConfigurationError`
- `NotificationChannelNotFoundError`
- `NotificationQueueNotConfiguredError`

상태 snapshot은 platform diagnostics를 위해 `operationMode`, dependency diagnostics, ownership, readiness, health 필드를 포함합니다.

## 관련 패키지

- `@fluojs/queue`: 대량 알림 전달을 백그라운드에서 처리하려는 경우 권장됩니다.
- `@fluojs/event-bus`: 알림 라이프사이클 이벤트를 애플리케이션 전반에 발행하려는 경우 권장됩니다.
- `@fluojs/config`: 환경 직접 접근 없이 `forRootAsync()`로 provider 설정을 전달하려는 경우 권장됩니다.

## 예제 소스

- `packages/notifications/src/module.test.ts`: 모듈 등록, async wiring, queue seam, tolerant bulk dispatch 예제.
- `packages/notifications/src/public-surface.test.ts`: 루트 export와 TypeScript-only 타입에 대한 공개 계약 검증 예제.
- `packages/notifications/src/status.test.ts`: health/readiness 계약 예제.
