import { BunHttpApplicationAdapter } from '@fluojs/platform-bun';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { SocketIoLifecycleService } from './adapter.js';
import { SocketIoModule } from './module.js';

describe('SocketIoLifecycleService official Bun shutdown', () => {
  it('clears a pre-listen binding when a later application bootstrap hook fails', async () => {
    const adapter = new BunHttpApplicationAdapter();

    class FailingBootstrapHook {
      onApplicationBootstrap() {
        throw new Error('later bootstrap hook failed');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [SocketIoModule.forRoot()],
      providers: [FailingBootstrapHook],
    });

    await expect(bootstrapApplication({
      adapter,
      logger: {
        debug() {},
        error() {},
        log() {},
        warn() {},
      },
      rootModule: AppModule,
    })).rejects.toThrow('later bootstrap hook failed');

    expect(adapter.getServer()).toBeUndefined();
    expect(Reflect.get(adapter, 'realtimeBinding')).toBeUndefined();
  });

  it('leaves live binding cleanup to the Bun adapter close boundary', async () => {
    const adapter = new BunHttpApplicationAdapter();
    const capability = adapter.getRealtimeCapability();
    const installBinding = capability.bindingInstallation?.install;

    if (installBinding === undefined) {
      throw new TypeError('Expected the official Bun adapter binding installation seam.');
    }

    installBinding({
      fetch: async () => undefined,
      websocket: {},
    });

    const service = new SocketIoLifecycleService(
      {} as never,
      [] as never,
      {
        debug() {},
        error() {},
        log() {},
        warn() {},
      } as never,
      adapter,
      { shutdown: { timeoutMs: 100 } },
    );
    const io = {
      close(callback?: () => void) {
        callback?.();
      },
      disconnectSockets() {},
    };
    const server = {
      stop: vi.fn(),
      upgrade: () => false,
    };

    Reflect.set(service, 'io', io);
    Reflect.set(service, 'realtimeBindingInstallation', capability.bindingInstallation);
    Reflect.set(adapter, 'server', server);

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    expect(Reflect.get(adapter, 'realtimeBinding')).toBeDefined();

    await expect(adapter.close()).resolves.toBeUndefined();

    expect(server.stop).toHaveBeenCalledOnce();
    expect(Reflect.get(adapter, 'realtimeBinding')).toBeUndefined();
  });
});
