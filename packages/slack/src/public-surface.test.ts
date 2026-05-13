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

    expect(readme).toContain('Prefer `SlackModule.forRoot(...)` or `SlackModule.forRootAsync(...)` for application-facing registration. `createSlackProviders(...)` remains a low-level compatibility helper for wrapper modules that must assemble the same normalized providers manually.');
    expect(readme).toContain('The helper preserves the same `SLACK`, `SLACK_CHANNEL`, and `SlackService` wiring that `SlackModule.forRoot(...)` installs.');
    expect(koreanReadme).toContain('애플리케이션-facing 등록에는 `SlackModule.forRoot(...)` 또는 `SlackModule.forRootAsync(...)`를 우선 사용하세요. `createSlackProviders(...)`는 동일하게 정규화된 provider를 직접 조합해야 하는 wrapper module을 위한 low-level compatibility helper로 유지됩니다.');
    expect(koreanReadme).toContain('이 helper는 `SlackModule.forRoot(...)`가 구성하는 `SLACK`, `SLACK_CHANNEL`, `SlackService` wiring을 동일하게 유지합니다.');
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
