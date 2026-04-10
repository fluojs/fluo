import { describe, expect, expectTypeOf, it } from 'vitest';

import * as discordPublicApi from './index.js';
import type {
  Discord,
  DiscordFetchLike,
  DiscordMessage,
  DiscordModuleOptions,
  DiscordNotificationDispatchRequest,
  DiscordStatusAdapterInput,
  DiscordTemplateRenderer,
  DiscordTransport,
  DiscordTransportFactory,
  DiscordWebhookTransportOptions,
} from './index.js';

describe('@fluojs/discord public API surface', () => {
  it('keeps documented root-barrel exports stable', () => {
    expect(discordPublicApi).toHaveProperty('DiscordModule');
    expect(discordPublicApi).toHaveProperty('createDiscordProviders');
    expect(discordPublicApi).toHaveProperty('createDiscordWebhookTransport');
    expect(discordPublicApi).toHaveProperty('DiscordService');
    expect(discordPublicApi).toHaveProperty('DiscordChannel');
    expect(discordPublicApi).toHaveProperty('DISCORD');
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
    expectTypeOf<Discord>().toHaveProperty('send');
    expectTypeOf<Discord>().toHaveProperty('sendMany');
    expectTypeOf<Discord>().toHaveProperty('sendNotification');
    expectTypeOf<DiscordModuleOptions>().toHaveProperty('defaultThreadId');
    expectTypeOf<DiscordModuleOptions>().toHaveProperty('transport');
    expectTypeOf<DiscordTransportFactory>().toHaveProperty('create');
    expectTypeOf<DiscordNotificationDispatchRequest>().toHaveProperty('channel');
    expectTypeOf<DiscordWebhookTransportOptions>().toHaveProperty('webhookUrl');
    expectTypeOf<DiscordFetchLike>().toBeFunction();
    expectTypeOf<DiscordTemplateRenderer>().toHaveProperty('render');
    expectTypeOf<DiscordStatusAdapterInput>().toHaveProperty('channelName');
    expectTypeOf<DiscordStatusAdapterInput>().toHaveProperty('transportKind');
  });

  it('keeps internal normalized options token hidden from the root barrel', () => {
    expect(discordPublicApi).not.toHaveProperty('DISCORD_OPTIONS');
    expect(discordPublicApi).not.toHaveProperty('NormalizedDiscordModuleOptions');
  });
});
