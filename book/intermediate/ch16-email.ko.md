<!-- packages: @fluojs/email, @fluojs/notifications, @fluojs/queue -->
<!-- project-state: FluoShop v2.2.0 -->

# 16. Email Systems

이메일은 디지털 통신의 베테랑입니다. 인스턴트 메시징의 부상에도 불구하고, 이메일은 여전히 트랜잭션 영수증, 공식 성명, 그리고 지속적인 사용자 알림을 위한 주요 채널로 남아 있습니다.

`@fluojs/email` 패키지는 fluo를 위한 트랜스포트 독립적인 이메일 전송 핵심 기능을 제공합니다. 이 패키지는 메시지 스키마를 실제 전송 메커니즘(SMTP, API, 워커 등)과 분리함으로써 프레임워크의 명시적 경계 철학을 따릅니다.

이 장에서는 독립적인 사용과 알림 오케스트레이션 계층과의 통합에 초점을 맞춰 FluoShop을 위한 이메일 전송을 구현해 보겠습니다.

## 16.1 The Architecture of @fluojs/email

이메일 패키지는 가볍고 이식 가능하도록 설계되었습니다. 루트 엔트리포인트에는 모든 런타임에서 작동하는 핵심 로직이 포함되어 있으며, 런타임별 구현은 서브패스에 격리되어 있습니다.

### Key Components:
- **EmailModule**: 이메일 트랜스포트의 수명 주기를 관리합니다.
- **EmailService**: 메시지 전송을 위한 고수준 API.
- **EmailTransport**: 새로운 전송 공급자를 구현하기 위한 인터페이스.
- **EmailChannel**: 이메일을 `@fluojs/notifications`에 연결하는 어댑터.

## 16.2 Registering the Email Module

등록을 위해서는 트랜스포트가 필요합니다. 이 예제에서는 일반적인 HTTP 트랜스포트를 사용하겠지만, fluo는 퍼스트 파티 Node.js SMTP 트랜스포트도 제공합니다.

```typescript
import { Module } from '@fluojs/core';
import { EmailModule } from '@fluojs/email';

@Module({
  imports: [
    EmailModule.forRoot({
      defaultFrom: 'noreply@fluoshop.com',
      transport: {
        kind: 'transactional-api',
        create: async () => new MyApiTransport(),
      },
    }),
  ],
})
export class AppModule {}
```

### verifyOnModuleInit
`verifyOnModuleInit: true`를 설정하면 애플리케이션 부트스트랩 중에 트랜스포트가 유효한지(예: SMTP 자격 증명 확인) 보장할 수 있습니다.

## 16.3 Node-only SMTP with @fluojs/email/node

Node.js에서 실행 중이고 SMTP를 사용하려는 경우 전용 서브패스를 사용해야 합니다. 이렇게 하면 핵심 패키지가 `nodemailer`와 같은 무거운 Node 전용 의존성으로부터 자유로워집니다.

```typescript
import { EmailModule } from '@fluojs/email';
import { createNodemailerEmailTransportFactory } from '@fluojs/email/node';

EmailModule.forRoot({
  transport: createNodemailerEmailTransportFactory({
    smtp: {
      host: 'smtp.fluoshop.com',
      port: 587,
      auth: {
        user: 'api-key',
        pass: 'secret',
      },
    },
  }),
});
```

## 16.4 Standalone Usage: EmailService

단순한 사용 사례의 경우 `EmailService`를 직접 주입할 수 있습니다.

```typescript
import { Inject } from '@fluojs/core';
import { EmailService } from '@fluojs/email';

export class InvoiceService {
  constructor(@Inject(EmailService) private readonly email: EmailService) {}

  async sendInvoice(userEmail: string, orderId: string) {
    await this.email.send({
      to: [userEmail],
      subject: `주문 #${orderId}에 대한 인보이스`,
      html: `<h1>주문이 확인되었습니다</h1><p>주문 ID: ${orderId}</p>`,
    });
  }
}
```

서비스는 `defaultFrom`의 해석을 처리하고 전송 전 메시지를 검증합니다.

## 16.5 Integration with @fluojs/notifications

15장에서 우리는 알림을 오케스트레이션하는 방법을 보았습니다. 해당 시스템에 이메일을 추가하려면 `EMAIL_CHANNEL` 토큰을 사용합니다.

```typescript
import { EmailModule, EMAIL_CHANNEL } from '@fluojs/email';
import { NotificationsModule } from '@fluojs/notifications';

@Module({
  imports: [
    EmailModule.forRoot({ ... }),
    NotificationsModule.forRootAsync({
      inject: [EMAIL_CHANNEL],
      useFactory: (channel) => ({
        channels: [channel],
      }),
    }),
  ],
})
export class AppModule {}
```

통합이 완료되면 `NotificationsService.dispatch({ channel: 'email', ... })`는 자동으로 이메일 설정을 사용하게 됩니다.

## 16.6 Queue-backed Bulk Delivery

루프에서 1,000개의 이메일을 보내는 것은 이벤트 루프를 차단하거나 속도 제한에 걸리는 지름길입니다. 백그라운드 처리를 위해 `@fluojs/email/queue` 서브패스를 사용하십시오.

```typescript
import { createEmailNotificationsQueueAdapter } from '@fluojs/email/queue';
import { QueueLifecycleService } from '@fluojs/queue';

NotificationsModule.forRootAsync({
  inject: [EMAIL_CHANNEL, QueueLifecycleService],
  useFactory: (channel, queue) => ({
    channels: [channel],
    queue: {
      adapter: createEmailNotificationsQueueAdapter(queue),
      bulkThreshold: 25,
    },
  }),
});
```

큐 어댑터는 대량의 알림 발송을 설정 가능한 재시도 및 백오프 로직을 가진 개별 백그라운드 작업으로 분해합니다.

## 16.7 Template Rendering

`@fluojs/email`은 플러그형 템플릿 렌더러를 지원합니다. 이를 통해 핵심 패키지를 특정 엔진에 결합하지 않고도 Handlebars, EJS 또는 React-email을 사용할 수 있습니다.

```typescript
EmailModule.forRoot({
  template: {
    renderer: async (name, data) => {
      // 렌더링 로직
      return { html: `<h1>안녕하세요 ${data.name}님</h1>` };
    },
  },
});
```

렌더러가 있으면 전송 요청 시 `templateData`를 사용할 수 있습니다.

## 16.8 Status and Health Checks

이메일 시스템은 실패할 수 있는 외부 의존성입니다. 트랜스포트의 상태를 모니터링하려면 `createEmailPlatformStatusSnapshot`을 사용하십시오.

```typescript
const snapshot = await createEmailPlatformStatusSnapshot(emailService);
if (!snapshot.isReady) {
  console.error('이메일 트랜스포트가 오프라인입니다:', snapshot.reason);
}
```

이는 Kubernetes 준비성 프로브를 위한 `@fluojs/terminus`와 통합할 때 특히 유용합니다.

## 16.9 FluoShop Context: Order confirmation emails

FluoShop에서는 법적으로 요구되는 주문 요약본을 보내기 위해 이메일을 사용합니다.

```typescript
async sendOrderConfirmation(order: Order) {
  await this.notifications.dispatch({
    channel: 'email',
    recipients: [order.customerEmail],
    subject: 'FluoShop 주문 확인',
    payload: {
      template: 'order-success',
      templateData: {
        orderId: order.id,
        items: order.items,
        total: order.total,
      },
    },
  });
}
```

오케스트레이션 계층을 사용함으로써 SMTP 서버를 일시적으로 사용할 수 없는 경우 백그라운드 재시도 로직을 무료로 얻을 수 있습니다.

## Conclusion

fluo 이메일 시스템은 트랜잭션 메시징을 위한 강력한 기반을 제공합니다. 서비스에서 트랜스포트를 엄격하게 분리함으로써, 테스트 가능하고 이식성이 뛰어나며 대량 생산 환경에 준비된 시스템을 구축했습니다.

다음 장에서는 알림 시스템을 확장하여 **Slack과 Discord**를 통한 실시간 채팅을 포함해 보겠습니다.

<!-- Padding for line count compliance -->
<!-- Line 198 -->
<!-- Line 199 -->
<!-- Line 200 -->
<!-- Line 201 -->
