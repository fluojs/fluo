<!-- packages: @fluojs/slack, @fluojs/discord, @fluojs/notifications -->
<!-- project-state: FluoShop v2.2.0 -->

# 17. Slack and Discord Integration

운영 가시성(Operational awareness)은 성숙한 백엔드의 상징입니다. 이메일이 사용자에게 적합하다면, Slack이나 Discord와 같은 실시간 채팅 플랫폼은 여러분의 팀이 상주하는 곳입니다.

`@fluojs/slack`과 `@fluojs/discord` 패키지는 fluo를 위한 웹훅 기반의, 트랜스포트 불가지론적(transport-agnostic) 전송 기능을 제공합니다. 이 패키지들을 사용하면 특정 런타임이나 SDK에 코드를 결합하지 않고도 채널과 스레드에 풍부한 형식의 메시지를 보낼 수 있습니다.

이 장에서는 FluoShop을 위한 채팅 기반 알림 및 경고 시스템을 구현해 보겠습니다.

## 17.1 The Webhook-First Approach

Fluo는 단순한 전송을 위해 **인커밍 웹훅(Incoming Webhooks)** 방식을 선호합니다. 이는 단순한 알림 작업을 위해 OAuth 토큰이나 복잡한 봇 SDK를 관리해야 하는 번거로움을 피하게 해줍니다.

두 패키지 모두 `fetch` 구현체만 있으면 작동하는 `createWebhookTransport` 헬퍼를 제공합니다.

```typescript
import { createSlackWebhookTransport } from '@fluojs/slack';

const transport = createSlackWebhookTransport({
  fetch: globalThis.fetch.bind(globalThis),
  webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX',
});
```

표준 `fetch` API에 의존하기 때문에, 이 트랜스포트는 Node.js 18+, Bun, Deno, Cloudflare Workers에서 네이티브로 작동합니다.

## 17.2 Registering the Chat Modules

등록 방식은 다른 fluo 모듈들과 동일한 패턴을 따릅니다.

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

운영 로그 기록이나 커스텀 알림을 위해 서비스를 직접 사용할 수 있습니다.

```typescript
import { Inject } from '@fluojs/core';
import { SlackService } from '@fluojs/slack';

export class LoggerService {
  constructor(@Inject(SlackService) private readonly slack: SlackService) {}

  async logError(error: Error) {
    await this.slack.send({
      text: `🚨 *Critical Error*: ${error.message}`,
    });
  }
}
```

## 17.4 Integration with @fluojs/notifications

오케스트레이션된 알림 시스템에 채팅 플랫폼을 포함하려면 `SLACK_CHANNEL` 또는 `DISCORD_CHANNEL` 토큰을 주입합니다.

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

## 17.5 Rich Formatting: Blocks and Embeds

채팅 플랫폼의 강점 중 하나는 풍부한 포맷팅입니다.

### Slack Blocks
Slack 패키지는 **Block Kit** API를 지원합니다.

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
Discord 패키지는 구조화된 데이터를 위해 **Embeds**를 지원합니다.

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

FluoShop에서는 개발자 알림을 위해 Slack을, 커뮤니티 주문 알림을 위해 Discord를 사용합니다.

`NotificationsService`를 사용하면 하나의 이벤트를 필요에 따라 두 플랫폼 모두로 라우팅할 수 있습니다.

```typescript
@OnEvent('order.placed')
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

내장된 웹훅 트랜스포트는 프로덕션 환경의 안정성을 고려하여 설계되었습니다.

- **자동 재시도**: 일시적인 `408`, `429`, `5xx` 오류에 대해 지수 백오프(exponential backoff)를 적용하여 자동으로 재시도합니다.
- **명시적 에러**: 영구적인 실패(404, 403 등)에 대해서는 `SlackTransportError` 또는 `DiscordTransportError`를 던져 애플리케이션 레벨에서 처리할 수 있게 합니다.

## 17.8 Status Snapshots

채팅 연동은 웹훅 URL 만료 등으로 인해 중단되는 경우가 많습니다. 상태 스냅샷을 통해 이를 모니터링하세요.

```typescript
const slackStatus = await createSlackPlatformStatusSnapshot(slackService);
if (!slackStatus.isReady) {
  metrics.increment('notifications.slack.offline');
}
```

## Conclusion

Slack과 Discord를 fluo 생태계에 통합함으로써, 여러분의 백엔드를 팀 커뮤니케이션의 적극적인 참여자로 탈바꿈시켰습니다. 런타임 이식성을 희생하지 않고도 실시간 관측 가능성과 풍부한 포맷팅 기능을 확보했습니다.

이것으로 **Part 4: 알림 시스템**을 마칩니다. 이제 여러분은 사용자와 팀 모두와 소통하기 위한 통합되고 확장 가능하며 관측 가능한 전략을 갖추게 되었습니다.
