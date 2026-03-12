import { describe, expect, it } from 'vitest';

import { Inject, Scope } from '@konekti/core';

import { Container } from './container';

describe('Container', () => {
  it('caches singleton providers', async () => {
    class Logger {}

    const container = new Container().register(Logger);

    const first = await container.resolve(Logger);
    const second = await container.resolve(Logger);

    expect(first).toBe(second);
  });

  it('supports factory providers with injected dependencies', async () => {
    class Logger {
      log(message: string) {
        return `logged:${message}`;
      }
    }

    const output = Symbol('output');

    const container = new Container().register(
      Logger,
      {
        provide: output,
        useFactory: (logger) => (logger as Logger).log('ok'),
        inject: [Logger],
      },
    );

    expect(await container.resolve(output)).toBe('logged:ok');
  });

  it('keeps request-scoped providers unique per request scope', async () => {
    let created = 0;

    class RequestStore {
      readonly id = ++created;
    }

    const root = new Container().register({
      provide: RequestStore,
      scope: 'request',
      useClass: RequestStore,
    });

    await expect(root.resolve(RequestStore)).rejects.toThrow('outside request scope');

    const requestA = root.createRequestScope();
    const requestB = root.createRequestScope();

    const a1 = await requestA.resolve(RequestStore);
    const a2 = await requestA.resolve(RequestStore);
    const b1 = await requestB.resolve(RequestStore);

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b1);
  });

  it('supports @Inject and @Scope metadata for dependency tokens and scope', async () => {
    class Logger {}

    @Inject([Logger])
    @Scope('request')
    class RequestService {
      constructor(readonly logger: Logger) {}
    }

    const root = new Container().register(Logger, RequestService);

    await expect(root.resolve(RequestService)).rejects.toThrow('outside request scope');

    const requestScope = root.createRequestScope();
    const first = await requestScope.resolve(RequestService);
    const second = await requestScope.resolve(RequestService);

    expect(first).toBe(second);
    expect(first.logger).toBeInstanceOf(Logger);
  });
});
