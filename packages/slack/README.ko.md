# @fluojs/slack

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 webhook-first, transport-agnostic Slack 전달 코어 패키지입니다. Nest-like 모듈 API, standalone 사용을 위한 주입 가능한 `SlackService`, 그리고 Node 전용 SDK를 가정하지 않는 `@fluojs/notifications` 연동용 1st-party `SlackChannel`을 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [일반적인 패턴](#일반적인-패턴)
  - [`SlackService`를 이용한 standalone 전달](#slackservice를-이용한-standalone-전달)
  - [`@fluojs/notifications`와의 통합](#fluojs-notifications와의-통합)
  - [명시적 fetch 주입을 사용하는 webhook-first 전달](#명시적-fetch-주입을-사용하는-webhook-first-전달)
  - [의도적인 제한 사항](#의도적인-제한-사항)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/slack @fluojs/notifications
```

## 사용 시점

- Slack 메시지를 직접 보내는 기능과 `@fluojs/notifications` 채널 연동을 한 패키지에서 처리하고 싶을 때.
- transport 선택을 Node, Bun, Deno, Cloudflare 호환 애플리케이션 경계 전반에서 명시적이고 이식 가능하게 유지해야 할 때.
- incoming webhook을 기본 경로로 선호하되, 더 풍부한 API 연동은 커스텀 transport 계약으로 열어 두고 싶을 때.
- 설정을 패키지 내부 `process.env` 접근이 아니라 DI 또는 명시적인 옵션으로 주입하고 싶을 때.

## 빠른 시작

### 모듈 등록

```typescript
import { Module } from '@fluojs/core';
import { SlackModule, createSlackWebhookTransport } from '@fluojs/slack';

@Module({
  imports: [
    SlackModule.forRoot({
      defaultChannel: '#ops',
      transport: createSlackWebhookTransport({
        fetch: globalThis.fetch.bind(globalThis),
        webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX',
      }),
    }),
  ],
})
export class AppModule {}
```

### 직접 Slack 메시지 보내기

```typescript
import { Inject } from '@fluojs/core';
import { SlackService } from '@fluojs/slack';

export class DeployNotifier {
  constructor(@Inject(SlackService) private readonly slack: SlackService) {}

  async announce(version: string) {
    await this.slack.send({
      text: `Deploy ${version} finished successfully.`,
    });
  }
}
```

## 일반적인 패턴

### `SlackService`를 이용한 standalone 전달

notifications foundation을 거치지 않고 직접 Slack 전달을 하고 싶다면 `SlackService`를 사용합니다.

```typescript
SlackModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config) => ({
    defaultChannel: config.slack.defaultChannel,
    transport: createSlackWebhookTransport({
      fetch: config.runtime.fetch,
      webhookUrl: config.slack.webhookUrl,
    }),
  }),
});
```

Behavioral contract 메모:

- `SlackService.send(...)`는 전달 전에 `defaultChannel`을 해석합니다.
- 서비스는 모듈 bootstrap 시 transport를 초기화하고, factory가 소유한 리소스만 애플리케이션 shutdown 시 닫습니다.
- 이 패키지는 절대로 `process.env`를 직접 읽지 않습니다. 모든 설정은 명시적인 옵션 또는 DI를 통해 들어와야 합니다.

### `@fluojs/notifications`와의 통합

`SLACK_CHANNEL`을 `NotificationsModule.forRootAsync(...)`에 주입하여, Slack 전용 payload 필드와 recipient-to-channel 해석 규칙이 모두 `@fluojs/slack` 안에만 남도록 구성합니다.

```typescript
import { Module } from '@fluojs/core';
import { NotificationsModule } from '@fluojs/notifications';
import {
  SLACK_CHANNEL,
  SlackModule,
  createSlackWebhookTransport,
} from '@fluojs/slack';

@Module({
  imports: [
    SlackModule.forRoot({
      transport: createSlackWebhookTransport({
        fetch: globalThis.fetch.bind(globalThis),
        webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX',
      }),
    }),
    NotificationsModule.forRootAsync({
      inject: [SLACK_CHANNEL],
      useFactory: (channel) => ({
        channels: [channel],
      }),
    }),
  ],
})
export class AppModule {}
```

지원하는 notification payload 필드:

- `text`, `blocks`, `attachments`
- `channel`, `threadTs`, `replyBroadcast`
- `username`, `iconEmoji`, `iconUrl`
- `mrkdwn`, `unfurlLinks`, `unfurlMedia`, `metadata`

Behavioral contract 메모:

- 하나의 notification dispatch는 정확히 하나의 Slack 대상지로 매핑됩니다. `payload.channel` 또는 `recipients`의 단일 항목을 사용해야 합니다.
- `payload.channel`이 없으면 `SlackService.sendNotification(...)`는 첫 번째 `recipients` 항목을 사용하고, 그것도 없으면 `defaultChannel`로 폴백합니다.
- 여러 Slack 대상지로 fan-out이 필요하다면 하나의 multi-recipient dispatch 대신 `sendMany(...)`를 사용해야 합니다.

### 명시적 fetch 주입을 사용하는 webhook-first 전달

런타임에 독립적인 1st-party transport가 필요하다면 fetch-compatible HTTP 경계만 의존하는 `createSlackWebhookTransport(...)`를 사용합니다.

```typescript
const transport = createSlackWebhookTransport({
  fetch: runtime.fetch,
  webhookUrl: slackWebhookUrl,
});

await slack.send({
  blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Deploy finished*' } }],
  text: 'Deploy finished',
});
```

`chat.postMessage` 같은 더 풍부한 API 연동이 필요하다면 export된 `SlackTransport` 계약을 구현해 `SlackModule.forRoot(...)` 또는 `forRootAsync(...)`에 주입하면 됩니다.

Behavioral contract 메모:

- 내장 webhook transport는 `408`, `429`, `5xx` 같은 일시적 실패를 호출자에게 에러를 노출하기 전에 bounded exponential backoff로 재시도합니다.
- 호출자에게 보이는 `SlackTransportError` 메시지는 기본적으로 raw upstream response body를 포함하지 않습니다.

### 의도적인 제한 사항

Slack 패키지는 의도적으로 다음을 **포함하지 않습니다**:

- 자격 증명이나 webhook URL을 `process.env`에서 직접 읽는 동작
- 공유 루트 패키지 경계에 Node 전용 Slack SDK를 내장하는 것
- webhook helper와 export된 transport 계약 이상으로 하나의 provider 전략을 강제하는 것
- 하나의 dispatch 호출 안에서 multi-channel fan-out을 자동 변환하는 것

이 제한 사항은 런타임 선택, provider capability, rollout 전략이 애플리케이션 경계에서 명시적으로 결정되도록 하기 위한 package contract의 일부입니다.

## 공개 API 개요

### 핵심

- `SlackModule.forRoot(options)` / `SlackModule.forRootAsync(options)`
- `createSlackProviders(options)`
- `SlackService`
- `SlackChannel`
- `SLACK`
- `SLACK_CHANNEL`

### 계약과 헬퍼

- `SlackMessage`
- `SlackTransport`
- `SlackTransportFactory`
- `SlackTemplateRenderer`
- `createSlackWebhookTransport(options)`

### 상태 및 에러

- `createSlackPlatformStatusSnapshot(...)`
- `SlackConfigurationError`
- `SlackMessageValidationError`
- `SlackTransportError`

## 관련 패키지

- `@fluojs/notifications`: `SLACK_CHANNEL`을 소비하는 공통 오케스트레이션 계층입니다.
- `@fluojs/config`: 환경 직접 접근 없이 webhook URL이나 토큰을 해석하려는 경우 권장됩니다.
- `@fluojs/event-bus`: Slack 알림이 여러 이벤트 기반 부작용 중 하나일 때 유용합니다.

## 예제 소스

- `packages/slack/src/module.test.ts`: 모듈 등록, async wiring, webhook transport, notifications integration 예제.
- `packages/slack/src/public-surface.test.ts`: 공개 export와 TypeScript 계약 검증 예제.
- `packages/slack/src/status.test.ts`: health/readiness 계약 예제.
