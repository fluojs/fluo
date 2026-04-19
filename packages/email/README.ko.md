# @fluojs/email

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 transport-agnostic 이메일 코어 패키지입니다. Nest-like 모듈 API, standalone 사용을 위한 주입 가능한 `EmailService`, 그리고 특정 런타임 transport를 내장하지 않는 `@fluojs/notifications` 연동용 1st-party channel/queue adapter를 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [일반적인 패턴](#일반적인-패턴)
  - [`@fluojs/email/node`를 이용한 Node 전용 SMTP](#fluojs-email-node를-이용한-node-전용-smtp)
  - [`EmailService`를 이용한 standalone 전달](#emailservice를-이용한-standalone-전달)
  - [`@fluojs/notifications`와의 통합](#fluojs-notifications와의-통합)
  - [큐 기반 대량 전달](#큐-기반-대량-전달)
  - [의도적인 제한 사항](#의도적인-제한-사항)
- [공개 API 개요](#공개-api-개요)
- [런타임 전용 및 통합 서브패스](#런타임-전용-및-통합-서브패스)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/email
```

내장 notifications 채널과 queue worker 연동이 필요할 때만 `@fluojs/notifications`, `@fluojs/queue`를 함께 설치하면 됩니다.

```bash
npm install @fluojs/notifications @fluojs/queue
```

명시적인 `@fluojs/email/node` 서브패스로 Node 전용 SMTP 전달을 사용할 때만 `nodemailer`를 설치하면 됩니다.

```bash
npm install @fluojs/email nodemailer
```

Node 전용 SMTP 전달은 이제 명시적인 `@fluojs/email/node` 서브패스에 위치합니다. queue 기반 notifications 통합도 `@fluojs/email/queue` 서브패스로 분리되었고, 이 서브패스용 `@fluojs/queue`는 루트 설치 필수가 아닌 optional peer로 선언됩니다. 루트 `@fluojs/email` 엔트리포인트는 계속 transport-agnostic 상태를 유지하므로 Bun, Deno, Cloudflare, 커스텀 HTTP transport가 Node 전용 또는 queue 전용 동작을 함께 끌어오지 않습니다.

## 사용 시점

- 이메일을 직접 보내는 기능과 `@fluojs/notifications` 채널 연동을 한 패키지에서 처리하고 싶을 때.
- transport 선택을 Node, Bun, Deno, Cloudflare 호환 애플리케이션 경계 전반에서 명시적이고 이식 가능하게 유지해야 할 때.
- 이메일 transport 리소스가 애플리케이션 bootstrap/shutdown 수명 주기에 참여해야 하지만 코어 패키지가 특정 런타임을 가정하면 안 될 때.
- 대량 알림 이메일을 요청 경로에서 직접 보내지 않고 `@fluojs/queue`로 넘기고 싶을 때.

## 빠른 시작

### 모듈 등록

```typescript
import { Module } from '@fluojs/core';
import { EmailModule, type EmailTransport } from '@fluojs/email';

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
import { Inject } from '@fluojs/core';
import { EmailService } from '@fluojs/email';

export class WelcomeService {
  constructor(@Inject(EmailService) private readonly email: EmailService) {}

  async sendWelcome(address: string) {
    await this.email.send({
      to: [address],
      subject: 'fluo에 오신 것을 환영합니다',
      text: '계정 준비가 완료되었습니다.',
    });
  }
}
```

루트 `@fluojs/email` 공개 표면은 의도적으로 module-first입니다. 이메일 등록은 `EmailModule.forRoot(...)` 또는 `EmailModule.forRootAsync(...)`를 통해 수행해야 합니다.

## 일반적인 패턴

### `@fluojs/email/node`를 이용한 Node 전용 SMTP

런타임 이식 가능한 루트 패키지 계약을 약화시키지 않으면서 1st-party Nodemailer/SMTP 전달이 필요하다면 전용 Node 서브패스를 사용합니다.

```typescript
import { Module } from '@fluojs/core';
import { EmailModule } from '@fluojs/email';
import { createNodemailerEmailTransportFactory } from '@fluojs/email/node';

@Module({
  imports: [
    EmailModule.forRoot({
      defaultFrom: 'noreply@example.com',
      transport: createNodemailerEmailTransportFactory({
        smtp: {
          auth: {
            pass: 'smtp-password',
            user: 'smtp-user',
          },
          host: 'smtp.example.com',
          port: 587,
          secure: false,
        },
      }),
      verifyOnModuleInit: true,
    }),
  ],
})
export class AppModule {}
```

Behavioral contract 메모:

- `createNodemailerEmailTransportFactory(...)`는 Node 전용이며 `@fluojs/email/node`에서만 export됩니다.
- 이 factory는 자신이 생성한 Nodemailer transporter 리소스를 소유하므로 `EmailService`가 bootstrap 시 검증하고 shutdown 시 닫을 수 있습니다.
- `createNodemailerEmailTransport(...)`는 이미 존재하는 Nodemailer transporter를 감싸지만 리소스 소유권은 호출자에게 남깁니다.
- SMTP 자격 증명은 여전히 명시적인 옵션 또는 DI를 통해 들어와야 합니다. 루트 패키지와 Node 서브패스 모두 `process.env`를 직접 읽지 않습니다.

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
- `EmailService.send(...)`는 `accepted`, `pending`, `rejected` 수신자를 분리해 보존하므로 provider의 부분 실패가 호출자에게 그대로 보입니다.
- 서비스는 모듈 bootstrap 시 transport를 초기화하고, factory가 소유한 리소스만 애플리케이션 shutdown 시 닫습니다.
- 이 패키지는 절대로 `process.env`를 직접 읽지 않습니다. 모든 설정은 명시적인 옵션 또는 DI를 통해 들어와야 합니다.

### `@fluojs/notifications`와의 통합

`EMAIL_CHANNEL`을 `NotificationsModule.forRootAsync(...)`에 주입하여, 이메일 전용 payload 필드와 template rendering 규칙이 모두 `@fluojs/email` 안에만 남도록 구성합니다.

```typescript
import { Module } from '@fluojs/core';
import { EmailModule, EMAIL_CHANNEL } from '@fluojs/email';
import { NotificationsModule } from '@fluojs/notifications';

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

Behavioral contract 메모:

- `EmailChannel`은 `pending` 또는 `rejected` 수신자가 하나라도 있으면 전달을 성공으로 보고하지 않고 notification dispatch를 실패로 처리합니다.

### 큐 기반 대량 전달

`@fluojs/notifications`가 대량 이메일 전달을 백그라운드로 넘겨야 한다면 `QueueLifecycleService`를 주입해 `createEmailNotificationsQueueAdapter(queue)`를 만들고 `QueueModule`을 함께 import합니다.

```typescript
import { Module } from '@fluojs/core';
import {
  EmailModule,
  EMAIL_CHANNEL,
} from '@fluojs/email';
import { createEmailNotificationsQueueAdapter } from '@fluojs/email/queue';
import { NotificationsModule } from '@fluojs/notifications';
import { QueueLifecycleService, QueueModule } from '@fluojs/queue';

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
- `jobName: 'fluo.email.notification'`

이 기본값은 `@fluojs/email/queue`에서 `DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS`로 export되므로, 호출 측에서 커스텀 queue adapter/worker를 만들 때 동일한 계약을 문서화하거나 반영할 수 있습니다.

### 의도적인 제한 사항

email 패키지는 의도적으로 다음을 **포함하지 않습니다**:

- `process.env`에서 transport 자격 증명을 직접 읽는 동작
- 공유 루트 패키지에 내장된 SMTP 또는 Nodemailer transport 제공
- `QueueModule` 자동 설정
- provider 전용 옵션 타입을 `@fluojs/notifications`에 누출하는 것

이 제한 사항은 transport 선택, 템플릿 전략, 큐 도입 여부가 애플리케이션 경계에서 명시적으로 결정되도록 하기 위한 package contract의 일부입니다.

## 공개 API 개요

### 핵심

- `EmailModule.forRoot(options)` / `EmailModule.forRootAsync(options)`
- `EmailService`
- `EmailChannel`
- `EMAIL`
- `EMAIL_CHANNEL`

### 계약과 헬퍼

- `EmailMessage`
- `EmailTransport`
- `EmailTransportFactory`
- `EmailTemplateRenderer`

### 통합 서브패스

- `@fluojs/email/queue`: `createEmailNotificationsQueueAdapter(queue)`, `DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS`

### 상태 및 에러

- `createEmailPlatformStatusSnapshot(...)`
- `EmailConfigurationError`
- `EmailMessageValidationError`

### Node 전용 서브패스

- `createNodemailerEmailTransport(...)`
- `createNodemailerEmailTransportFactory(...)`
- `NodemailerEmailTransport`

## 런타임 전용 및 통합 서브패스

| 런타임 | 서브패스 | export |
| --- | --- | --- |
| Node.js | `@fluojs/email/node` | `createNodemailerEmailTransport(...)`, `createNodemailerEmailTransportFactory(...)`, `NodemailerEmailTransport` |

| 관심사 | 서브패스 | export |
| --- | --- | --- |
| queue 기반 notifications 통합 | `@fluojs/email/queue` | `createEmailNotificationsQueueAdapter(queue)`, `DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS` |

## 관련 패키지

- `@fluojs/notifications`: `EMAIL_CHANNEL`을 소비하는 공통 오케스트레이션 계층입니다.
- `@fluojs/queue`: 대량 이메일 전달을 백그라운드에서 처리하려는 경우 권장됩니다.
- `@fluojs/config`: 환경 직접 접근 없이 transport 자격 증명과 sender 기본값을 해석하려는 경우 권장됩니다.
- `nodemailer`: `@fluojs/email/node`가 소비하는 Node 전용 SMTP 구현체입니다.

## 예제 소스

- `packages/email/src/module.test.ts`: 모듈 등록, 옵션 정규화, async wiring, lifecycle, queue-backed notifications 예제.
- `packages/email/src/public-surface.test.ts`: 공개 export와 TypeScript 계약 검증 예제.
- `packages/email/src/node/node.test.ts`: Node 전용 Nodemailer adapter 매핑과 lifecycle 예제.
- `packages/email/src/status.test.ts`: health/readiness 계약 예제.
