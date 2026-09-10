import type { Converter, Dispatcher, Middleware } from '@fluojs/http';
import type { Application } from '@fluojs/runtime';
import { FluoFactory } from '@fluojs/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp } from './app.js';

vi.mock('@fluojs/runtime', () => ({
  FluoFactory: {
    create: vi.fn(async () => ({
      close: vi.fn(async () => {}),
      dispatcher: {} as Dispatcher,
    } satisfies Pick<Application, 'close' | 'dispatcher'>)),
  },
}));

const mockedCreate = vi.mocked(FluoFactory.create);

describe('createTestApp bootstrap forwarding', () => {
  beforeEach(() => {
    mockedCreate.mockClear();
  });

  it('forwards converters and diagnostics options while prepending request-context middleware', async () => {
    class AppModule {}

    const converter: Converter = {
      convert(value) {
        return value;
      },
    };
    const callerMiddleware: Middleware = {
      async handle(_context, next) {
        await next();
      },
    };

    const app = await createTestApp({
      rootModule: AppModule,
      converters: [converter],
      diagnostics: { timing: true },
      middleware: [callerMiddleware],
    });

    await app.close();

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockedCreate).toHaveBeenCalledWith(AppModule, expect.objectContaining({
      converters: [converter],
      diagnostics: { timing: true },
      rootModule: AppModule,
    }));
    const forwardedOptions = mockedCreate.mock.calls[0]?.[1];
    expect(forwardedOptions?.middleware?.at(0)).not.toBe(callerMiddleware);
    expect(forwardedOptions?.middleware?.at(1)).toBe(callerMiddleware);
  });
});
