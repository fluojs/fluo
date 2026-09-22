import { Inject } from '@fluojs/core';
import {
  EMAIL_CHANNEL,
  EmailChannel,
  EmailLifecycleError,
  type EmailMessage,
  EmailMessageValidationError,
  EmailModule,
  EmailService,
  type EmailTemplateRenderer,
  type EmailTransport,
  type EmailTransportContext,
  type EmailTransportReceipt,
  type NormalizedEmailMessage,
} from '@fluojs/email';
import { type NotificationChannel, NotificationsModule, NotificationsService } from '@fluojs/notifications';
import { defineModule, FluoFactory, type ModuleType } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

/**
 * @fluojs/email guide evidence: normalization and validation, template
 * fallback precedence, the notifications channel contract (including
 * incomplete-delivery failure semantics), tolerant batch sends, and the
 * shutdown lifecycle gate - recording transports only, no network, no sleeps.
 */

class RecordingTransport implements EmailTransport {
  readonly sent: NormalizedEmailMessage[] = [];

  constructor(private readonly receipt: Partial<EmailTransportReceipt> = {}) {}

  async send(message: NormalizedEmailMessage, _context: EmailTransportContext): Promise<EmailTransportReceipt> {
    this.sent.push(message);
    return {
      accepted: message.to.map((entry) => entry.address),
      messageId: 'smtp-1',
      ...this.receipt,
    };
  }
}

const renderer: EmailTemplateRenderer = {
  render({ payload, template }) {
    const name = typeof payload.templateData?.name === 'string' ? payload.templateData.name : 'customer';
    return {
      html: `<h1>Welcome ${name}</h1>`,
      subject: template === 'welcome' ? `Welcome, ${name}` : template,
      text: `Hello, ${name}`,
    };
  },
};

function buildAppModule(options: {
  transport: EmailTransport;
  defaultFrom?: string;
  withRenderer?: boolean;
}): ModuleType {
  class EmailAppModule {}

  return defineModule(EmailAppModule, {
    imports: [
      EmailModule.forRoot({
        ...(options.defaultFrom ? { defaultFrom: options.defaultFrom } : {}),
        ...(options.withRenderer ? { renderer } : {}),
        transport: options.transport,
      }),
    ],
  });
}

async function withApplicationContext<T>(
  module: ModuleType,
  run: (context: Awaited<ReturnType<typeof FluoFactory.createApplicationContext>>) => Promise<T>,
): Promise<T> {
  const context = await FluoFactory.createApplicationContext(module);
  try {
    return await run(context);
  } finally {
    await context.close();
  }
}

describe('@fluojs/email guide examples', () => {
  it('normalizes sender defaults, validates the message, and returns the transport receipt', async () => {
    const transport = new RecordingTransport();
    await withApplicationContext(buildAppModule({ transport, defaultFrom: 'noreply@example.com' }), async (context) => {
      const email = await context.get(EmailService);

      const receipt = await email.send({
        subject: 'Welcome',
        text: 'Your account is ready.',
        to: ['dev@example.com'],
      });

      expect(receipt).toMatchObject({ accepted: ['dev@example.com'], messageId: 'smtp-1' });
      expect(transport.sent[0]?.from).toEqual({ address: 'noreply@example.com' });
      expect(transport.sent[0]?.to).toEqual([{ address: 'dev@example.com' }]);
    });
  });

  it('rejects undeliverable messages before any transport work', async () => {
    const transport = new RecordingTransport();
    await withApplicationContext(buildAppModule({ transport, defaultFrom: 'noreply@example.com' }), async (context) => {
      const email = await context.get(EmailService);

      await expect(email.send({ subject: 'No content', to: ['dev@example.com'] })).rejects.toBeInstanceOf(
        EmailMessageValidationError,
      );
      await expect(email.send({ text: 'No recipient', to: [] })).rejects.toBeInstanceOf(EmailMessageValidationError);
      expect(transport.sent).toHaveLength(0);
    });
  });

  it('treats rendered template output as fallback behind explicit payload fields', async () => {
    const transport = new RecordingTransport();
    await withApplicationContext(
      buildAppModule({ transport, defaultFrom: 'noreply@example.com', withRenderer: true }),
      async (context) => {
        const email = await context.get(EmailService);

        await email.sendNotification({
          channel: 'email',
          recipients: ['dev@example.com'],
          template: 'welcome',
          payload: { templateData: { name: 'Ada' } },
        });
        await email.sendNotification({
          channel: 'email',
          recipients: ['dev@example.com'],
          subject: 'Account ready',
          template: 'welcome',
          payload: { templateData: { name: 'Ada' }, text: 'Use this exact message.' },
        });

        expect(transport.sent[0]?.text).toBe('Hello, Ada');
        expect(transport.sent[0]?.subject).toBe('Welcome, Ada');
        expect(transport.sent[0]?.metadata?.template).toBe('welcome');
        // Explicit notification subject and payload text override the renderer.
        expect(transport.sent[1]?.subject).toBe('Account ready');
        expect(transport.sent[1]?.text).toBe('Use this exact message.');
      },
    );
  });

  it('routes notifications dispatches through EmailChannel and fails incomplete deliveries', async () => {
    const transport = new RecordingTransport({ rejected: ['bounced@example.com'] });

    class RoutedAppModule {}

    await withApplicationContext(
      defineModule(RoutedAppModule, {
        imports: [
          buildAppModule({ transport, defaultFrom: 'noreply@example.com' }),
          NotificationsModule.forRootAsync({
            inject: [EMAIL_CHANNEL],
            useFactory: (...deps: unknown[]) => ({ channels: deps as NotificationChannel[] }),
          }),
        ],
      }),
      async (context) => {
        const notifications = await context.get(NotificationsService);

        await expect(
          notifications.dispatch({
            channel: 'email',
            recipients: ['bounced@example.com'],
            subject: 'Partial failure',
            payload: { text: 'hi' },
          }),
        ).rejects.toThrow(/incomplete delivery/iu);
        expect(transport.sent).toHaveLength(1);
      },
    );
  });

  it('collects batch failures with continueOnError', async () => {
    const transport = new RecordingTransport();
    await withApplicationContext(buildAppModule({ transport, defaultFrom: 'noreply@example.com' }), async (context) => {
      const email = await context.get(EmailService);

      const messages: EmailMessage[] = [
        { subject: 'Missing body', to: ['dev@example.com'] },
        { text: 'second', to: ['dev@example.com'] },
      ];
      const batch = await email.sendMany(messages, { continueOnError: true });

      expect(batch.succeeded).toBe(1);
      expect(batch.failed).toBe(1);
      expect(batch.failures[0]?.error).toBeInstanceOf(EmailMessageValidationError);
      expect(batch.failures[0]?.message).toBe(messages[0]);
    });
  });

  it('gates delivery behind the lifecycle: sends fail with EmailLifecycleError after shutdown', async () => {
    const transport = new RecordingTransport();
    const context = await FluoFactory.createApplicationContext(
      buildAppModule({ transport, defaultFrom: 'noreply@example.com' }),
    );
    const email = await context.get(EmailService);

    try {
      await email.send({ text: 'before close', to: ['dev@example.com'] });
    } finally {
      await context.close();
    }

    await expect(email.send({ text: 'after close', to: ['dev@example.com'] })).rejects.toBeInstanceOf(
      EmailLifecycleError,
    );
  });

  it('exposes the notifications channel under EMAIL_CHANNEL with its configured name', async () => {
    const transport = new RecordingTransport();
    await withApplicationContext(buildAppModule({ transport, defaultFrom: 'noreply@example.com' }), async (context) => {
      const channelViaToken = await context.get(EMAIL_CHANNEL);
      const channel = await context.get(EmailChannel);

      expect(channelViaToken).toBe(channel);
      expect(channel.channel).toBe('email');
    });
  });
});

describe('@fluojs/email guide service injection', () => {
  it('resolves EmailService through the class-level @Inject contract', async () => {
    const transport = new RecordingTransport();

    @Inject(EmailService)
    class WelcomeService {
      constructor(private readonly email: EmailService) {}

      async sendWelcome(address: string): Promise<string> {
        const receipt = await this.email.send({
          subject: 'Welcome to fluo',
          text: 'Your account is ready.',
          to: [address],
        });
        return receipt.messageId;
      }
    }

    class InjectedAppModule {}

    await withApplicationContext(
      defineModule(InjectedAppModule, {
        imports: [buildAppModule({ transport, defaultFrom: 'noreply@example.com' })],
        providers: [WelcomeService],
      }),
      async (context) => {
        const welcome = await context.get(WelcomeService);
        expect(await welcome.sendWelcome('dev@example.com')).toBe('smtp-1');
      },
    );
  });
});
