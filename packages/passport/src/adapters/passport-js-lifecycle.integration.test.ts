import { Module } from '@fluojs/core';
import { Container } from '@fluojs/di';
import type { FrameworkResponse, GuardContext } from '@fluojs/http';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { createPassportJsStrategyBridge, type PassportJsStrategyLike } from './passport-js.js';

class UnsettledPassportStrategy implements PassportJsStrategyLike {
  authenticate(): void {}
}

function createGuardContext(): GuardContext {
  const response = {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send() {
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  } satisfies FrameworkResponse;

  return {
    handler: {
      controllerToken: class TestController {},
      metadata: {
        controllerPath: '/auth',
        effectivePath: '/auth/callback',
        moduleMiddleware: [],
        pathParams: [],
      },
      methodName: 'callback',
      route: {
        method: 'GET',
        path: '/callback',
      },
    },
    requestContext: {
      container: new Container().createRequestScope(),
      metadata: {},
      request: {
        body: undefined,
        cookies: {},
        headers: {},
        method: 'GET',
        params: {},
        path: '/auth/callback',
        query: {},
        raw: {},
        url: '/auth/callback',
      },
      response,
    },
  };
}

describe('PassportJsAuthStrategy application shutdown lifecycle', () => {
  it('cancels in-flight authentication through real application close', async () => {
    // Given
    const bridge = createPassportJsStrategyBridge('shutdown-aware', UnsettledPassportStrategy, {
      actionTimeoutMs: 1_000,
    });

    @Module({
      exports: [bridge.strategy.token],
      providers: [UnsettledPassportStrategy, ...bridge.providers],
    })
    class ShutdownAwareModule {}

    const app = await FluoFactory.createApplicationContext(ShutdownAwareModule);
    const bridgeStrategy = await app.container.resolve(bridge.strategy.token);
    const inFlight = bridgeStrategy.authenticate(createGuardContext());
    const shutdownRejection = expect(inFlight).rejects.toThrow(
      'Passport strategy authentication was cancelled during application shutdown.',
    );

    // When
    await app.close();

    // Then
    await shutdownRejection;
  });
});
