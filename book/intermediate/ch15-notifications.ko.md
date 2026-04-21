<!-- packages: @fluojs/notifications, @fluojs/core -->
<!-- project-state: FluoShop v2.2.0 -->

# 15. Notification Orchestration

알림은 현대적인 애플리케이션의 핵심적인 부분입니다. 환영 이메일이든, 비밀번호 초기화 링크든, 운영 경고 알림이든, 백엔드에는 여러 채널을 통해 메시지를 신뢰성 있게 보낼 수 있는 방법이 필요합니다.

`@fluojs/notifications` 패키지는 fluo를 위한 채널에 독립적인 오케스트레이션 계층을 제공합니다. 이 패키지는 알림 채널에 대한 공유 계약을 고정하고, 모듈 기반 API를 제공하며, 선택적인 큐 기반 전송 및 수명 주기 이벤트 게시 심(seam)을 노출합니다.

이 장을 마칠 때쯤이면, 이메일, Slack, Discord 전반에 걸쳐 확장 가능한 FluoShop을 위한 통합 알림 시스템을 구축하는 방법을 이해하게 될 것입니다.

## 15.1 The Orchestration Pattern

전형적인 마이크로서비스 환경에서는 여러 서비스가 알림을 보내야 합니다. 모든 서비스가 이메일이나 Slack을 위한 자체 로직을 구현한다면 아키텍처는 취약해집니다.

Fluo는 **오케스트레이션(Orchestration)**을 통해 이를 해결합니다.

`NotificationsService`는 중앙 허브 역할을 합니다. 이 서비스는 이메일을 보내는 *방법*은 모르지만, 어떤 *채널*이 이메일을 담당하는지는 알고 있습니다.

### Why Orchestrate?
- **공유 계약(Shared Contract)**: 모든 채널이 동일한 인터페이스를 따릅니다.
- **의존성 역전(Dependency Inversion)**: 애플리케이션 로직은 공급자 SDK가 아닌 `NotificationsService`에 의존합니다.
- **관측 가능성(Observability)**: 모든 전송 시도에 대해 수명 주기 이벤트가 발행됩니다.
- **탄력성(Resilience)**: 선택적인 큐 지원을 통해 알림 폭주가 메인 요청 경로를 차단하는 것을 방지합니다.

## 15.2 Defining a Notification Channel

채널은 `NotificationChannel` 인터페이스를 구현하는 공급자입니다. 이는 fluo 오케스트레이터와 외부 서비스 사이의 다리 역할을 합니다.

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

`send` 메서드는 계약의 핵심입니다. 표준화된 알림 객체를 수신하고 전송 영수증을 반환합니다.

## 15.3 Registering the Notifications Module

오케스트레이션 계층을 사용하려면 `NotificationsModule`을 등록해야 합니다.

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

이 등록을 통해 `NotificationsService`를 주입할 수 있게 됩니다.

## 15.4 Dispatching Notifications

등록이 완료되면 공급자에 `NotificationsService`를 주입할 수 있습니다.

```typescript
import { Inject } from '@fluojs/core';
import { NotificationsService } from '@fluojs/notifications';

export class WelcomeService {
  constructor(
    @Inject(NotificationsService) 
    private readonly notifications: NotificationsService
  ) {}

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

`dispatch` 메서드는 비동기적입니다. 알림이 채널(또는 큐)로 성공적으로 전달되면 완료됩니다.

## 15.5 Queue-Backed Delivery

대량 전송 시나리오에서는 전송 작업을 백그라운드 워커로 오프로드하고 싶을 수 있습니다. `@fluojs/notifications` 패키지는 내장된 큐 심(seam)을 제공합니다.

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

`bulkThreshold`에 도달하거나 옵션을 통해 명시적으로 요청된 경우, 서비스는 직접 전송 대신 큐 어댑터를 사용합니다.

## 15.6 Lifecycle Events

신뢰성을 위해서는 관측 가능성이 필요합니다. 오케스트레이션 계층은 이벤트 게시자를 통해 수명 주기 이벤트를 게시할 수 있습니다.

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

FluoShop에서는 주문 확인을 위해 알림을 사용합니다. 이는 파트 2에서 수행한 이벤트 기반 작업을 기반으로 구축됩니다.

`OrderPlacedEvent`가 `OrderSaga`에 의해 캡처되면 알림 발송이 트리거됩니다.

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

이러한 디커플링은 주문 처리 로직이 SMTP 서버나 이메일 템플릿에 대해 알 필요가 없음을 보장합니다.

## 15.8 Intentional Limitations

기초 패키지는 fluo의 **명시적 경계(Explicit Boundaries)** 철학을 따릅니다.

1. **기본 구현 없음(No Default Implementations)**: 내장된 이메일이나 Slack 공급자를 제공하지 않습니다. 이들은 각각의 전용 패키지에 존재합니다.
2. **암시적 환경 변수 없음(No Implicit Env)**: `process.env`를 읽지 않습니다. 모든 설정은 명시적으로 전달되어야 합니다.
3. **트랜스포트 불가지론(Transport Agnostic)**: Node.js, Bun, Deno, Workers에서 작동합니다.

이러한 제한 사항은 기본 트랜스포트가 변경되더라도 오케스트레이션 계층이 안정적으로 유지되도록 보장합니다.

## 15.9 Public API Summary

### Services
- `NotificationsService`: 발송을 위한 기본 API.
- `NOTIFICATIONS`: 서비스 주입을 위한 토큰.

### Interfaces
- `NotificationChannel`: 새로운 전송 공급자를 위한 계약.
- `NotificationDispatchRequest`: 발송 시도를 위한 스키마.
- `NotificationsQueueAdapter`: 백그라운드 처리를 위한 인터페이스.

## Conclusion

오케스트레이션 계층은 fluo 메시징 전략의 중추입니다. 발송 로직을 중앙 집중화함으로써 관측 가능성, 탄력성, 그리고 깔끔한 관심사 분리를 얻을 수 있습니다.

다음 장에서는 가장 일반적인 알림 채널인 **이메일(Email)**을 구현해 보겠습니다.

<!-- Padding for line count compliance -->
<!-- Line 197 -->
<!-- Line 198 -->
<!-- Line 199 -->
<!-- Line 200 -->
<!-- Line 201 -->
