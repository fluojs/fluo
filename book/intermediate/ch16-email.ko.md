<!-- packages: @fluojs/email, @fluojs/notifications, @fluojs/queue -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 16. Email Systems

이 장에서는 FluoShop의 알림 흐름에 이메일 채널을 안정적으로 연결하는 방식을 다룹니다. Chapter 15에서 채널 오케스트레이션의 뼈대를 세웠다면, 여기서는 트랜잭션 메일 전송, 트랜스포트 경계, 운영 점검 지점을 구체화합니다.

## Learning Objectives
- `@fluojs/email` 패키지의 핵심 구성 요소와 책임을 구분합니다.
- EmailModule 등록 방식과 전송 트랜스포트 구성 절차를 정리합니다.
- Node 전용 SMTP 서브패스가 필요한 경계와 이점을 파악합니다.
- `EmailService`를 사용해 독립적인 이메일 발송 흐름을 구성합니다.
- 알림 오케스트레이션에 이메일 채널을 연결하는 방식을 확인합니다.
- 대량 발송, 템플릿 렌더링, 상태 점검을 운영 기준으로 다룹니다.

## Prerequisites
- Chapter 15 완료.
- 비동기 작업 처리와 큐 기반 백그라운드 실행 흐름에 대한 이해.
- 이메일 트랜스포트와 외부 전송 서비스 연동에 대한 기본 경험.

## 16.1 The Architecture of @fluojs/email

이메일 패키지는 가볍고 런타임 이식성을 해치지 않도록 구성되어 있습니다. 루트 엔트리포인트에는 공통 런타임에서 동작하는 핵심 로직만 두고, 런타임별 구현은 서브패스로 분리합니다.

### Key Components:
- **EmailModule**: 이메일 트랜스포트의 수명 주기를 관리합니다.
- **EmailService**: 메시지 전송을 담당하는 고수준 API입니다.
- **EmailTransport**: 새 전송 공급자를 붙일 때 구현하는 인터페이스입니다.
- **EmailChannel**: 이메일을 `@fluojs/notifications`에 연결하는 어댑터입니다.

## 16.2 Registering the Email Module

모듈을 등록하려면 먼저 트랜스포트를 결정해야 합니다. 아래 예제는 일반적인 HTTP 기반 트랜스포트를 사용하지만, fluo는 Node.js SMTP용 퍼스트 파티 트랜스포트도 별도로 제공합니다.

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
`verifyOnModuleInit: true`를 설정하면 애플리케이션 부트스트랩 중 트랜스포트가 실제로 사용 가능한지 확인할 수 있습니다. SMTP 자격 증명 검증처럼 배포 초기에 실패를 드러내야 하는 경우에 유용합니다. 이렇게 시작 단계에서 문제를 확인하면 첫 주문 확인 메일이 실패한 뒤에야 설정 오류를 발견하는 상황을 줄일 수 있습니다.

## 16.3 Node-only SMTP with @fluojs/email/node

Node.js 환경에서 SMTP를 사용할 때는 전용 서브패스를 가져옵니다. 이렇게 분리하면 핵심 패키지가 `nodemailer` 같은 Node 전용 의존성에 묶이지 않고, 다른 런타임에서도 같은 루트 API를 유지할 수 있습니다.

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

알림 오케스트레이션까지 필요하지 않은 단순한 흐름에서는 `EmailService`를 직접 주입해 사용할 수 있습니다. 이 방식은 내부 테스트 메일, 운영 점검 메일처럼 하나의 채널만 명확히 필요한 경우에 잘 맞습니다.

```typescript
import { Inject } from '@fluojs/core';
import { EmailService } from '@fluojs/email';

@Inject(EmailService)
export class InvoiceService {
  constructor(private readonly email: EmailService) {}

  async sendInvoice(userEmail: string, orderId: string) {
    await this.email.send({
      to: [userEmail],
      subject: `주문 #${orderId}에 대한 인보이스`,
      html: `<h1>주문이 확인되었습니다</h1><p>주문 ID: ${orderId}</p>`,
    });
  }
}
```

서비스는 `defaultFrom` 적용과 전송 전 메시지 검증을 담당합니다. 호출부는 수신자, 제목, 본문처럼 비즈니스 이벤트에 필요한 값에 집중하면 됩니다. 그 결과 메일 전송 규칙은 서비스 경계에 모이고, 도메인 코드는 전달할 의미에 더 가까워집니다.

## 16.5 Integration with @fluojs/notifications

Chapter 15에서 구성한 알림 오케스트레이션에 이메일을 추가하려면 `EMAIL_CHANNEL` 토큰을 주입합니다. 이렇게 하면 이메일은 독립 서비스로도 사용할 수 있고, 같은 구현을 알림 채널로도 재사용할 수 있습니다.

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

통합 후 `NotificationsService.dispatch({ channel: 'email', ... })` 호출은 등록된 이메일 설정과 트랜스포트를 그대로 사용합니다. 호출부는 SMTP인지 HTTP API인지 구분하지 않고, 알림 정책만 표현하면 됩니다.

## 16.6 Queue-backed Bulk Delivery

루프 안에서 이메일 1,000개를 직접 보내면 이벤트 루프를 오래 점유하거나 공급자 속도 제한에 걸리기 쉽습니다. 대량 발송은 `@fluojs/email/queue` 서브패스로 백그라운드 작업에 넘기는 편이 안전합니다.

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

큐 어댑터는 대량 알림을 개별 백그라운드 작업으로 나누고, 각 작업에 설정 가능한 재시도와 백오프 정책을 적용합니다.

## 16.7 Template Rendering

`@fluojs/email`은 교체 가능한 템플릿 렌더러를 지원합니다. 핵심 패키지를 특정 엔진에 묶지 않으면서 Handlebars, EJS, React-email 같은 렌더링 방식을 선택할 수 있습니다.

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

렌더러를 등록하면 전송 요청에서 `templateData`를 넘겨 템플릿 기반 메일을 생성할 수 있습니다.

## 16.8 Status and Health Checks

이메일 시스템은 네트워크, 인증, 공급자 장애의 영향을 받는 외부 의존성입니다. 트랜스포트 상태를 운영 지표로 확인하려면 `createEmailPlatformStatusSnapshot`을 사용합니다.

```typescript
const snapshot = await createEmailPlatformStatusSnapshot(emailService);
if (!snapshot.isReady) {
  console.error('이메일 트랜스포트가 오프라인입니다:', snapshot.reason);
}
```

이 스냅샷은 Kubernetes 준비성 프로브나 `@fluojs/terminus` 기반 헬스 체크에 연결할 때 특히 실용적입니다.

## 16.9 FluoShop Context: Order confirmation emails

FluoShop에서는 주문 확인과 법적 보관이 필요한 주문 요약본 전송에 이메일을 사용합니다. 사용자가 나중에 주문 내용을 다시 확인해야 하는 경우가 많기 때문에, 이메일은 실시간 알림과 다른 지속적인 전달 채널 역할을 합니다.

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

오케스트레이션 계층을 거치면 SMTP 서버나 외부 공급자가 잠시 불안정해도 백그라운드 재시도 정책을 일관되게 적용할 수 있습니다. 주문 처리와 메일 전송 실패 대응이 분리되므로, 사용자의 결제 흐름을 불필요하게 지연시키지 않습니다.

## Conclusion

fluo 이메일 시스템은 트랜잭션 메시징을 위한 명확한 기반을 제공합니다. 서비스와 트랜스포트를 분리하면 테스트가 쉬워지고, 런타임 이식성을 유지하며, 대량 발송 운영에도 대응할 수 있습니다. FluoShop에서는 이 구조가 주문 확인, 운영 점검, 사용자 안내 메일을 같은 계약으로 다루게 해줍니다. 다음 장에서는 알림 시스템을 **Slack과 Discord**까지 확장해 팀 채팅 기반 운영 흐름을 다룹니다.
