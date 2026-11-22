import { Inject, Module, type Token } from '@fluojs/core';
import { FluoFactory, type ModuleType, ModuleVisibilityError } from '@fluojs/runtime';
import {
  APPLICATION_LOGGER,
  COMPILED_MODULES,
  HTTP_APPLICATION_ADAPTER,
  RUNTIME_CONTAINER,
} from '@fluojs/runtime/internal';
import { Test } from '@fluojs/testing/module';
import { describe, expect, it } from 'vitest';

import { BunWebSocketGatewayLifecycleService, BunWebSocketModule } from './bun.js';
import {
  CloudflareWorkersWebSocketGatewayLifecycleService,
  CloudflareWorkersWebSocketModule,
} from './cloudflare-workers.js';
import { NodeWebSocketGatewayLifecycleService, NodeWebSocketModule } from './node.js';
import { WEBSOCKET_OPTIONS_INTERNAL } from './options-token.internal.js';
import type { WebSocketRoomService } from './types.js';

const runtimes: ReadonlyArray<{
  readonly name: string;
  readonly forRoot: () => ModuleType;
  readonly token: Token<WebSocketRoomService>;
}> = [
  {
    name: 'Node',
    forRoot: () => NodeWebSocketModule.forRoot(),
    token: NodeWebSocketGatewayLifecycleService,
  },
  {
    name: 'Bun',
    forRoot: () => BunWebSocketModule.forRoot(),
    token: BunWebSocketGatewayLifecycleService,
  },
  {
    name: 'Workers',
    forRoot: () => CloudflareWorkersWebSocketModule.forRoot(),
    token: CloudflareWorkersWebSocketGatewayLifecycleService,
  },
];

describe('WebSocket lifecycle consumer injection (#4161)', () => {
  it.each(runtimes)('$name forRoot: consumer injection shares the registered lifecycle instance', async ({
    forRoot,
    token,
  }) => {
    @Inject(token)
    class PresenceService {
      constructor(readonly rooms: WebSocketRoomService) {}
    }

    @Module({ imports: [forRoot()], providers: [PresenceService] })
    class ConsumerModule {}

    const app = await FluoFactory.create(ConsumerModule);

    try {
      const presence = await app.container.resolve(PresenceService);
      expect(presence.rooms).toBe(await app.container.resolve(token));

      // Test.createTestingModule hosts the production graph with explicit
      // runtime context; it does not create an HTTP application shell itself.
      const module = await Test.createTestingModule({
        rootModule: ConsumerModule,
        providers: await Promise.all(
          [RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, HTTP_APPLICATION_ADAPTER].map(async (provide) => ({
            provide,
            useValue: await app.container.resolve<unknown>(provide),
          })),
        ),
      }).compile();

      try {
        const testingPresence = await module.resolve(PresenceService);
        const consumer = module.modules.find((entry) => entry.type === ConsumerModule);

        expect(testingPresence.rooms).toBe(await module.container.resolve(token));
        expect(consumer?.importedExportedTokens).toEqual(new Set([token]));
        expect(consumer?.importedExportedTokens.has(WEBSOCKET_OPTIONS_INTERNAL)).toBe(false);
      } finally {
        await module.container.dispose();
      }
    } finally {
      await app.close();
    }
  });

  it.each(runtimes)('$name forRoot: consumer injection keeps internal options private', async ({ forRoot }) => {
    @Inject(WEBSOCKET_OPTIONS_INTERNAL)
    class InternalOptionsConsumer {
      constructor(readonly options: unknown) {}
    }

    @Module({
      imports: [forRoot()],
      providers: [InternalOptionsConsumer],
    })
    class ConsumerModule {}

    await expect(FluoFactory.create(ConsumerModule)).rejects.toThrow(ModuleVisibilityError);
  });
});
