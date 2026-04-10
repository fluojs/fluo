# @fluojs/discord

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 webhook-first, transport-agnostic Discord 전달 코어 패키지입니다. Nest-like 모듈 API, standalone 사용을 위한 주입 가능한 `DiscordService`, 그리고 Node 전용 Discord SDK를 가정하지 않는 `@fluojs/notifications` 연동용 1st-party `DiscordChannel`을 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [일반적인 패턴](#일반적인-패턴)
  - [`DiscordService`를 이용한 standalone 전달](#discordservice를-이용한-standalone-전달)
  - [`@fluojs/notifications`와의 통합](#fluojs-notifications와의-통합)
  - [명시적 fetch 주입을 사용하는 webhook-first 전달](#명시적-fetch-주입을-사용하는-webhook-first-전달)
  - [의도적인 제한 사항](#의도적인-제한-사항)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/discord @fluojs/notifications
```

## 사용 시점

- Discord 메시지를 직접 보내는 기능과 `@fluojs/notifications` 채널 연동을 한 패키지에서 처리하고 싶을 때.
- transport 선택을 Node, Bun, Deno, Cloudflare 호환 애플리케이션 경계 전반에서 명시적이고 이식 가능하게 유지해야 할 때.
- incoming webhook을 기본 경로로 선호하되, 더 풍부한 REST 또는 bot 기반 연동은 커스텀 transport 계약으로 열어 두고 싶을 때.
- 설정을 패키지 내부 `process.env` 접근이 아니라 DI 또는 명시적인 옵션으로 주입하고 싶을 때.

## 빠른 시작

### 모듈 등록

```typescript
import { Module } from '@fluojs/core';
import { DiscordModule, createDiscordWebhookTransport } from '@fluojs/discord';

@Module({
  imports: [
    DiscordModule.forRoot({
      defaultThreadId: 'release-thread-id',
      transport: createDiscordWebhookTransport({
        fetch: globalThis.fetch.bind(globalThis),
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      }),
    }),
  ],
})
export class AppModule {}
```

### 직접 Discord 메시지 보내기

```typescript
import { Inject } from '@fluojs/core';
import { DiscordService } from '@fluojs/discord';

export class DeployNotifier {
  constructor(@Inject(DiscordService) private readonly discord: DiscordService) {}

  async announce(version: string) {
    await this.discord.send({
      content: `Deploy ${version} finished successfully.`,
    });
  }
}
```

## 일반적인 패턴

### `DiscordService`를 이용한 standalone 전달

notifications foundation을 거치지 않고 직접 Discord 전달을 하고 싶다면 `DiscordService`를 사용합니다.

```typescript
DiscordModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config) => ({
    defaultThreadId: config.discord.defaultThreadId,
    transport: createDiscordWebhookTransport({
      fetch: config.runtime.fetch,
      webhookUrl: config.discord.webhookUrl,
    }),
  }),
});
```

Behavioral contract 메모:

- `DiscordService.send(...)`는 전달 전에 `defaultThreadId`를 해석합니다.
- 서비스는 모듈 bootstrap 시 transport를 초기화하고, factory가 소유한 리소스만 애플리케이션 shutdown 시 닫습니다.
- 이 패키지는 절대로 `process.env`를 직접 읽지 않습니다. 모든 설정은 명시적인 옵션 또는 DI를 통해 들어와야 합니다.

### `@fluojs/notifications`와의 통합

`DISCORD_CHANNEL`을 `NotificationsModule.forRootAsync(...)`에 주입하여, Discord 전용 payload 필드와 recipient-to-thread 해석 규칙이 모두 `@fluojs/discord` 안에만 남도록 구성합니다.

```typescript
import { Module } from '@fluojs/core';
import { NotificationsModule } from '@fluojs/notifications';
import {
  DISCORD_CHANNEL,
  DiscordModule,
  createDiscordWebhookTransport,
} from '@fluojs/discord';

@Module({
  imports: [
    DiscordModule.forRoot({
      transport: createDiscordWebhookTransport({
        fetch: globalThis.fetch.bind(globalThis),
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      }),
    }),
    NotificationsModule.forRootAsync({
      inject: [DISCORD_CHANNEL],
      useFactory: (channel) => ({
        channels: [channel],
      }),
    }),
  ],
})
export class AppModule {}
```

지원하는 notification payload 필드:

- `content`, `embeds`, `components`, `attachments`
- `allowedMentions`, `username`, `avatarUrl`, `tts`
- `threadId`, `threadName`, `flags`, `poll`, `metadata`

Behavioral contract 메모:

- 하나의 notification dispatch는 정확히 하나의 Discord thread 경로로 매핑됩니다. `payload.threadId` 또는 `recipients`의 단일 항목을 사용해야 합니다.
- `payload.threadId`가 없으면 `DiscordService.sendNotification(...)`는 첫 번째 `recipients` 항목을 사용하고, 그것도 없으면 `defaultThreadId`로 폴백합니다.
- 여러 Discord thread로 fan-out이 필요하다면 하나의 multi-recipient dispatch 대신 `dispatchMany(...)`를 사용해야 합니다.

### 명시적 fetch 주입을 사용하는 webhook-first 전달

런타임에 독립적인 1st-party transport가 필요하다면 fetch-compatible HTTP 경계만 의존하는 `createDiscordWebhookTransport(...)`를 사용합니다.

```typescript
const transport = createDiscordWebhookTransport({
  fetch: runtime.fetch,
  webhookUrl: discordWebhookUrl,
});

await discord.send({
  content: 'Deploy finished',
  embeds: [{ description: 'Build 124 succeeded.' }],
});
```

bot 기반 REST 전달처럼 더 풍부한 API 연동이 필요하다면 export된 `DiscordTransport` 계약을 구현해 `DiscordModule.forRoot(...)` 또는 `forRootAsync(...)`에 주입하면 됩니다.

### 의도적인 제한 사항

Discord 패키지는 의도적으로 다음을 **포함하지 않습니다**:

- 자격 증명이나 webhook URL을 `process.env`에서 직접 읽는 동작
- 공유 루트 패키지 경계에 Node 전용 Discord SDK를 내장하는 것
- webhook helper와 export된 transport 계약 이상으로 하나의 provider 전략을 강제하는 것
- 하나의 dispatch 호출 안에서 multi-thread fan-out을 자동 변환하는 것

이 제한 사항은 런타임 선택, provider capability, rollout 전략이 애플리케이션 경계에서 명시적으로 결정되도록 하기 위한 package contract의 일부입니다.

## 공개 API 개요

### 핵심

- `DiscordModule.forRoot(options)` / `DiscordModule.forRootAsync(options)`
- `createDiscordProviders(options)`
- `DiscordService`
- `DiscordChannel`
- `DISCORD`
- `DISCORD_CHANNEL`

### 계약과 헬퍼

- `DiscordMessage`
- `DiscordTransport`
- `DiscordTransportFactory`
- `DiscordTemplateRenderer`
- `createDiscordWebhookTransport(options)`

### 상태 및 에러

- `createDiscordPlatformStatusSnapshot(...)`
- `DiscordConfigurationError`
- `DiscordMessageValidationError`
- `DiscordTransportError`

## 관련 패키지

- `@fluojs/notifications`: `DISCORD_CHANNEL`을 소비하는 공통 오케스트레이션 계층입니다.
- `@fluojs/config`: 환경 직접 접근 없이 webhook URL이나 thread id를 해석하려는 경우 권장됩니다.
- `@fluojs/event-bus`: Discord 알림이 여러 이벤트 기반 부작용 중 하나일 때 유용합니다.

## 예제 소스

- `packages/discord/src/module.test.ts`: 모듈 등록, async wiring, webhook transport, notifications integration 예제.
- `packages/discord/src/public-surface.test.ts`: 공개 export와 TypeScript 계약 검증 예제.
- `packages/discord/src/status.test.ts`: health/readiness 계약 예제.
