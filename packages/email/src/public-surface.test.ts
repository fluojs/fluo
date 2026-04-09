import { describe, expect, expectTypeOf, it } from 'vitest';

import * as emailPublicApi from './index.js';
import type {
  Email,
  EmailMessage,
  EmailModuleOptions,
  EmailNotificationDispatchRequest,
  EmailQueueWorkerOptions,
  EmailStatusAdapterInput,
  EmailTransport,
  EmailTransportFactory,
} from './index.js';

describe('@konekti/email public API surface', () => {
  it('keeps documented root-barrel exports stable', () => {
    expect(emailPublicApi).toHaveProperty('EmailModule');
    expect(emailPublicApi).toHaveProperty('createEmailProviders');
    expect(emailPublicApi).toHaveProperty('EmailService');
    expect(emailPublicApi).toHaveProperty('EmailChannel');
    expect(emailPublicApi).toHaveProperty('EMAIL');
    expect(emailPublicApi).toHaveProperty('EMAIL_CHANNEL');
    expect(emailPublicApi).toHaveProperty('createEmailNotificationsQueueAdapter');
    expect(emailPublicApi).toHaveProperty('DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS');
    expect(emailPublicApi).toHaveProperty('createEmailPlatformStatusSnapshot');
    expect(emailPublicApi).toHaveProperty('EmailConfigurationError');
    expect(emailPublicApi).toHaveProperty('EmailMessageValidationError');
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
    expectTypeOf<EmailQueueWorkerOptions>().toHaveProperty('attempts');
    expectTypeOf<EmailQueueWorkerOptions>().toHaveProperty('concurrency');
    expectTypeOf<EmailStatusAdapterInput>().toHaveProperty('channelName');
    expectTypeOf<EmailStatusAdapterInput>().toHaveProperty('lifecycleState');
    expectTypeOf<EmailStatusAdapterInput>().toHaveProperty('transportKind');
  });

  it('keeps internal normalized options token hidden from the root barrel', () => {
    expect(emailPublicApi).not.toHaveProperty('EMAIL_OPTIONS');
    expect(emailPublicApi).not.toHaveProperty('NormalizedEmailModuleOptions');
    expect(emailPublicApi).not.toHaveProperty('EmailNotificationQueueJob');
  });
});
