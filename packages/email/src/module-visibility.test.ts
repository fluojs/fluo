import { Inject, Module } from '@fluojs/core';
import { createTestingModule } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { EmailChannel } from './channel.js';
import { EmailModule } from './module.js';
import { EmailService } from './service.js';
import { EMAIL_CHANNEL } from './tokens.js';
import type { EmailTransport, EmailTransportFactory } from './types.js';

class VisibilityTestTransport implements EmailTransport {
  async send(): Promise<{ accepted: string[]; messageId: string; pending: []; rejected: [] }> {
    return {
      accepted: ['visible@example.com'],
      messageId: 'visibility-test',
      pending: [],
      rejected: [],
    };
  }
}

const visibilityTestTransportFactory = {
  create: () => new VisibilityTestTransport(),
  kind: 'visibility-test',
  ownsResources: false,
} satisfies EmailTransportFactory;

describe('EmailModule provider visibility', () => {
  it('makes EmailService and EMAIL_CHANNEL visible through a compiled module graph by default', async () => {
    @Inject(EmailService, EMAIL_CHANNEL)
    class RootEmailProbe {
      constructor(
        readonly email: EmailService,
        readonly channel: EmailChannel,
      ) {}
    }

    @Module({
      imports: [EmailModule.forRoot({ transport: visibilityTestTransportFactory })],
    })
    class EmailOwnerModule {}

    @Module({
      imports: [EmailOwnerModule],
      providers: [RootEmailProbe],
    })
    class AppModule {}

    const testingModule = await createTestingModule({ rootModule: AppModule }).compile();

    try {
      const probe = await testingModule.resolve(RootEmailProbe);

      expect(probe.email).toBeInstanceOf(EmailService);
      expect(probe.channel).toBeInstanceOf(EmailChannel);
      expect(probe.channel.channel).toBe('email');
    } finally {
      await testingModule.container.dispose();
    }
  });

  it('keeps EmailService hidden from root providers when global visibility is disabled', async () => {
    @Inject(EmailService)
    class RootEmailServiceProbe {
      constructor(readonly email: EmailService) {}
    }

    @Module({
      imports: [EmailModule.forRoot({ global: false, transport: visibilityTestTransportFactory })],
    })
    class EmailOwnerModule {}

    @Module({
      imports: [EmailOwnerModule],
      providers: [RootEmailServiceProbe],
    })
    class AppModule {}

    await expect(createTestingModule({ rootModule: AppModule }).compile()).rejects.toThrow(
      /not visible through a global module|EmailService/,
    );
  });

  it('keeps EMAIL_CHANNEL hidden from root providers when global visibility is disabled', async () => {
    @Inject(EMAIL_CHANNEL)
    class RootEmailChannelProbe {
      constructor(readonly channel: EmailChannel) {}
    }

    @Module({
      imports: [EmailModule.forRoot({ global: false, transport: visibilityTestTransportFactory })],
    })
    class EmailOwnerModule {}

    @Module({
      imports: [EmailOwnerModule],
      providers: [RootEmailChannelProbe],
    })
    class AppModule {}

    await expect(createTestingModule({ rootModule: AppModule }).compile()).rejects.toThrow(
      /not visible through a global module|fluo.email.channel/,
    );
  });
});
