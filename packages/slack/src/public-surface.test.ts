import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

  it('keeps the README helper contract aligned with the documented root-barrel API', () => {
    const readme = readFileSync(resolve(import.meta.dirname, '../README.md'), 'utf8');
    const koreanReadme = readFileSync(resolve(import.meta.dirname, '../README.ko.md'), 'utf8');

    expect(readme).toContain('`createSlackProviders(...)` is the supported manual-composition helper when applications need the same provider normalization outside `SlackModule.forRoot(...)`.');
    expect(readme).toContain('The helper preserves the same `SLACK`, `SLACK_CHANNEL`, and `SlackService` wiring that `SlackModule.forRoot(...)` installs.');
    expect(koreanReadme).toContain('`createSlackProviders(...)`는 애플리케이션이 `SlackModule.forRoot(...)` 밖에서 동일한 provider 정규화 구성을 재사용해야 할 때 지원되는 manual-composition helper입니다.');
    expect(koreanReadme).toContain('이 helper는 `SlackModule.forRoot(...)`가 구성하는 `SLACK`, `SLACK_CHANNEL`, `SlackService` wiring을 동일하게 유지합니다.');
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
