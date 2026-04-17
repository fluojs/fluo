import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as emailPublicApi from './index.js';
import type {
  Email,
  EmailMessage,
  EmailModuleOptions,
  EmailNotificationDispatchRequest,
  EmailStatusAdapterInput,
  EmailTransport,
  EmailTransportFactory,
} from './index.js';
import * as emailQueuePublicApi from './queue-entry.js';
import type { EmailQueueWorkerOptions } from './queue-entry.js';

describe('@fluojs/email public API surface', () => {
  it('keeps documented root-barrel exports stable', () => {
    expect(emailPublicApi).toHaveProperty('EmailModule');
    expect(emailPublicApi).toHaveProperty('createEmailProviders');
    expect(emailPublicApi).toHaveProperty('EmailService');
    expect(emailPublicApi).toHaveProperty('EmailChannel');
    expect(emailPublicApi).toHaveProperty('EMAIL');
    expect(emailPublicApi).toHaveProperty('EMAIL_CHANNEL');
    expect(emailPublicApi).toHaveProperty('createEmailPlatformStatusSnapshot');
    expect(emailPublicApi).toHaveProperty('EmailConfigurationError');
    expect(emailPublicApi).toHaveProperty('EmailMessageValidationError');
  });

  it('keeps queue integration exports isolated behind the queue subpath', () => {
    expect(emailPublicApi).not.toHaveProperty('createEmailNotificationsQueueAdapter');
    expect(emailPublicApi).not.toHaveProperty('DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS');
    expect(emailQueuePublicApi).toHaveProperty('createEmailNotificationsQueueAdapter');
    expect(emailQueuePublicApi).toHaveProperty('DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS');
    expectTypeOf<EmailQueueWorkerOptions>().toHaveProperty('attempts');
    expectTypeOf<EmailQueueWorkerOptions>().toHaveProperty('concurrency');
  });

  it('keeps queue install requirements behind an optional peer dependency', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };

    expect(packageJson.dependencies).not.toHaveProperty('@fluojs/queue');
    expect(packageJson.dependencies).not.toHaveProperty('nodemailer');
    expect(packageJson.peerDependencies).toMatchObject({
      '@fluojs/queue': 'workspace:^',
      nodemailer: '^6.10.1',
    });
    expect(packageJson.peerDependenciesMeta).toMatchObject({
      '@fluojs/queue': {
        optional: true,
      },
      nodemailer: {
        optional: true,
      },
    });
  });

  it('keeps the README helper contract aligned with the documented root-barrel API', () => {
    const readme = readFileSync(resolve(import.meta.dirname, '../README.md'), 'utf8');
    const koreanReadme = readFileSync(resolve(import.meta.dirname, '../README.ko.md'), 'utf8');

    expect(readme).toContain('`createEmailProviders(...)` is the supported manual-composition helper when applications need the same provider normalization outside `EmailModule.forRoot(...)`.');
    expect(readme).toContain('The helper preserves the same `EMAIL`, `EMAIL_CHANNEL`, and `EmailService` wiring that `EmailModule.forRoot(...)` installs.');
    expect(koreanReadme).toContain('`createEmailProviders(...)`는 애플리케이션이 `EmailModule.forRoot(...)` 밖에서 동일한 provider 정규화 구성을 재사용해야 할 때 지원되는 manual-composition helper입니다.');
    expect(koreanReadme).toContain('이 helper는 `EmailModule.forRoot(...)`가 구성하는 `EMAIL`, `EMAIL_CHANNEL`, `EmailService` wiring을 동일하게 유지합니다.');
  });

  it('keeps documented TypeScript-only contracts stable enough for downstream packages', () => {
    expectTypeOf<EmailMessage>().toHaveProperty('to');
    expectTypeOf<EmailMessage>().toHaveProperty('subject');
    expectTypeOf<EmailTransport>().toHaveProperty('send');
    expectTypeOf<Email>().toHaveProperty('send');
    expectTypeOf<Email>().toHaveProperty('sendMany');
    expectTypeOf<Email>().toHaveProperty('sendNotification');
    expectTypeOf<EmailModuleOptions>().toHaveProperty('defaultFrom');
    expectTypeOf<EmailModuleOptions>().toHaveProperty('transport');
    expectTypeOf<EmailModuleOptions>().toHaveProperty('verifyOnModuleInit');
    expectTypeOf<EmailTransportFactory>().toHaveProperty('create');
    expectTypeOf<EmailTransportFactory>().toHaveProperty('kind');
    expectTypeOf<EmailNotificationDispatchRequest>().toHaveProperty('channel');
    expectTypeOf<EmailStatusAdapterInput>().toHaveProperty('channelName');
    expectTypeOf<EmailStatusAdapterInput>().toHaveProperty('lifecycleState');
    expectTypeOf<EmailStatusAdapterInput>().toHaveProperty('transportKind');
  });

  it('keeps internal normalized options token hidden from the root barrel', () => {
    expect(emailPublicApi).not.toHaveProperty('EMAIL_OPTIONS');
    expect(emailPublicApi).not.toHaveProperty('NormalizedEmailModuleOptions');
    expect(emailPublicApi).not.toHaveProperty('EmailNotificationQueueJob');
    expect(emailPublicApi).not.toHaveProperty('NodemailerEmailTransport');
    expect(emailPublicApi).not.toHaveProperty('createNodemailerEmailTransport');
    expect(emailPublicApi).not.toHaveProperty('createNodemailerEmailTransportFactory');
  });
});
