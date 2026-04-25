<!-- packages: @fluojs/notifications, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 15. Notification Orchestration

이 장은 FluoShop의 여러 이벤트와 업무 흐름 위에 채널 독립적인 notification orchestration 계층을 세우는 방법을 설명합니다. Chapter 14에서 실시간 상호작용을 다뤘다면, 이제는 이메일, Slack, Discord 같은 후속 전달 채널을 하나의 명시적인 dispatch boundary로 묶습니다.

## Learning Objectives
- notification orchestration이 채널별 SDK 호출을 직접 흩뿌리는 방식보다 왜 안전한지 이해합니다.
- `NotificationChannel` 계약과 `NotificationsService`의 역할을 구분해 설명합니다.
- `NotificationsModule.forRoot()`로 채널과 dispatch 구성을 등록하는 방법을 익힙니다.
- queue-backed delivery가 대량 전송을 request path 밖으로 분리하는 이유를 분석합니다.
- lifecycle event 발행이 알림 관측성과 실패 추적에 어떻게 기여하는지 정리합니다.
- FluoShop order success flow에서 notification dispatch가 어떤 후속 책임을 맡는지 설명합니다.

## Prerequisites
- Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8, Chapter 9, Chapter 10, Chapter 11, Chapter 12, Chapter 13, Chapter 14 완료.
- event-driven 후속 처리와 channel-based delivery 개념에 대한 기초 이해.
- queue와 observability를 활용한 비동기 전송 운영 감각.

## 15.1 The Orchestration Pattern

전형적인 마이크로서비스 환경에서는 여러 서비스가 알림을 보내야 합니다. 모든 서비스가 이메일이나 Slack을 위한 자체 로직을 구현하면 아키텍처는 취약해집니다. fluo는 **오케스트레이션(Orchestration)**을 통해 이 문제를 다루며, `NotificationsService`를 중앙 허브로 둡니다. 이 서비스는 이메일을 보내는 *방법*은 모르지만, 어떤 *채널*이 이메일을 담당하는지는 알고 있습니다. 덕분에 업무 로직은 채널별 SDK 대신 하나의 명시적인 dispatch 계약에 의존할 수 있습니다.

### Why Orchestrate?
- **공유 계약(Shared Contract)**: 모든 채널이 동일한 인터페이스를 따릅니다.
- **의존성 역전(Dependency Inversion)**: 애플리케이션 로직은 공급자 SDK가 아닌 `NotificationsService`에 의존합니다.
- **관측 가능성(Observability)**: 모든 전송 시도에 대해 수명 주기 이벤트가 발행됩니다.
- **탄력성(Resilience)**: 선택적인 큐 지원을 통해 알림 폭주가 메인 요청 경로를 막지 않게 합니다.

## 15.2 Defining a Notification Channel

채널은 `NotificationChannel` 인터페이스를 구현하는 공급자입니다. 이는 fluo orchestrator와 외부 서비스 사이의 다리 역할을 하며, 각 채널이 서로 다른 전송 방식을 쓰더라도 애플리케이션에는 같은 모양의 계약을 제공합니다.

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

`send` 메서드는 계약의 핵심입니다. 표준화된 알림 객체를 받고 전송 영수증을 반환하므로, 호출자는 Slack, 이메일, Discord 같은 채널별 세부 응답을 직접 해석하지 않아도 됩니다.

## 15.3 Registering the Notifications Module

오케스트레이션 계층을 사용하려면 `NotificationsModule`을 등록해야 합니다. 이 등록은 사용할 채널과 dispatch 동작을 애플리케이션 시작 시점에 한곳에서 고정하는 역할을 합니다.

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

이 등록 이후 `NotificationsService`를 주입할 수 있습니다. 서비스는 등록된 채널 목록을 기준으로 요청된 알림을 적절한 transport나 queue 경계로 넘깁니다.

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

`dispatch` 메서드는 비동기적입니다. 알림이 채널 또는 큐로 성공적으로 전달되면 완료되며, 실제 외부 전송이 queue 뒤에서 처리되는 경우에도 호출부는 같은 계약을 사용합니다.

## 15.5 Queue-Backed Delivery

대량 전송 시나리오에서는 전송 작업을 background worker로 offload해야 할 수 있습니다. `@fluojs/notifications` 패키지는 내장된 queue seam을 제공합니다.

```typescript
NotificationsModule.forRoot({
  channels: [emailChannel],
  queue: {
    adapter: {
      async enqueue(job) {
        // @fluojs/queue와의 통합
        return queue.enqueue(job);
      },
      async enqueueMany(jobs) {
        return Promise.all(jobs.map(j => queue.enqueue(j)));
      },
    },
    bulkThreshold: 50,
  },
});
```

`bulkThreshold`에 도달하거나 옵션을 통해 명시적으로 요청된 경우, service는 직접 전송 대신 queue adapter를 사용합니다.

## 15.6 Lifecycle Events

신뢰성을 위해서는 관측 가능성이 필요합니다. 오케스트레이션 계층은 event publisher를 통해 lifecycle event를 발행할 수 있습니다. 전송 시작, 성공, 실패가 이벤트로 남으면 운영자는 알림 누락을 더 빨리 추적할 수 있고, 재시도 정책도 같은 흐름에 연결할 수 있습니다.

```typescript
NotificationsModule.forRoot({
  channels: [emailChannel],
  events: {
    publishLifecycleEvents: true,
    publisher: {
      async publish(event) {
        // @fluojs/event-bus와의 통합
        await eventBus.publish(event);
      },
    },
  },
});
```

### Published Events:
- `notification.dispatch.requested`: `dispatch()`가 호출되었을 때.
- `notification.dispatch.queued`: 알림이 백그라운드 큐로 이동했을 때.
- `notification.dispatch.delivered`: 채널이 성공적인 전송을 확인했을 때.
- `notification.dispatch.failed`: 재시도 후에도 전송이 실패했을 때.

## 15.7 FluoShop Context: Order Success Flow

FluoShop은 주문 확인을 위해 알림을 사용합니다. 이는 Part 2에서 구축한 event-driven 작업 위에 놓입니다. `OrderPlacedEvent`가 `OrderSaga`에 의해 포착되면 알림 dispatch가 트리거되고, 주문 처리와 사용자 알림은 느슨하게 연결된 후속 책임으로 분리됩니다.

```typescript
@OnEvent('order.placed')
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

## 15.8 Intentional Limitations

기초 패키지는 fluo의 **명시적 경계(Explicit Boundaries)** 철학을 따릅니다. 따라서 채널 선택과 transport 구성은 숨겨진 전역 상태가 아니라 모듈 설정과 provider 계약으로 드러납니다.

1. **기본 구현 없음(No Default Implementations)**: 내장된 이메일이나 Slack 공급자를 제공하지 않습니다. 이들은 각각의 전용 패키지에 존재합니다.
2. **암시적 환경 변수 없음(No Implicit Env)**: `process.env`를 읽지 않습니다. 모든 설정은 명시적으로 전달되어야 합니다.
3. **트랜스포트 불가지론(Transport Agnostic)**: Node.js, Bun, Deno, Workers에서 작동합니다.

이 제한은 기본 transport가 변경되더라도 orchestration 계층이 안정적으로 유지되도록 합니다. 확장이 필요할 때도 새 채널이나 transport를 같은 계약으로 추가하면 되므로 기존 호출부를 크게 바꿀 필요가 없습니다.

## 15.9 Public API Summary

### Services
- `NotificationsService`: 발송을 위한 기본 API.
- `NOTIFICATIONS`: 서비스 주입을 위한 토큰.

### Interfaces
- `NotificationChannel`: 새로운 전송 공급자를 위한 계약.
- `NotificationDispatchRequest`: 발송 시도를 위한 스키마.
- `NotificationsQueueAdapter`: 백그라운드 처리를 위한 인터페이스.

## Conclusion

오케스트레이션 계층은 fluo 메시징 전략의 중심입니다. dispatch 로직을 중앙에 모으면 관측 가능성, 탄력성, 명확한 관심사 분리를 얻을 수 있습니다. FluoShop에서는 이 구조가 사용자 알림과 운영 알림을 같은 모델로 다루는 기반이 됩니다. 다음 장에서는 가장 일반적인 알림 채널인 **이메일(Email)**을 구현합니다.
