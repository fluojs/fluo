import { Inject, Module } from '@fluojs/core';
import {
  createDiscordWebhookTransport,
  DISCORD_CHANNEL,
  type DiscordFetchLike,
  DiscordModule,
} from '@fluojs/discord';
import {
  EMAIL_CHANNEL,
  EmailModule,
  type EmailTransport,
  type EmailTransportContext,
  type EmailTransportReceipt,
  type NormalizedEmailMessage,
} from '@fluojs/email';
import { Controller, FromBody, Post, RequestDto } from '@fluojs/http';
import { MetricsModule } from '@fluojs/metrics';
import {
  type NotificationChannel,
  type NotificationLifecycleEvent,
  NotificationsModule,
  NotificationsService,
} from '@fluojs/notifications';
import {
  createSlackWebhookTransport,
  SLACK_CHANNEL,
  type SlackFetchLike,
  SlackModule,
} from '@fluojs/slack';
import { type HealthIndicator, type HealthIndicatorResult, TerminusModule } from '@fluojs/terminus';

/**
 * Cross-package composition for the integrations package guides
 * (notifications + email + slack + discord + terminus + metrics): three leaf
 * channels feed one NotificationsModule, lifecycle events are observed
 * through the publication seam, and the same HTTP application serves
 * terminus health/readiness and a Prometheus scrape.
 */

const SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/EXAMPLE';
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/EXAMPLE';

export class RecordingEmailTransport implements EmailTransport {
  readonly sent: NormalizedEmailMessage[] = [];

  async send(message: NormalizedEmailMessage, _context: EmailTransportContext): Promise<EmailTransportReceipt> {
    this.sent.push(message);
    return {
      accepted: message.to.map((entry) => entry.address),
      messageId: `email-${String(this.sent.length)}`,
    };
  }
}

export const emailTransport = new RecordingEmailTransport();

export class RecordingSlackFetch {
  readonly calls: Array<{ body: Record<string, unknown>; url: string }> = [];

  readonly fetchLike: SlackFetchLike = async (input, init) => {
    this.calls.push({ body: JSON.parse(init?.body ?? '{}') as Record<string, unknown>, url: input });
    return { ok: true, status: 200, text: async () => 'ok' };
  };
}

export const slackFetch = new RecordingSlackFetch();

export class RecordingDiscordFetch {
  readonly calls: Array<{ body: Record<string, unknown>; url: string }> = [];

  readonly fetchLike: DiscordFetchLike = async (input, init) => {
    this.calls.push({ body: JSON.parse(init?.body ?? '{}') as Record<string, unknown>, url: input });
    return { ok: true, status: 200, text: async () => '{"id":"m1"}' };
  };
}

export const discordFetch = new RecordingDiscordFetch();

export class RecordingLifecyclePublisher {
  readonly events: Array<NotificationLifecycleEvent['name']> = [];

  async publish(event: NotificationLifecycleEvent): Promise<void> {
    this.events.push(event.name);
  }
}

export const lifecyclePublisher = new RecordingLifecyclePublisher();

export const appStateIndicator: HealthIndicator = {
  key: 'app-state',
  async check(): Promise<HealthIndicatorResult> {
    return { 'app-state': { status: 'up' } };
  },
};

class NotifyDto {
  @FromBody()
  channel = '';

  @FromBody()
  text = '';
}

@Inject(NotificationsService)
@Controller('/notify')
class NotifyController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post()
  @RequestDto(NotifyDto)
  async notify(input: NotifyDto): Promise<{ status: string }> {
    const result = await this.notifications.dispatch({
      channel: input.channel,
      recipients: ['ops-target'],
      subject: 'Ops notification',
      // Each channel interprets its own payload fields: email and Slack read
      // `text`, Discord reads `content`.
      payload: { text: input.text, content: input.text },
    });
    return { status: result.status };
  }
}

@Module({
  imports: [
    EmailModule.forRoot({
      defaultFrom: 'noreply@example.com',
      transport: emailTransport,
    }),
    SlackModule.forRoot({
      defaultChannel: '#ops',
      transport: createSlackWebhookTransport({
        fetch: slackFetch.fetchLike,
        webhookUrl: SLACK_WEBHOOK_URL,
      }),
    }),
    DiscordModule.forRoot({
      defaultThreadId: 'release-thread-id',
      transport: createDiscordWebhookTransport({
        fetch: discordFetch.fetchLike,
        webhookUrl: DISCORD_WEBHOOK_URL,
      }),
    }),
    NotificationsModule.forRootAsync({
      inject: [EMAIL_CHANNEL, SLACK_CHANNEL, DISCORD_CHANNEL],
      useFactory: (...deps: unknown[]) => {
        // Async factories receive contextually-typed unknown deps; the channel
        // tokens pin each position to a NotificationChannel implementation.
        const channels = deps as NotificationChannel[];
        return {
          channels,
          events: { publisher: lifecyclePublisher },
        };
      },
    }),
    MetricsModule.forRoot({ defaultMetrics: false, http: true }),
    TerminusModule.forRoot({ indicators: [appStateIndicator] }),
  ],
  controllers: [NotifyController],
})
export class NotifyOpsAppModule {}
