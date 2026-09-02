import { defineModule, bootstrapApplication } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { OnEvent } from './decorators.js';
import { EventBusModule } from './module.js';
import { EventBusLifecycleService } from './service.js';

class ReplacedProviderEvent {}

class EffectiveProviderEvent {}

describe('EventBusLifecycleService effective provider discovery', () => {
  it('discovers only the effective winner for duplicate provider tokens', async () => {
    const handlerToken = Symbol('event-handler');
    const calls: string[] = [];

    class ReplacedHandler {
      @OnEvent(ReplacedProviderEvent)
      onReplaced(): void {
        calls.push('replaced');
      }
    }

    class EffectiveHandler {
      @OnEvent(EffectiveProviderEvent)
      onEffective(): void {
        calls.push('effective');
      }
    }

    class ImportedModule {}
    defineModule(ImportedModule, {
      providers: [{ provide: handlerToken, useClass: ReplacedHandler }],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [ImportedModule, EventBusModule.forRoot()],
      providers: [{ provide: handlerToken, useClass: EffectiveHandler }],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const eventBus = await app.container.resolve(EventBusLifecycleService);

      expect(eventBus.createPlatformStatusSnapshot().details.handlersDiscovered).toBe(1);

      await eventBus.publish(new EffectiveProviderEvent());

      expect(calls).toEqual(['effective']);
    } finally {
      await app.close();
    }
  });
});
