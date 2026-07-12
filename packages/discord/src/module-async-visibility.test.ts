import { Inject } from '@fluojs/core';
import { NotificationsModule, NotificationsService } from '@fluojs/notifications';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import type { DiscordChannel } from './channel.js';
import { DiscordModule } from './module.js';
import { DiscordService } from './service.js';
import { DISCORD_CHANNEL } from './tokens.js';
import type { DiscordTransport, NormalizedDiscordMessage } from './types.js';

function createRecordingTransport(sent: NormalizedDiscordMessage[]): DiscordTransport {
  return {
    async send(message) {
      sent.push(message);
      return { messageId: `message-${sent.length}`, ok: true, threadId: message.threadId, warnings: [] };
    },
  };
}

describe('DiscordModule async visibility', () => {
  it('exposes default-global async providers across a real notifications module graph', async () => {
    const sent: NormalizedDiscordMessage[] = [];

    @Inject(DiscordService)
    class AsyncDiscordConsumer {
      constructor(readonly discord: DiscordService) {}
    }

    class AsyncDiscordOwnerModule {}
    defineModule(AsyncDiscordOwnerModule, {
      imports: [
        DiscordModule.forRootAsync({
          useFactory: async () => ({
            notifications: { channel: 'async-alerts' },
            transport: createRecordingTransport(sent),
          }),
        }),
      ],
    });

    class AsyncNotificationsOwnerModule {}
    defineModule(AsyncNotificationsOwnerModule, {
      imports: [
        NotificationsModule.forRootAsync({
          inject: [DISCORD_CHANNEL],
          useFactory: (channel: unknown) => ({ channels: [channel as DiscordChannel] }),
        }),
      ],
      providers: [AsyncDiscordConsumer],
    });

    class AsyncAppModule {}
    defineModule(AsyncAppModule, {
      imports: [AsyncDiscordOwnerModule, AsyncNotificationsOwnerModule],
    });

    const app = await bootstrapApplication({ rootModule: AsyncAppModule });

    try {
      const consumer = await app.container.resolve(AsyncDiscordConsumer);
      const notifications = await app.container.resolve(NotificationsService);
      const result = await notifications.dispatch({
        channel: 'async-alerts',
        payload: { content: 'Async global graph delivery' },
        recipients: ['thread-release'],
      });

      expect(consumer.discord).toBeInstanceOf(DiscordService);
      expect(result).toMatchObject({ deliveryId: 'message-1', status: 'delivered' });
      expect(sent[0]).toMatchObject({ content: 'Async global graph delivery', threadId: 'thread-release' });
    } finally {
      await app.close();
    }
  });

  it('keeps global=false async providers local to explicit importers', async () => {
    @Inject(DiscordService)
    class LocalAsyncDiscordConsumer {
      constructor(readonly discord: DiscordService) {}
    }

    class LocalAsyncDiscordFeatureModule {}
    defineModule(LocalAsyncDiscordFeatureModule, {
      imports: [
        DiscordModule.forRootAsync({
          global: false,
          useFactory: async () => ({ transport: createRecordingTransport([]) }),
        }),
      ],
      providers: [LocalAsyncDiscordConsumer],
    });

    class LocalAsyncAppModule {}
    defineModule(LocalAsyncAppModule, { imports: [LocalAsyncDiscordFeatureModule] });

    const localApp = await bootstrapApplication({ rootModule: LocalAsyncAppModule });

    try {
      const consumer = await localApp.container.resolve(LocalAsyncDiscordConsumer);
      await expect(consumer.discord.send({ content: 'Local async graph delivery' })).resolves.toMatchObject({
        ok: true,
      });
    } finally {
      await localApp.close();
    }

    @Inject(DiscordService)
    class HiddenAsyncDiscordConsumer {
      constructor(readonly discord: DiscordService) {}
    }

    class HiddenAsyncDiscordOwnerModule {}
    defineModule(HiddenAsyncDiscordOwnerModule, {
      imports: [
        DiscordModule.forRootAsync({
          global: false,
          useFactory: async () => ({ transport: createRecordingTransport([]) }),
        }),
      ],
    });

    class HiddenAsyncConsumerModule {}
    defineModule(HiddenAsyncConsumerModule, { providers: [HiddenAsyncDiscordConsumer] });

    class HiddenAsyncAppModule {}
    defineModule(HiddenAsyncAppModule, {
      imports: [HiddenAsyncDiscordOwnerModule, HiddenAsyncConsumerModule],
    });

    await expect(bootstrapApplication({ rootModule: HiddenAsyncAppModule })).rejects.toThrow(
      /not visible through a global module|DiscordService/,
    );
  });
});
