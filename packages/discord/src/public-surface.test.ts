import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  DiscordFetchLike,
  DiscordMessage,
  DiscordModuleOptions,
  DiscordNotificationDispatchRequest,
  DiscordNotificationPayload,
  DiscordStatusAdapterInput,
  DiscordTemplateRenderer,
  DiscordTransport,
  DiscordTransportFactory,
  DiscordWebhookRetryOptions,
  DiscordWebhookTransportOptions,
} from './index.js';
import * as discordPublicApi from './index.js';

type Assert<TValue extends true> = TValue;
type RejectsThreadId<TValue> = { threadId: string } extends TValue ? false : true;

describe('@fluojs/discord public API surface', () => {
  it('keeps documented root-barrel exports stable', () => {
    expect(discordPublicApi).toHaveProperty('DiscordModule');
    expect(discordPublicApi).toHaveProperty('createDiscordWebhookTransport');
    expect(discordPublicApi).toHaveProperty('DiscordService');
    expect(discordPublicApi).toHaveProperty('DiscordChannel');
    expect(discordPublicApi).toHaveProperty('DISCORD_CHANNEL');
    expect(discordPublicApi).toHaveProperty('createDiscordPlatformStatusSnapshot');
    expect(discordPublicApi).toHaveProperty('DiscordConfigurationError');
    expect(discordPublicApi).toHaveProperty('DiscordMessageValidationError');
    expect(discordPublicApi).toHaveProperty('DiscordTransportError');
  });

  it('keeps documented TypeScript-only contracts stable enough for downstream packages', () => {
    expectTypeOf<DiscordMessage>().toHaveProperty('content');
    expectTypeOf<DiscordMessage>().toHaveProperty('embeds');
    expectTypeOf<DiscordTransport>().toHaveProperty('send');
    expectTypeOf<DiscordModuleOptions>().toHaveProperty('defaultThreadId');
    expectTypeOf<DiscordModuleOptions>().toHaveProperty('transport');
    expectTypeOf<DiscordTransportFactory>().toHaveProperty('create');
    expectTypeOf<DiscordNotificationDispatchRequest>().toHaveProperty('channel');
    expectTypeOf<DiscordWebhookTransportOptions>().toHaveProperty('webhookUrl');
    expectTypeOf<DiscordWebhookTransportOptions>().toHaveProperty('retry');
    expectTypeOf<DiscordWebhookRetryOptions>().toHaveProperty('attempts');
    expectTypeOf<DiscordWebhookRetryOptions>().toHaveProperty('baseDelayMs');
    expectTypeOf<DiscordFetchLike>().toBeFunction();
    expectTypeOf<DiscordTemplateRenderer>().toHaveProperty('render');
    expectTypeOf<DiscordStatusAdapterInput>().toHaveProperty('channelName');
    expectTypeOf<DiscordStatusAdapterInput>().toHaveProperty('lifecycleFailurePhase');
    expectTypeOf<DiscordStatusAdapterInput>().toHaveProperty('transportKind');
  });

  it('rejects threadId payload routing while retaining envelope recipients', () => {
    const payloadRejectsThreadId: Assert<RejectsThreadId<DiscordNotificationPayload>> = true;
    const notification: DiscordNotificationDispatchRequest = {
      channel: 'discord',
      payload: { content: 'Deploy finished.' },
      recipients: ['thread-release'],
    };

    expect(payloadRejectsThreadId).toBe(true);
    expect(notification.recipients).toEqual(['thread-release']);
  });

  it('keeps internal normalized options token hidden from the root barrel', () => {
    expect(discordPublicApi).not.toHaveProperty('createDiscordProviders');
    expect(discordPublicApi).not.toHaveProperty('DISCORD');
    expect(discordPublicApi).not.toHaveProperty('DISCORD_OPTIONS');
    expect(discordPublicApi).not.toHaveProperty('NormalizedDiscordModuleOptions');
  });
});
