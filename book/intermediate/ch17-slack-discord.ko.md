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

표준 `fetch` API에 의존하므로 이 트랜스포트는 Node.js 18+, Bun, Deno, Cloudflare Workers에서 별도 어댑터 없이 동작합니다.

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

내장 웹훅 트랜스포트는 운영 환경의 실패 양상을 기준으로 설계되어 있습니다. 네트워크 오류, 만료된 웹훅 URL, 플랫폼 rate limit처럼 채팅 연동에서 자주 만나는 문제를 같은 전송 경계에서 다룰 수 있습니다.

- **자동 재시도**: 일시적인 `408`, `429`, `5xx` 오류에는 지수 백오프(exponential backoff)를 적용해 다시 시도합니다.
- **명시적 에러**: 영구적인 실패(404, 403 등)는 `SlackTransportError` 또는 `DiscordTransportError`로 드러내 애플리케이션 레벨에서 처리하게 합니다.

## 17.8 Status Snapshots

채팅 연동은 웹훅 URL 만료, 권한 변경, 외부 서비스 장애로 중단될 수 있습니다. 상태 스냅샷을 운영 지표와 알림에 연결해 조기에 감지합니다. 이 정보를 주기적으로 확인하면 알림이 필요한 순간에야 채널 장애를 발견하는 상황을 줄일 수 있습니다.

```typescript
const slackStatus = await createSlackPlatformStatusSnapshot(slackService);
if (!slackStatus.isReady) {
  metrics.increment('notifications.slack.offline');
}
```

## Conclusion

Slack과 Discord를 fluo 생태계에 통합하면 백엔드가 팀 커뮤니케이션 흐름에 직접 참여할 수 있습니다. 런타임 이식성을 유지하면서도 실시간 관측성과 구조화된 메시지 표현을 확보했습니다. FluoShop에서는 이메일, Slack, Discord가 모두 같은 알림 오케스트레이션 모델 안에서 정책적으로 선택됩니다. 이것으로 **Part 4: 알림 시스템**을 마칩니다. 지금까지 사용자 알림과 팀 운영 알림을 같은 오케스트레이션 모델 안에서 다루는 전략을 정리했습니다.
