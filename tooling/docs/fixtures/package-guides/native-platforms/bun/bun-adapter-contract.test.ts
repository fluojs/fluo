import { Module } from '@fluojs/core';
import { Get } from '@fluojs/http';
import { BunHttpApplicationAdapter } from '@fluojs/platform-bun';
import { FluoFactory, type ModuleType } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

class HealthController {
  @Get('/status')
  status(): { status: string } {
    return { status: 'ok' };
  }
}

@Module({
  controllers: [HealthController],
})
class AppModule {}

/**
 * Contract-level checks that run under Node.js, where no Bun global exists.
 * They exercise the public package surface (adapter factory + Factory) and the
 * documented diagnostic codes without any Bun test double. Native Bun behavior
 * (real Bun.serve, signals, drain) is covered by bun-native.test.ts.
 */
describe('@fluojs/platform-bun contract under Node.js', () => {
  it('rejects invalid numeric options at construction with BUN_ADAPTER_INVALID_OPTION', () => {
    expect(() => BunHttpApplicationAdapter.create({ port: 70_000 })).toThrowError(
      'Invalid port value: 70000. Expected an integer between 0 and 65535.',
    );
    expect(() => BunHttpApplicationAdapter.create({ shutdownTimeoutMs: -1 })).toThrowError(
      'Invalid shutdownTimeoutMs value: -1. Expected a non-negative integer.',
    );
    expect(() => BunHttpApplicationAdapter.create({ maxBodySize: 1.5 })).toThrowError(
      'Invalid maxBodySize value: 1.5. Expected a non-negative integer.',
    );
  });

  it('surfaces BUN_ADAPTER_RUNTIME_UNAVAILABLE when listen() finds no Bun runtime', async () => {
    const app = await FluoFactory.create(AppModule as ModuleType, {
      adapter: BunHttpApplicationAdapter.create(),
    });

    try {
      const failure = await app.listen().then(
        () => undefined,
        (error: unknown) => error as { code?: string; message?: string },
      );

      expect(failure).toBeInstanceOf(Error);
      expect(failure?.code).toBe('BUN_ADAPTER_RUNTIME_UNAVAILABLE');
      expect(failure?.message).toContain('globalThis.Bun.serve()');
    } finally {
      await app.close();
    }
  });

  it('resolves close() before listen() and clears adapter state', async () => {
    const adapter = BunHttpApplicationAdapter.create({ port: 0 });

    await expect(adapter.close()).resolves.toBeUndefined();
    expect(adapter.getServer()).toBeUndefined();
  });
});
