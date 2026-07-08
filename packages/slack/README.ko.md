# @fluojs/slack

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 webhook-first, transport-agnostic Slack 전달 코어 패키지입니다. Nest-like 모듈 API, standalone 사용을 위한 주입 가능한 `SlackService`, 그리고 Node 전용 SDK를 가정하지 않는 `@fluojs/notifications` 연동용 1st-party `SlackChannel`을 제공합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [일반적인 패턴](#일반적인-패턴)
  - [모듈 visibility와 migration boundary](#모듈-visibility와-migration-boundary)
  - [`createSlackProviders`를 이용한 수동 provider 조합](#createslackproviders를-이용한-수동-provider-조합)
  - [`SlackService`를 이용한 standalone 전달](#slackservice를-이용한-standalone-전달)
  - [`verifyOnModuleInit`을 이용한 bootstrap 검증](#verifyonmoduleinit을-이용한-bootstrap-검증)
  - [`@fluojs/notifications`와의 통합](#fluojs-notifications와의-통합)
  - [Template rendering과 merge precedence](#template-rendering과-merge-precedence)
  - [명시적 fetch 주입을 사용하는 webhook-first 전달](#명시적-fetch-주입을-사용하는-webhook-first-전달)
  - [의도적인 제한 사항](#의도적인-제한-사항)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
npm install @fluojs/slack @fluojs/notifications
```

이 패키지는 published package metadata에 반영된 저장소 전반의 Node.js 20+ 설치 baseline을 따르지만, 런타임 전달 계약 자체는 명시적인 fetch-compatible 경계를 통해 계속 transport-agnostic하게 유지됩니다.

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

@Inject(SlackService)
export class DeployNotifier {
  constructor(private readonly slack: SlackService) {}

  async announce(version: string) {
    await this.slack.send({
      text: `Deploy ${version} finished successfully.`,
    });
  }
}
```

## 일반적인 패턴

### 모듈 visibility와 migration boundary

`SlackModule.forRoot(...)`와 `SlackModule.forRootAsync(...)`는 기본적으로 global module을 반환합니다. 이 module은 `SlackService`, `SlackChannel`, `SLACK`, `SLACK_CHANNEL`을 export하며, migrated code에서 해당 provider를 반환된 module을 명시적으로 import한 module에만 보이게 해야 할 때만 `global: false`를 전달합니다. 옵션 이름은 NestJS `isGlobal`이 아니라 `global?: boolean`입니다.

패키지 수준 registration surface는 의도적으로 singleton 중심입니다. `SLACK`과 `SLACK_CHANNEL`은 하나의 설정된 Slack service와 notifications channel을 위한 compatibility token이며, `createSlackProviders(...)`는 수동 module composition에서도 같은 singleton wiring을 재사용합니다. 여러 Slack client가 필요한 애플리케이션은 package-level multi-client registry를 기대하지 말고, 서로 다른 `SlackTransport` 인스턴스를 감싸는 자체 module/provider를 조합하거나 app-owned facade를 노출해야 합니다.

### `createSlackProviders`를 이용한 수동 provider 조합

`createSlackProviders(...)`는 애플리케이션이 `SlackModule.forRoot(...)` 밖에서 동일한 singleton provider 정규화 구성을 재사용해야 할 때 지원되는 manual-composition helper입니다.

```typescript
import { Module } from '@fluojs/core';
import { createSlackProviders, createSlackWebhookTransport } from '@fluojs/slack';

@Module({
  providers: [
    ...createSlackProviders({
      defaultChannel: '#ops',
      notifications: { channel: 'alerts' },
      transport: createSlackWebhookTransport({
        fetch: globalThis.fetch.bind(globalThis),
        webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX',
      }),
    }),
  ],
  exports: [],
})
export class SlackProvidersModule {}
```

Behavioral contract 메모:

- 이 helper는 `SlackModule.forRoot(...)`가 구성하는 `SLACK`, `SLACK_CHANNEL`, `SlackService` wiring을 동일하게 유지합니다.
- `createSlackProviders(...)`는 trim된 기본 채널, notification 채널 fallback, transport 소유권 기본값을 포함해 `SlackModule.forRoot(...)`와 동일한 옵션 정규화를 적용합니다.
- 이 helper도 여전히 명시적인 `transport`를 요구하며, 패키지의 runtime-portable·no-implicit-env 계약을 약화시키지 않습니다.

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
- `SlackService.sendMany(...)`는 메시지를 순차적으로 보내며, fail-fast 대신 batch result가 필요한 호출자를 위해 `continueOnError`를 지원합니다.
- `SlackService.send(...)`, `SlackService.sendMany(...)`, `SlackService.sendNotification(...)`은 provider handoff 전에 이미 abort된 signal을 존중하며, 같은 signal을 transport 호출로 전달합니다.
- 서비스는 모듈 bootstrap 시 transport를 초기화하고, factory가 소유한 리소스만 애플리케이션 shutdown 시 닫습니다.
- 직접 전달과 notifications 기반 전달은 lifecycle이 `ready`일 때만 허용됩니다. `onModuleInit()`이 끝나기 전, 초기화 실패 뒤, 또는 shutdown 중 호출하면 transport를 lazy 생성하거나 재사용하지 않고 `SlackLifecycleError`로 실패합니다.
- shutdown은 진행 중인 factory 소유 transport 생성을 기다린 뒤 닫고 완료됩니다.
- factory 소유 transport cleanup은 bootstrap 실패 cleanup과 application shutdown 사이에서 직렬화되므로, 두 경로가 경합해도 같은 owned transport는 최대 한 번만 닫힙니다.
- `SlackService.createPlatformStatusSnapshot()`은 호출자가 내부 옵션에 접근하지 않아도 lifecycle, readiness, transport 소유권을 보고합니다.
- 이 패키지는 절대로 `process.env`를 직접 읽지 않습니다. 모든 설정은 명시적인 옵션 또는 DI를 통해 들어와야 합니다.

### `verifyOnModuleInit`을 이용한 bootstrap 검증

선택한 transport가 bootstrap 중 자신의 readiness를 검증할 수 있다면 `SlackModuleOptions.verifyOnModuleInit?: boolean`을 `true`로 설정합니다. `SlackService.onModuleInit()`은 항상 설정된 transport를 먼저 해석하며, `verifyOnModuleInit`이 켜져 있고 해석된 transport가 optional `verify()` 메서드를 노출할 때에만 `transport.verify()`를 기다린 뒤 Slack provider를 ready로 표시합니다. `verify`를 구현하지 않는 transport도 유효하며, 이 경우 검증 단계만 건너뜁니다.

```typescript
import { Module } from '@fluojs/core';
import {
  SlackModule,
  type SlackTemplateRenderer,
  type SlackTransport,
} from '@fluojs/slack';

const renderer: SlackTemplateRenderer = {
  render({ template, payload, subject }) {
    if (template === 'deploy.finished') {
      return {
        blocks: [
          {
            text: { text: `*${String(payload.version)}* is live`, type: 'mrkdwn' },
            type: 'section',
          },
        ],
        text: subject,
      };
    }

    return { text: subject };
  },
};

const slackApiTransport: SlackTransport = {
  async verify() {
    await slackApi.authTest();
  },
  async send(message, { signal }) {
    const receipt = await slackApi.postMessage(message, { signal });

    return {
      channel: receipt.channel,
      messageTs: receipt.ts,
      ok: receipt.ok,
    };
  },
};

@Module({
  imports: [
    SlackModule.forRoot({
      defaultChannel: '#ops',
      renderer,
      transport: slackApiTransport,
      verifyOnModuleInit: true,
    }),
  ],
})
export class AppModule {}
```

Behavioral contract 메모:

- `verifyOnModuleInit`은 선택 사항이며 기본값은 `false`입니다.
- 검증은 capability 기반입니다. `verify()`를 노출하는 transport만 호출하므로 webhook-only 또는 애플리케이션이 소유한 transport가 no-op verifier를 추가할 필요는 없습니다.
- `transport.verify()`가 reject되면 bootstrap은 초기화 실패를 감싼 `SlackLifecycleError`로 실패하고, service lifecycle은 `failed`로 이동하며, readiness/status snapshot은 provider를 not ready로 보고하고, 이미 해석된 factory 소유 transport는 오류를 다시 던지기 전에 닫습니다. 그 cleanup이 진행 중일 때 shutdown이 시작되면 두 호출자는 같은 close 작업을 기다립니다.
- `SlackService.createPlatformStatusSnapshot()`은 bootstrap 검증 요청 여부를 health/readiness tooling이 확인할 수 있도록 `verifiedOnModuleInit`을 포함합니다.

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
- notification metadata는 전달 전에 payload metadata, dispatch metadata, subject/template marker를 합쳐 구성됩니다.
- 여러 Slack 대상지로 fan-out이 필요하다면 하나의 multi-recipient dispatch 대신 `sendMany(...)`를 사용해야 합니다.

### Template rendering과 merge precedence

Notification template을 공유 `@fluojs/notifications` envelope에서 Slack 전용 text, blocks, attachments로 변환해야 한다면 `SlackTemplateRenderer`를 제공합니다. `SlackService.sendNotification(...)`은 `notification.template`과 `SlackModuleOptions.renderer`가 모두 있을 때에만 `renderer.render(input)`을 호출합니다. Render input에는 `template`, `payload`, optional `subject`, optional `locale`, optional dispatch `metadata`가 들어갑니다.

```typescript
import type { SlackTemplateRenderer } from '@fluojs/slack';

const renderer: SlackTemplateRenderer = {
  async render(input) {
    return {
      blocks: [
        {
          text: {
            text: `*${String(input.payload.releaseId)}* deployed for ${input.locale ?? 'default'}`,
            type: 'mrkdwn',
          },
          type: 'section',
        },
      ],
      text: input.subject,
    };
  },
};

await notifications.dispatch({
  channel: 'slack',
  locale: 'en',
  metadata: { source: 'ci' },
  payload: {
    metadata: { releaseId: 'rel-42' },
    text: 'Deploy rel-42 finished.',
  },
  recipients: ['#ops'],
  subject: 'Deploy finished',
  template: 'deploy.finished',
});
```

Merge precedence는 결정적입니다.

- `payload.attachments`, `payload.blocks`, `payload.text`가 정의되어 있으면 rendered `attachments`, `blocks`, `text`보다 우선합니다.
- Text는 `payload.text`에서 rendered `text`, 그리고 `notification.subject` 순서로 fallback합니다.
- Metadata는 payload metadata, dispatch metadata, subject marker, template marker 순서로 merge됩니다. 중복 키는 뒤쪽 값이 이기므로, 최종 메시지는 존재하는 dispatch `subject`와 `template` marker를 기록합니다.
- `template`이 없거나 renderer가 등록되지 않았다면 template rendering은 실행되지 않습니다. 이 경우 notification은 payload와 subject만으로 Slack 메시지로 변환됩니다.

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

- `fetch`를 명시적으로 전달하는 방식이 portable path이며 모든 지원 런타임에서 권장됩니다. 하위 호환성을 위해 `fetch`를 생략하면 ambient runtime API인 `globalThis.fetch`가 있을 때 이를 폴백으로 사용합니다. `globalThis.fetch`가 없는 런타임에서는 `SlackConfigurationError`로 빠르게 실패합니다.
- 내장 webhook transport는 `408`, `429`, `5xx` 같은 일시적 실패를 호출자에게 에러를 노출하기 전에 bounded exponential backoff로 재시도합니다.
- Abort signal은 주입된 `fetch` 경계로 전달되며, retry backoff를 취소할 때 `AbortError`를 `SlackTransportError`로 감싸지 않습니다.
- 호출자에게 보이는 `SlackTransportError` 메시지는 기본적으로 raw upstream response body를 포함하지 않습니다.

### 의도적인 제한 사항

Slack 패키지는 의도적으로 다음을 **포함하지 않습니다**:

- 자격 증명이나 webhook URL을 `process.env`에서 직접 읽는 동작
- 공유 루트 패키지 경계에 Node 전용 Slack SDK를 내장하는 것
- webhook helper와 export된 transport 계약 이상으로 하나의 provider 전략을 강제하는 것
- singleton module/helper surface를 넘어서는 package-level multi-client registry를 제공하는 것
- 하나의 dispatch 호출 안에서 multi-channel fan-out을 자동 변환하는 것

이 제한 사항은 런타임 선택, provider capability, rollout 전략이 애플리케이션 경계에서 명시적으로 결정되도록 하기 위한 package contract의 일부입니다.

## 공개 API 개요

### 핵심

- `SlackModule.forRoot(options)` / `SlackModule.forRootAsync(options)`
- `SlackModuleOptions`
- `SlackAsyncModuleOptions`
- `createSlackProviders(options)`
- `SlackService`
- `SlackService.send(message, options)`
- `SlackService.sendMany(messages, options)`
- `SlackService.sendNotification(notification, options)`
- `SlackService.createPlatformStatusSnapshot()`
- `SlackChannel`
- `SLACK`
- `SLACK_CHANNEL`

### Service facade와 result 계약

- `Slack`
- `SlackSendOptions`
- `SlackSendManyOptions`
- `SlackSendResult`
- `SlackSendBatchResult`
- `SlackSendFailure`

### 계약과 헬퍼

- `SlackMessage`
- `NormalizedSlackMessage`
- `SlackNotificationPayload`
- `SlackNotificationDispatchRequest`
- `SlackBlock`
- `SlackAttachment`
- `SlackTransport`
- `SlackTransportFactory`
- `SlackTransportContext`
- `SlackTransportReceipt`
- `SlackFetchLike`
- `SlackFetchResponse`
- `SlackWebhookTransportOptions`
- `createSlackWebhookTransport(options)`
- `SlackTemplateRenderer`
- `SlackTemplateRenderInput`
- `SlackTemplateRenderResult`

### 상태 및 에러

- `createSlackPlatformStatusSnapshot(...)`
- `SlackPlatformStatusSnapshot`
- `SlackLifecycleState`
- `SlackStatusAdapterInput`
- `SlackConfigurationError`
- `SlackLifecycleError`: readiness 전, 초기화 실패 뒤, 또는 shutdown 중 lifecycle로 차단된 전달과 transport factory, verification, 소유 리소스 cleanup 실패에서 발생합니다. bootstrap 또는 애플리케이션 teardown과 전송이 경합할 수 있다면 이 에러를 catch하세요.
- `SlackMessageValidationError`: 직접 메시지에 Slack에서 보이는 `text`, `blocks`, `attachments`가 없거나, 하나의 notification dispatch가 여러 Slack recipient로 해석되어 `sendMany(...)`로 분리해야 할 때 발생합니다.
- `SlackTransportError`

## 관련 패키지

- `@fluojs/notifications`: `SLACK_CHANNEL`을 소비하는 공통 오케스트레이션 계층입니다.
- `@fluojs/config`: 환경 직접 접근 없이 webhook URL이나 토큰을 해석하려는 경우 권장됩니다.
- `@fluojs/event-bus`: Slack 알림이 여러 이벤트 기반 부작용 중 하나일 때 유용합니다.

## 예제 소스

- `packages/slack/src/module.test.ts`: 모듈 등록, `createSlackProviders(...)` helper coverage, async wiring, webhook transport, notifications integration 예제.
- `packages/slack/src/public-surface.test.ts`: 공개 export와 TypeScript 계약 검증 예제.
- `packages/slack/src/status.test.ts`: health/readiness 계약 예제.
