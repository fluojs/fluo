import { Inject } from '@fluojs/core';
import { defineModuleMetadata } from '@fluojs/core/internal';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { EventPattern } from './decorators.js';
import { MicroservicesModule } from './module.js';
import type { MicroserviceTransport, TransportHandler } from './types.js';

describe('provider-token handler discovery', () => {
  it('discovers event handlers registered under distinct provider tokens', async () => {
    // Given
    let handler: TransportHandler | undefined;
    const transport: MicroserviceTransport = {
      async close() {},
      async emit(pattern, payload) {
        if (!handler) {
          throw new Error('Transport handler is not listening.');
        }

        await handler({ kind: 'event', pattern, payload });
      },
      async listen(nextHandler) {
        handler = nextHandler;
      },
      async send() {
        return undefined;
      },
    };
    const firstHandlerToken = Symbol('first-handler');
    const secondHandlerToken = Symbol('second-handler');

    class DeliveryTracker {
      readonly instances: unknown[] = [];
    }

    @Inject(DeliveryTracker)
    class MirroredEventHandler {
      constructor(private readonly tracker: DeliveryTracker) {}

      @EventPattern('audit.mirrored')
      handle() {
        this.tracker.instances.push(this);
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [
        DeliveryTracker,
        { provide: firstHandlerToken, useClass: MirroredEventHandler },
        { provide: secondHandlerToken, useClass: MirroredEventHandler },
      ],
    });

    const microservice = await FluoFactory.createMicroservice(AppModule);
    await microservice.listen();

    // When
    await microservice.emit('audit.mirrored', {});

    // Then
    const tracker = await microservice.get(DeliveryTracker);
    expect(tracker.instances).toHaveLength(2);
    expect(new Set(tracker.instances)).toHaveLength(2);

    await microservice.close();
  });
});
