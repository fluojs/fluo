import { describe, expect, expectTypeOf, it } from 'vitest';

import * as slackPublicApi from './index.js';
import type {
  Slack,
  SlackFetchLike,
  SlackMessage,
  SlackModuleOptions,
  SlackNotificationDispatchRequest,
  SlackStatusAdapterInput,
  SlackTemplateRenderer,
  SlackTransport,
  SlackTransportFactory,
  SlackWebhookTransportOptions,
} from './index.js';

describe('@fluojs/slack public API surface', () => {
  it('keeps documented root-barrel exports stable', () => {
    expect(slackPublicApi).toHaveProperty('SlackModule');
    expect(slackPublicApi).toHaveProperty('createSlackProviders');
    expect(slackPublicApi).toHaveProperty('createSlackWebhookTransport');
    expect(slackPublicApi).toHaveProperty('SlackService');
    expect(slackPublicApi).toHaveProperty('SlackChannel');
    expect(slackPublicApi).toHaveProperty('SLACK');
    expect(slackPublicApi).toHaveProperty('SLACK_CHANNEL');
    expect(slackPublicApi).toHaveProperty('createSlackPlatformStatusSnapshot');
    expect(slackPublicApi).toHaveProperty('SlackConfigurationError');
    expect(slackPublicApi).toHaveProperty('SlackMessageValidationError');
    expect(slackPublicApi).toHaveProperty('SlackTransportError');
  });

  it('keeps documented TypeScript-only contracts stable enough for downstream packages', () => {
    expectTypeOf<SlackMessage>().toHaveProperty('text');
    expectTypeOf<SlackMessage>().toHaveProperty('blocks');
    expectTypeOf<SlackTransport>().toHaveProperty('send');
    expectTypeOf<Slack>().toHaveProperty('send');
    expectTypeOf<Slack>().toHaveProperty('sendMany');
    expectTypeOf<Slack>().toHaveProperty('sendNotification');
    expectTypeOf<SlackModuleOptions>().toHaveProperty('defaultChannel');
    expectTypeOf<SlackModuleOptions>().toHaveProperty('transport');
    expectTypeOf<SlackTransportFactory>().toHaveProperty('create');
    expectTypeOf<SlackNotificationDispatchRequest>().toHaveProperty('channel');
    expectTypeOf<SlackWebhookTransportOptions>().toHaveProperty('webhookUrl');
    expectTypeOf<SlackFetchLike>().toBeFunction();
    expectTypeOf<SlackTemplateRenderer>().toHaveProperty('render');
    expectTypeOf<SlackStatusAdapterInput>().toHaveProperty('channelName');
    expectTypeOf<SlackStatusAdapterInput>().toHaveProperty('transportKind');
  });

  it('keeps internal normalized options token hidden from the root barrel', () => {
    expect(slackPublicApi).not.toHaveProperty('SLACK_OPTIONS');
    expect(slackPublicApi).not.toHaveProperty('NormalizedSlackModuleOptions');
  });
});
