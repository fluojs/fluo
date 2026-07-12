# @fluojs/discord

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 webhook-first, transport-agnostic Discord 전달 코어 패키지입니다. Nest-like 모듈 API, standalone 사용을 위한 주입 가능한 `DiscordService`, 그리고 Node 전용 Discord SDK를 가정하지 않는 `@fluojs/notifications` 연동용 1st-party `DiscordChannel`을 제공합니다.

마이그레이션 경계: 이 모듈 API는 의도적으로 Nest-like이지만 NestJS dynamic-module clone은 아닙니다. `DiscordModule`은 `global: options.global ?? true`로 기본 global이며, `forRootAsync(...)`는 `inject`와 `useFactory`만 지원하고, 내부 provider helper/token은 private으로 유지되어 애플리케이션은 module facade와 export된 service/channel token으로 Discord를 조합해야 합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [일반적인 패턴](#일반적인-패턴)
  - [모듈 visibility와 migration 경계](#모듈-visibility와-migration-경계)
  - [`DiscordService`를 이용한 standalone 전달](#discordservice를-이용한-standalone-전달)
  - [`verifyOnModuleInit` bootstrap verification](#verifyonmoduleinit-bootstrap-verification)
  - [`@fluojs/notifications`와의 통합](#fluojs-notifications와의-통합)
  - [payload override를 사용하는 template rendering](#payload-override를-사용하는-template-rendering)
  - [명시적 fetch 주입을 사용하는 webhook-first 전달](#명시적-fetch-주입을-사용하는-webhook-first-전달)
  - [의도적인 제한 사항](#의도적인-제한-사항)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/discord @fluojs/notifications
```

이 패키지는 published package metadata에 반영된 저장소 전반의 Node.js 20+ 설치 baseline을 따르지만, 런타임 전달 계약 자체는 명시적인 fetch-compatible 경계를 통해 계속 transport-agnostic하게 유지됩니다.

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

@Inject(DiscordService)
export class DeployNotifier {
  constructor(private readonly discord: DiscordService) {}

  async announce(version: string) {
    await this.discord.send({
      content: `Deploy ${version} finished successfully.`,
    });
  }
}
```

## 일반적인 패턴

### 모듈 visibility와 migration 경계

`DiscordModule.forRoot(...)`와 `DiscordModule.forRootAsync(...)`는 기본적으로 global module을 반환합니다. 이 모듈은 `DiscordService`, `DiscordChannel`, `DISCORD`, `DISCORD_CHANNEL`을 export합니다. 반환된 모듈을 명시적으로 import한 모듈에서만 이 provider들을 보이게 해야 하는 migrated code가 있을 때만 `global: false`를 전달하세요. 이 옵션은 NestJS `isGlobal`이 아니라 `global?: boolean`입니다.

패키지 수준 registration surface는 의도적으로 singleton 중심입니다. `DISCORD`와 `DISCORD_CHANNEL`은 하나의 구성된 Discord service와 notifications channel을 위한 compatibility token입니다. 여러 Discord client가 필요한 애플리케이션은 private provider helper를 import하지 말고 서로 다른 `DiscordTransport` 인스턴스를 감싼 app-owned module/provider 또는 app-owned facade를 구성해야 합니다.

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

`forRootAsync(...)`는 fluo async 형태만 받습니다. 필요한 의존성은 애플리케이션 module graph에 먼저 등록하고, token을 `inject`에 나열한 뒤, `useFactory`에서 최종 `DiscordModuleOptions`를 반환하세요. NestJS `imports`, `useClass`, `useExisting` 변형은 소비하지 않으므로 그런 패턴은 Discord에 option을 넘기기 전에 application-owned provider로 옮겨야 합니다.

Behavioral contract 메모:

- `DiscordModule.forRoot(...)`와 `DiscordModule.forRootAsync(...)`는 `DiscordService`, `DiscordChannel`, `DISCORD`, `DISCORD_CHANNEL`을 기본 global로 export합니다. fluo 옵션인 `global?: boolean`을 사용하고, migrated code가 Discord provider를 importing module 안에만 유지해야 할 때만 `global: false`를 설정하세요. NestJS `isGlobal`은 지원하지 않습니다.
- `DiscordService.send(...)`는 전달 전에 `defaultThreadId`를 해석합니다.
- `DiscordService.sendMany(...)`는 `DiscordMessage[]`를 직접 순차 전송하는 batch API이며 `continueOnError`를 지원합니다. 이는 multi-recipient `@fluojs/notifications` dispatch shortcut이 아닙니다.
- 서비스는 모듈 bootstrap 시 transport를 초기화하고, bootstrap verification 실패와 애플리케이션 shutdown 전반에서 factory-owned 리소스를 정확히 한 번 닫습니다. shutdown 전에 시작된 factory 생성 transport가 아직 완료되지 않았더라도 이를 기다리며, reject된 factory creation은 shutdown cleanup failure로 재분류되지 않고 initialization failure로 유지됩니다.
- send는 bootstrap이 transport를 `ready`로 표시한 뒤에만 허용됩니다. bootstrap 전, startup 중, bootstrap 실패 후, shutdown 중, shutdown 후 시도는 전달 전에 거부됩니다.
- 서비스가 shutdown 중이거나 이미 stopped 상태라면 cached transport를 재사용하지 않고 send를 거부합니다.
- `DiscordService.sendNotification(...)`은 구성된 renderer를 호출하기 전에 lifecycle readiness를 확인하고, 호출자의 `AbortSignal`을 `DiscordTemplateRenderInput.signal`과 transport delivery 양쪽에 전달합니다.
- `DiscordService.createPlatformStatusSnapshot()`은 `createDiscordPlatformStatusSnapshot(...)`과 같은 status 계약을 노출합니다. 여기에는 lifecycle/readiness, health, transport kind와 ownership, 기본 thread 구성, bootstrap verification 상태, bootstrap initialization 실패와 shutdown cleanup 실패를 구분하는 diagnostics, notifications channel dependency details가 포함되어, 호출자가 내부 옵션에 접근하지 않고도 Discord wiring을 관찰할 수 있습니다.
- 빈 `defaultThreadId`와 `notifications.channel` 값은 trim 후 무시됩니다. notifications channel은 기본적으로 `discord`입니다.
- 이 패키지는 절대로 `process.env`를 직접 읽지 않습니다. 모든 설정은 명시적인 옵션 또는 DI를 통해 들어와야 합니다.

### `verifyOnModuleInit` bootstrap verification

선택한 transport가 애플리케이션 bootstrap 중 자체 readiness를 검증할 수 있다면 `DiscordModuleOptions.verifyOnModuleInit?: boolean`을 `true`로 설정하세요. `DiscordService.onModuleInit()`은 항상 구성된 transport를 먼저 해석합니다. `verifyOnModuleInit`이 켜져 있고 해석된 transport가 optional `verify()` 메서드를 노출하면, 서비스는 Discord provider를 ready로 표시하기 전에 `transport.verify()`를 await합니다. `verify`를 구현하지 않은 transport도 유효하며 verification 단계를 건너뜁니다.

```typescript
DiscordModule.forRoot({
  transport: customDiscordTransport,
  verifyOnModuleInit: true,
});
```

Behavioral contract 메모:

- `verifyOnModuleInit`은 optional이며 기본값은 `false`입니다.
- Verification은 capability 기반입니다. `verify()`를 노출한 transport만 호출하므로 webhook-only 또는 app-owned transport가 no-op verifier를 추가할 필요는 없습니다.
- `transport.verify()`가 reject하면 bootstrap은 initialization failure로 실패하고, service lifecycle은 `failed`로 이동하며, readiness/status snapshot은 provider를 not ready로 보고합니다. Factory-owned transport는 정확히 한 번 닫고, 직접 전달된 app-owned transport는 보존합니다.
- `DiscordService.createPlatformStatusSnapshot()`은 `verifiedOnModuleInit`과 bootstrap verification 상태를 포함하므로 health/readiness tooling이 내부 옵션에 접근하지 않고도 bootstrap verification 요청 여부를 확인할 수 있습니다.

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
- notification metadata는 payload metadata, dispatch metadata, template/subject marker를 합쳐 구성됩니다. 중복 key에서는 dispatch metadata가 payload metadata를 덮어쓰고, 최종 `subject` / `template` marker가 둘 모두를 덮어씁니다. `template`은 renderer가 구성된 경우에만 렌더링됩니다.
- Template rendering은 서비스가 ready일 때만 시작합니다. Render input에는 `signal`이 포함되므로 renderer는 transport delivery 전에 caller-cancelled 작업을 중단할 수 있습니다.
- 여러 Discord thread로 fan-out이 필요한 notification workflow라면 thread별 concrete Discord message를 만들어 `DiscordService.sendMany(...)`로 보내거나 별도 notification dispatch를 실행해야 합니다. 하나의 notification dispatch는 multi-recipient fan-out을 암묵적으로 확장하지 않습니다.

### payload override를 사용하는 template rendering

Notification template에서 재사용 가능한 Discord content, embed, component를 생성하려면 `DiscordTemplateRenderer`를 등록합니다. 같은 module registration에 transport를 설정하고 `@fluojs/notifications`를 통해 `template` key를 dispatch하세요.

```typescript
import type { DiscordTemplateRenderer } from '@fluojs/discord';

const renderer: DiscordTemplateRenderer = {
  render(input) {
    return {
      content: `Order ${String(input.payload.orderId)} was received.`,
      embeds: [
        {
          description: input.subject,
          title: 'New order',
        },
      ],
    };
  },
};

DiscordModule.forRoot({
  renderer,
  transport: createDiscordWebhookTransport({
    fetch: runtime.fetch,
    webhookUrl: config.discordWebhookUrl,
  }),
});

await notifications.dispatch({
  channel: 'discord',
  locale: 'en',
  metadata: { source: 'orders' },
  payload: {
    content: 'Order #123 is ready for review.',
    orderId: '123',
  },
  subject: 'New order received',
  template: 'orders.received',
});
```

`DiscordService.sendNotification(...)`은 `template`과 `renderer`가 모두 있을 때만 renderer를 호출합니다. Renderer는 `{ template, payload, subject, locale, metadata, signal }`을 받습니다. 명시적인 `payload.content`, `payload.embeds`, `payload.components` 값은 대응하는 rendered 값보다 우선합니다. `payload.content`가 `undefined`이면 rendered content, `subject` 순서로 fallback합니다. 따라서 renderer나 transport 설정을 교체하지 않고도 호출자가 template 결과의 일부를 override할 수 있습니다.

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

Behavioral contract 메모:

- 내장 webhook transport는 `408`, `429`, `5xx` 같은 일시적 응답뿐 아니라 transport-level exception도 bounded exponential backoff로 재시도한 뒤 호출자에게 에러를 노출합니다. 영구적인 upstream 응답은 재시도하지 않습니다.
- Retry backoff는 `DiscordSendOptions.signal`을 관찰합니다. 이미 abort된 signal은 다음 backoff timer를 기다리지 않고 즉시 reject됩니다.
- 성공한 webhook 응답은 `DiscordSendResult.response`로 노출됩니다. rate-limit 재시도가 끝내 실패한 경우를 포함해, 호출자에게 보이는 `DiscordTransportError` 메시지는 기본적으로 raw upstream response body를 포함하지 않습니다.
- 잘못되었거나 절대 URL이 아닌 `webhookUrl` 값은 전달 실패로 재시도하지 않고 즉시 `DiscordConfigurationError`로 거부됩니다.

### 의도적인 제한 사항

Discord 패키지는 의도적으로 다음을 **포함하지 않습니다**:

- 자격 증명이나 webhook URL을 `process.env`에서 직접 읽는 동작
- 공유 루트 패키지 경계에 Node 전용 Discord SDK를 내장하는 것
- webhook helper와 export된 transport 계약 이상으로 하나의 provider 전략을 강제하는 것
- 애플리케이션 import용 내부 provider helper, normalized option token, 또는 NestJS-style custom provider replacement seam을 노출하는 것
- 하나의 dispatch 호출 안에서 multi-thread fan-out을 자동 변환하는 것

이 제한 사항은 런타임 선택, provider capability, rollout 전략이 애플리케이션 경계에서 명시적으로 결정되도록 하기 위한 package contract의 일부입니다.

## 공개 API 개요

### 핵심

- `Discord`
- `DiscordModule.forRoot(options)` / `DiscordModule.forRootAsync(options)`
- `DiscordModuleOptions`
- `DiscordAsyncModuleOptions`
- `DiscordService`
- `DiscordService.send(message, options)`
- `DiscordService.sendMany(messages, options)`
- `DiscordService.sendNotification(notification, options)`
- `DiscordService.createPlatformStatusSnapshot()`
- `DiscordChannel`
- `DISCORD`
- `DISCORD_CHANNEL`

애플리케이션 구성은 `DiscordModule`로, notifications 연동은 `DISCORD_CHANNEL`과 export된 transport 계약으로 조합합니다.

이 패키지는 `createDiscordProviders(...)`, `DISCORD_OPTIONS`, `NormalizedDiscordModuleOptions`를 public root barrel에 의도적으로 노출하지 않습니다. 기존 migration이 NestJS 내부 provider token이나 custom provider seam을 바꾸고 있었다면 private helper를 import하지 말고 `DiscordModule.forRoot(...)` / `forRootAsync(...)`를 감싸는 app-owned module을 구성하세요.

### 계약과 헬퍼

- `DiscordMessage`
- `NormalizedDiscordMessage`
- `DiscordWebhookTransportOptions`
- `DiscordFetchLike`
- `DiscordFetchResponse`
- `DiscordSendResult`
- `DiscordSendOptions`
- `DiscordSendManyOptions`
- `DiscordSendBatchResult`
- `DiscordSendFailure`
- `DiscordNotificationPayload`
- `DiscordNotificationDispatchRequest`
- `DiscordAllowedMentions`
- `DiscordAttachment`
- `DiscordComponent`
- `DiscordEmbed`
- `DiscordPoll`
- `DiscordTransport`
- `DiscordTransportContext`
- `DiscordTransportFactory`
- `DiscordTransportReceipt`
- `DiscordTemplateRenderInput`
- `DiscordTemplateRenderResult`
- `DiscordTemplateRenderer`
- `createDiscordWebhookTransport(options)`

### 상태 및 에러

- `DiscordService.createPlatformStatusSnapshot()`
- `createDiscordPlatformStatusSnapshot(...)`
- `DiscordLifecycleState`
- `DiscordPlatformStatusSnapshot`
- `DiscordStatusAdapterInput`
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
