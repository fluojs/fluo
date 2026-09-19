import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
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
import * as slackPublicApi from './index.js';

describe('@fluojs/slack public API surface', () => {
  it('keeps documented root-barrel exports stable', () => {
    expect(slackPublicApi).toHaveProperty('SlackModule');
    expect(slackPublicApi).toHaveProperty('createSlackWebhookTransport');
    expect(slackPublicApi).toHaveProperty('SlackService');
    expect(slackPublicApi).toHaveProperty('SlackChannel');
    expect(slackPublicApi).toHaveProperty('SLACK_CHANNEL');
    expect(slackPublicApi).toHaveProperty('createSlackPlatformStatusSnapshot');
    expect(slackPublicApi).toHaveProperty('SlackConfigurationError');
    expect(slackPublicApi).toHaveProperty('SlackLifecycleError');
    expect(slackPublicApi).toHaveProperty('SlackMessageValidationError');
    expect(slackPublicApi).toHaveProperty('SlackTransportError');
  });

  it('keeps the README helper contract aligned with the documented root-barrel API', () => {
    const readme = readFileSync(resolve(import.meta.dirname, '../README.md'), 'utf8');
    const koreanReadme = readFileSync(resolve(import.meta.dirname, '../README.ko.md'), 'utf8');

    expect(readme).not.toContain('createSlackProviders');
    expect(readme).not.toContain('`SLACK`');
    expect(koreanReadme).not.toContain('createSlackProviders');
    expect(koreanReadme).not.toContain('`SLACK`');
  });

  it('keeps the Slack tutorial lifecycle snapshot examples aligned with the service contract', () => {
    const tutorial = readFileSync(resolve(import.meta.dirname, '../../../book/intermediate/ch17-slack-discord.md'), 'utf8');
    const koreanTutorial = readFileSync(
      resolve(import.meta.dirname, '../../../book/intermediate/ch17-slack-discord.ko.md'),
      'utf8',
    );

    expect(tutorial).toContain('const slackStatus = slackService.createPlatformStatusSnapshot();');
    expect(tutorial).toContain("if (slackStatus.readiness.status !== 'ready') {");
    expect(koreanTutorial).toContain('const slackStatus = slackService.createPlatformStatusSnapshot();');
    expect(koreanTutorial).toContain("if (slackStatus.readiness.status !== 'ready') {");
    expect(tutorial).not.toContain('createSlackPlatformStatusSnapshot(slackService)');
    expect(koreanTutorial).not.toContain('createSlackPlatformStatusSnapshot(slackService)');
    expect(tutorial).not.toContain('slackStatus.isReady');
    expect(koreanTutorial).not.toContain('slackStatus.isReady');
  });

  it('keeps documented TypeScript-only contracts stable enough for downstream packages', () => {
    expectTypeOf<SlackMessage>().toHaveProperty('text');
    expectTypeOf<SlackMessage>().toHaveProperty('blocks');
    expectTypeOf<SlackTransport>().toHaveProperty('send');
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
    expect(slackPublicApi).not.toHaveProperty('SLACK');
    expect(slackPublicApi).not.toHaveProperty('createSlackProviders');
    expect(slackPublicApi).not.toHaveProperty('NormalizedSlackModuleOptions');
  });

  it('keeps named-client migration helpers outside the singleton root barrel', () => {
    expect(slackPublicApi.SlackModule).not.toHaveProperty('forFeature');
    expect(slackPublicApi).not.toHaveProperty('createSlackClientToken');
    expect(slackPublicApi).not.toHaveProperty('getSlackClientToken');
    expect(slackPublicApi).not.toHaveProperty('SLACK_CLIENTS');
    expect(slackPublicApi).not.toHaveProperty('SlackClientRegistry');
  });
});
