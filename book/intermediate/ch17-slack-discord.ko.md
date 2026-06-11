<!-- packages: @fluojs/slack, @fluojs/discord, @fluojs/notifications -->
<!-- project-state: FluoShop v2.2.0 -->

# Chapter 17. Slack and Discord Integration

이 장에서는 FluoShop의 알림 시스템을 팀 커뮤니케이션 채널로 확장하는 방식을 다룹니다. Chapter 16에서 이메일 전달 기반을 마련했다면, 여기서는 Slack과 Discord를 사용해 운영 경고와 실시간 공유 흐름을 연결합니다.

## Learning Objectives
- Slack과 Discord 연동이 이메일 채널과 다른 지점을 구분합니다.
- 웹훅 중심 전송 방식으로 채팅 모듈을 등록하는 절차를 정리합니다.
- `SlackService`와 `DiscordService`를 독립적으로 사용하는 흐름을 확인합니다.
- `@fluojs/notifications`에 채팅 채널을 연결하는 방식을 구현합니다.
- Block Kit과 Embed로 구조화된 메시지를 구성합니다.
- transport가 readiness check를 노출할 때 Slack bootstrap 검증을 설정합니다.
- Slack notification template을 렌더링하고 payload와 rendered 결과의 merge precedence를 판단합니다.
- 재시도 정책과 상태 스냅샷을 기준으로 채팅 연동을 운영합니다.

## Prerequisites
- Chapter 15와 Chapter 16 완료.
- 웹훅 기반 외부 서비스 연동에 대한 기본 이해.
- 운영 알림과 팀 협업 채널을 분리해 설계해 본 경험.

## 17.1 The Webhook-First Approach

Fluo는 단순 전송에는 **인커밍 웹훅(Incoming Webhooks)** 방식을 우선합니다. 알림 발송만 필요한 상황에서 OAuth 토큰, 봇 권한, SDK 수명 주기까지 관리하는 비용을 줄이기 위해서입니다.

두 패키지는 모두 `fetch` 구현체만 있으면 동작하는 웹훅 트랜스포트 헬퍼를 제공합니다.

```typescript
import { createSlackWebhookTransport } from '@fluojs/slack';

const transport = createSlackWebhookTransport({
  fetch: globalThis.fetch.bind(globalThis),
  webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX',
});
```

표준 `fetch` API에 의존하므로 이 트랜스포트는 저장소의 Node.js 20+ baseline, Bun, Deno, Cloudflare Workers에서 별도 어댑터 없이 동작합니다.

## 17.2 Registering the Chat Modules

등록 방식은 다른 fluo 모듈과 같은 패턴을 따릅니다. 기본 채널이나 스레드 같은 운영 기본값을 모듈 설정에 고정하고, 트랜스포트에는 런타임별 `fetch`와 웹훅 URL을 넘깁니다.

### Slack Registration
```typescript
import { SlackModule, createSlackWebhookTransport } from '@fluojs/slack';

@Module({
  imports: [
    SlackModule.forRoot({
      defaultChannel: '#ops-alerts',
      transport: createSlackWebhookTransport({
        fetch: runtime.fetch,
        webhookUrl: config.slackWebhookUrl,
      }),
    }),
  ],
})
export class AppModule {}
```

Slack registration은 기본적으로 global입니다. `SlackModule.forRoot(...)`와 `SlackModule.forRootAsync(...)`는 `global: options.global ?? true`로 `SlackService`, `SlackChannel`, `SLACK`, `SLACK_CHANNEL`을 export합니다. fluo 옵션은 NestJS `isGlobal`이 아니라 `global?: boolean`이며, migrated module이 Slack provider를 명시적으로 import한 module 안에만 유지해야 할 때만 `global: false`를 설정합니다. 이 패키지는 singleton compatibility token만 노출합니다. `forFeature(...)`, named registration, named client token factory, per-client custom token surface는 제공하지 않습니다. FluoShop에 여러 Slack client가 필요해지면 package-level named multi-client registration을 기대하지 말고, 별도 transport를 감싸는 app-owned module/provider나 facade를 조합하세요.

Slack은 애플리케이션이 traffic을 받기 전에 readiness를 증명할 수 있는 transport를 위한 bootstrap 검증도 지원합니다. 해석된 `SlackTransport`가 `verify()`를 노출할 때 `verifyOnModuleInit: true`를 설정하면 `SlackService.onModuleInit()`이 그 optional method를 기다리고, 초기화 실패를 `SlackLifecycleError`로 보고합니다. `verify()`를 구현하지 않는 transport도 유효하며, 이 capability-based check만 건너뜁니다.

```typescript
import type { SlackTransport } from '@fluojs/slack';

const slackApiTransport: SlackTransport = {
  async verify() {
    await slackApi.authTest();
  },
  async send(message, { signal }) {
    const response = await slackApi.postMessage(message, { signal });

    return {
      channel: response.channel,
      messageTs: response.ts,
      ok: response.ok,
    };
  },
};

SlackModule.forRoot({
  defaultChannel: '#ops-alerts',
  transport: slackApiTransport,
  verifyOnModuleInit: true,
});
```

상태 스냅샷은 `verifiedOnModuleInit`을 포함하므로 readiness dashboard에서 이 startup gate가 요청되었는지 확인할 수 있습니다. `verify()`가 실패하면 Slack lifecycle은 `failed`로 이동하고 readiness는 not ready로 남아, 첫 운영 알림이 실패한 뒤에야 문제를 발견하는 상황을 줄입니다.

### Discord Registration
```typescript
import { DiscordModule, createDiscordWebhookTransport } from '@fluojs/discord';

@Module({
  imports: [
    DiscordModule.forRoot({
      defaultThreadId: 'main-log',
      transport: createDiscordWebhookTransport({
        fetch: runtime.fetch,
        webhookUrl: config.discordWebhookUrl,
      }),
    }),
  ],
})
export class AppModule {}
```

## 17.3 Standalone Usage: SlackService & DiscordService

운영 로그 기록이나 맞춤 알림처럼 오케스트레이션이 과한 경우에는 서비스를 직접 사용할 수 있습니다.

이미 Slack 목적지를 알고 있는 내부 팀 메시지에는 `SlackService`를 직접 사용합니다.

```typescript
import { Inject } from '@fluojs/core';
import { SlackService } from '@fluojs/slack';

@Inject(SlackService)
export class LoggerService {
  constructor(private readonly slack: SlackService) {}

  async logError(error: Error) {
    await this.slack.send({
      text: `🚨 *Critical Error*: ${error.message}`,
    });
  }
}
```

커뮤니티 공지, release thread, 공유 notifications 정책을 우회해야 하는 Discord 전용 payload에는 `DiscordService`도 같은 방식으로 사용할 수 있습니다.

```typescript
import { Inject } from '@fluojs/core';
import { DiscordService } from '@fluojs/discord';

@Inject(DiscordService)
export class CommunityAnnouncementService {
  constructor(private readonly discord: DiscordService) {}

  async publishRelease(version: string) {
    await this.discord.send({
      content: `🚀 FluoShop ${version} is live!`,
      embeds: [
        {
          description: 'Release notes are available in the community thread.',
          title: 'Release published',
        },
      ],
    });
  }
}
```

## 17.4 Integration with @fluojs/notifications

오케스트레이션된 알림 시스템에 채팅 플랫폼을 포함하려면 `SLACK_CHANNEL` 또는 `DISCORD_CHANNEL` 토큰을 주입합니다. 이렇게 하면 이벤트 발행자는 채널별 전송 세부 사항을 몰라도 됩니다.

```typescript
import { SLACK_CHANNEL } from '@fluojs/slack';
import { DISCORD_CHANNEL } from '@fluojs/discord';

NotificationsModule.forRootAsync({
  inject: [SLACK_CHANNEL, DISCORD_CHANNEL],
  useFactory: (slack, discord) => ({
    channels: [slack, discord],
  }),
});
```

### Dispatching to Chat
```typescript
await this.notifications.dispatch({
  channel: 'slack',
  recipients: ['#customer-support'],
  subject: 'New Ticket Received',
  payload: {
    text: 'A new support ticket has been opened.',
    attachments: [{ color: '#f2c744', text: 'Ticket ID: 456' }],
  },
});
```

### Slack Template Rendering
반복되는 이벤트에 일관된 Slack 문구를 적용하려면 `SlackModule.forRoot(...)`에 `SlackTemplateRenderer`를 등록하고 notification을 `template`과 함께 dispatch합니다. Renderer는 `{ template, payload, subject, locale, metadata }`를 받아 Slack `text`, `blocks`, `attachments`를 반환합니다.

```typescript
import type { SlackTemplateRenderer } from '@fluojs/slack';

const renderer: SlackTemplateRenderer = {
  async render(input) {
    return {
      blocks: [
        {
          text: {
            text: `*Ticket ${String(input.payload.ticketId)}* needs attention`,
            type: 'mrkdwn',
          },
          type: 'section',
        },
      ],
      text: input.subject,
    };
  },
};

SlackModule.forRoot({
  defaultChannel: '#customer-support',
  renderer,
  transport: createSlackWebhookTransport({
    fetch: runtime.fetch,
    webhookUrl: config.slackWebhookUrl,
  }),
});

await this.notifications.dispatch({
  channel: 'slack',
  locale: 'en',
  metadata: { source: 'support' },
  payload: {
    metadata: { ticketId: '456' },
    text: 'Ticket 456 was opened.',
  },
  recipients: ['#customer-support'],
  subject: 'New Ticket Received',
  template: 'support.ticket.opened',
});
```

`sendNotification(...)`은 `notification.template`과 `renderer`가 모두 있을 때에만 renderer를 호출합니다. 명시적인 payload 필드는 `attachments`, `blocks`, `text`에서 rendered 필드보다 우선하며, text는 payload text에서 rendered text, 그리고 `subject` 순서로 fallback합니다. Metadata는 payload metadata, dispatch metadata, subject marker, template marker 순서로 merge되므로 최종 Slack 메시지는 운영 routing context를 보존합니다.

## 17.5 Rich Formatting: Blocks and Embeds

채팅 플랫폼의 강점은 메시지를 사람이 바로 읽고 판단할 수 있는 형태로 구성할 수 있다는 점입니다. 단순 문자열보다 구조화된 블록과 embed를 사용하면 주문 번호, 상태, 담당자 같은 정보를 한눈에 분리해 보여줄 수 있습니다.

### Slack Blocks
Slack 패키지는 **Block Kit** API를 지원해 섹션, 필드, 구분선 등으로 메시지를 구조화할 수 있습니다. 운영 알림에서는 같은 메시지 안에서도 핵심 상태와 보조 정보를 나눠 보여주는 일이 중요하므로, Block Kit은 단순 텍스트보다 읽기 쉬운 알림을 만들게 해줍니다.

```typescript
await this.slack.send({
  blocks: [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*New Order Placed*' },
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: '*Order ID:*\n123' },
        { type: 'mrkdwn', text: '*Total:*\n$99.00' },
      ],
    },
  ],
});
```

### Discord Embeds
Discord 패키지는 구조화된 데이터를 표현하기 위해 **Embeds**를 지원합니다. 제목, 색상, 필드, 설명을 함께 사용하면 커뮤니티나 공개 채널에서도 주문 이벤트의 의미를 빠르게 전달할 수 있습니다.

```typescript
await this.discord.send({
  content: 'Order Received!',
  embeds: [
    {
      title: 'Order #123',
      description: 'Items: 3',
      color: 0x00ff00,
    },
  ],
});
```

## 17.6 FluoShop Context: Operational Alerts

FluoShop에서는 내부 운영 알림에는 Slack을 사용하고, 공개 커뮤니티에 공유할 주문 알림에는 Discord를 사용합니다. `NotificationsService`를 사용하면 하나의 도메인 이벤트를 정책에 따라 한 플랫폼 또는 여러 플랫폼으로 라우팅할 수 있습니다. 이 구분은 이벤트 생산자에게 채널 선택 책임을 떠넘기지 않고, 알림 정책을 중앙에서 관리하게 해줍니다.

```typescript
@OnEvent(OrderPlacedEvent)
async alertOps(event: OrderPlacedEvent) {
  // Slack으로 개발자에게 알림
  await this.notifications.dispatch({
    channel: 'slack',
    payload: { text: `New order: ${event.orderId}` },
  });

  // Discord로 커뮤니티에 공유 (동의한 경우)
  await this.notifications.dispatch({
    channel: 'discord',
    payload: { content: `A new order was just placed! 🚀` },
  });
}
```

## 17.7 Error Handling and Retries

내장 웹훅 트랜스포트는 운영 환경의 실패 양상을 기준으로 설계되어 있습니다. 네트워크 오류, 만료된 웹훅 URL, 플랫폼 rate limit처럼 채팅 연동에서 자주 만나는 문제를 같은 전송 경계에서 다룰 수 있습니다.

- **자동 재시도**: 일시적인 `408`, `429`, `5xx` 오류에는 지수 백오프(exponential backoff)를 적용해 다시 시도합니다.
- **명시적 에러**: 영구적인 실패(404, 403 등)는 `SlackTransportError` 또는 `DiscordTransportError`로 드러내 애플리케이션 레벨에서 처리하게 합니다.

## 17.8 Status Snapshots

채팅 연동은 웹훅 URL 만료, 권한 변경, 외부 서비스 장애로 중단될 수 있습니다. 상태 스냅샷을 운영 지표와 알림에 연결해 조기에 감지합니다. 이 정보를 주기적으로 확인하면 알림이 필요한 순간에야 채널 장애를 발견하는 상황을 줄일 수 있습니다.

```typescript
const slackStatus = slackService.createPlatformStatusSnapshot();
if (slackStatus.readiness.status !== 'ready') {
  metrics.increment('notifications.slack.offline');
}

const discordStatus = discordService.createPlatformStatusSnapshot();
if (discordStatus.readiness.status !== 'ready') {
  metrics.increment('notifications.discord.offline');
}
```

`DiscordService.createPlatformStatusSnapshot()`은 `createDiscordPlatformStatusSnapshot(...)`과 같은 운영 shape를 반환합니다. 즉 lifecycle/readiness, transport ownership과 kind, 기본 thread 구성, bootstrap verification 상태, notifications channel dependency가 들어가므로 FluoShop은 package internals를 읽지 않고도 Discord wiring을 관찰할 수 있습니다.

## Conclusion

Slack과 Discord를 fluo 생태계에 통합하면 백엔드가 팀 커뮤니케이션 흐름에 직접 참여할 수 있습니다. 런타임 이식성을 유지하면서도 실시간 관측성과 구조화된 메시지 표현을 확보했습니다. FluoShop에서는 이메일, Slack, Discord가 모두 같은 알림 오케스트레이션 모델 안에서 정책적으로 선택됩니다. 이것으로 **Part 4: 알림 시스템**을 마칩니다. 지금까지 사용자 알림과 팀 운영 알림을 같은 오케스트레이션 모델 안에서 다루는 전략을 정리했습니다.
