# @konekti/email

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti를 위한 transport-agnostic 이메일 코어 패키지입니다. Nest-like 모듈 API, standalone 사용을 위한 주입 가능한 `EmailService`, 그리고 특정 런타임 transport를 내장하지 않는 `@konekti/notifications` 연동용 1st-party channel/queue adapter를 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [일반적인 패턴](#일반적인-패턴)
  - [`EmailService`를 이용한 standalone 전달](#emailservice를-이용한-standalone-전달)
  - [`@konekti/notifications`와의 통합](#konektinotifications와의-통합)
  - [큐 기반 대량 전달](#큐-기반-대량-전달)
  - [의도적인 제한 사항](#의도적인-제한-사항)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @konekti/email @konekti/notifications @konekti/queue
```

내장 notifications queue adapter와 worker가 필요할 때만 `@konekti/queue`를 함께 설치하면 됩니다.

Node 전용 SMTP/Nodemailer 전달이 필요하다면 그 관심사는 공유 패키지 경계 밖에 두어야 합니다. 전용 adapter 작업은 별도 이슈 [#918](https://github.com/konektijs/konekti/issues/918)에서 추적합니다.

## 사용 시점

- 이메일을 직접 보내는 기능과 `@konekti/notifications` 채널 연동을 한 패키지에서 처리하고 싶을 때.
- transport 선택을 Node, Bun, Deno, Cloudflare 호환 애플리케이션 경계 전반에서 명시적이고 이식 가능하게 유지해야 할 때.
- 이메일 transport 리소스가 애플리케이션 bootstrap/shutdown 수명 주기에 참여해야 하지만 코어 패키지가 특정 런타임을 가정하면 안 될 때.
- 대량 알림 이메일을 요청 경로에서 직접 보내지 않고 `@konekti/queue`로 넘기고 싶을 때.

## 빠른 시작

### 모듈 등록

```typescript
import { Module } from '@konekti/core';
import { EmailModule, type EmailTransport } from '@konekti/email';

class ExampleTransport implements EmailTransport {
  async send(message) {
    return {
      accepted: message.to.map((entry) => entry.address),
      messageId: crypto.randomUUID(),
      pending: [],
      rejected: [],
    };
  }
}

@Module({
  imports: [
    EmailModule.forRoot({
      defaultFrom: 'noreply@example.com',
      transport: {
        kind: 'example-http-transport',
        create: async () => new ExampleTransport(),
      },
    }),
  ],
})
export class AppModule {}
```

### 직접 이메일 보내기

```typescript
import { Inject } from '@konekti/core';
import { EmailService } from '@konekti/email';

export class WelcomeService {
  constructor(@Inject([EmailService]) private readonly email: EmailService) {}

  async sendWelcome(address: string) {
    await this.email.send({
      to: [address],
      subject: 'Konekti에 오신 것을 환영합니다',
      text: '계정 준비가 완료되었습니다.',
    });
  }
}
```

## 일반적인 패턴

### `EmailService`를 이용한 standalone 전달

notifications foundation을 거치지 않고 직접 이메일 전달을 하고 싶다면 `EmailService`를 사용합니다.

```typescript
EmailModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config) => ({
    defaultFrom: config.mail.from,
    transport: {
      kind: config.mail.transportKind,
      create: () => config.mail.transport,
      ownsResources: false,
    },
  }),
});
```

Behavioral contract 메모:

- `EmailService.send(...)`는 전달 전에 `defaultFrom`과 `defaultReplyTo`를 해석합니다.
- 서비스는 모듈 bootstrap 시 transport를 초기화하고, factory가 소유한 리소스만 애플리케이션 shutdown 시 닫습니다.
- 이 패키지는 절대로 `process.env`를 직접 읽지 않습니다. 모든 설정은 명시적인 옵션 또는 DI를 통해 들어와야 합니다.

### `@konekti/notifications`와의 통합

`EMAIL_CHANNEL`을 `NotificationsModule.forRootAsync(...)`에 주입하여, 이메일 전용 payload 필드와 template rendering 규칙이 모두 `@konekti/email` 안에만 남도록 구성합니다.

```typescript
import { Module } from '@konekti/core';
import { EmailModule, EMAIL_CHANNEL } from '@konekti/email';
import { NotificationsModule } from '@konekti/notifications';

@Module({
  imports: [
    EmailModule.forRoot({
      defaultFrom: 'noreply@example.com',
      transport: {
        kind: 'transactional-http',
        create: () => transactionalTransport,
        ownsResources: false,
      },
    }),
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

지원하는 notification payload 필드:

- `to`, `cc`, `bcc`, `from`, `replyTo`
- `text`, `html`, `attachments`, `headers`
- 모듈에 renderer가 구성된 경우 `templateData`

### 큐 기반 대량 전달

`@konekti/notifications`가 대량 이메일 전달을 백그라운드로 넘겨야 한다면 `QueueLifecycleService`를 주입해 `createEmailNotificationsQueueAdapter(queue)`를 만들고 `QueueModule`을 함께 import합니다.

```typescript
import { Module } from '@konekti/core';
import {
  EmailModule,
  EMAIL_CHANNEL,
  createEmailNotificationsQueueAdapter,
} from '@konekti/email';
import { NotificationsModule } from '@konekti/notifications';
import { QueueLifecycleService, QueueModule } from '@konekti/queue';

@Module({
  imports: [
    QueueModule.forRoot(),
    EmailModule.forRoot({
      defaultFrom: 'noreply@example.com',
      transport: {
        kind: 'bulk-email-api',
        create: () => bulkEmailTransport,
        ownsResources: false,
      },
    }),
    NotificationsModule.forRootAsync({
      inject: [EMAIL_CHANNEL, QueueLifecycleService],
      useFactory: (channel, queue) => ({
        channels: [channel],
        queue: {
          adapter: createEmailNotificationsQueueAdapter(queue),
          bulkThreshold: 25,
        },
      }),
    }),
  ],
})
export class AppModule {}
```

내장 queue worker 계약의 기본값은 다음과 같습니다:

- `attempts: 3`
- `backoff: { type: 'exponential', delayMs: 1000 }`
- `concurrency: 5`
- `rateLimiter: { max: 50, duration: 1000 }`
- `jobName: 'konekti.email.notification'`

이 기본값은 `DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS`로 export되므로, 호출 측에서 커스텀 queue adapter/worker를 만들 때 동일한 계약을 문서화하거나 반영할 수 있습니다.

### 의도적인 제한 사항

email 패키지는 의도적으로 다음을 **포함하지 않습니다**:

- `process.env`에서 transport 자격 증명을 직접 읽는 동작
- 공유 루트 패키지에 내장된 SMTP 또는 Nodemailer transport 제공
- `QueueModule` 자동 설정
- provider 전용 옵션 타입을 `@konekti/notifications`에 누출하는 것

이 제한 사항은 transport 선택, 템플릿 전략, 큐 도입 여부가 애플리케이션 경계에서 명시적으로 결정되도록 하기 위한 package contract의 일부입니다.

## 공개 API 개요

### 핵심

- `EmailModule.forRoot(options)` / `EmailModule.forRootAsync(options)`
- `createEmailProviders(options)`
- `EmailService`
- `EmailChannel`
- `EMAIL`
- `EMAIL_CHANNEL`

### 계약과 헬퍼

- `EmailMessage`
- `EmailTransport`
- `EmailTransportFactory`
- `EmailTemplateRenderer`
- `createEmailNotificationsQueueAdapter(queue)`
- `DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS`

### 상태 및 에러

- `createEmailPlatformStatusSnapshot(...)`
- `EmailConfigurationError`
- `EmailMessageValidationError`

## 관련 패키지

- `@konekti/notifications`: `EMAIL_CHANNEL`을 소비하는 공통 오케스트레이션 계층입니다.
- `@konekti/queue`: 대량 이메일 전달을 백그라운드에서 처리하려는 경우 권장됩니다.
- `@konekti/config`: 환경 직접 접근 없이 transport 자격 증명과 sender 기본값을 해석하려는 경우 권장됩니다.
- `#918`: 향후 Nodemailer/SMTP 전달을 위한 Node 전용 `@konekti/email/node` adapter를 추적합니다.

## 예제 소스

- `packages/email/src/module.test.ts`: 모듈 등록, async wiring, lifecycle, queue-backed notifications 예제.
- `packages/email/src/public-surface.test.ts`: 공개 export와 TypeScript 계약 검증 예제.
- `packages/email/src/status.test.ts`: health/readiness 계약 예제.
