import { Container } from '@fluojs/di';
import type { FrameworkResponse, GuardContext } from '@fluojs/http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationRequiredError } from '../errors.js';
import { PassportJsAuthStrategy, type PassportJsStrategyLike } from './passport-js.js';

class UnsettledStrategy implements PassportJsStrategyLike {
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

afterEach(() => {
  vi.useRealTimers();
});

describe('PassportJsAuthStrategy action timeout', () => {
  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('rejects invalid actionTimeoutMs %s before authentication starts', (actionTimeoutMs) => {
    // Given
    const strategy = new UnsettledStrategy();

    // When
    const createBridgeStrategy = () => new PassportJsAuthStrategy(strategy, { actionTimeoutMs });

    // Then
    expect(createBridgeStrategy).toThrow(RangeError);
  });

  it('retains actionTimeoutMs 0 and clears the timer after timeout settlement', async () => {
    // Given
    vi.useFakeTimers();
    const strategy = new PassportJsAuthStrategy(new UnsettledStrategy(), { actionTimeoutMs: 0 });

    // When
    const authentication = strategy.authenticate(createGuardContext());
    const rejection = expect(authentication).rejects.toThrow(AuthenticationRequiredError);
    await vi.runAllTimersAsync();

    // Then
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the pending action timeout after successful strategy settlement', async () => {
    // Given
    vi.useFakeTimers();
    class SuccessfulStrategy implements PassportJsStrategyLike {
      success?: (user: unknown) => void;

      authenticate(): void {
        this.success?.({ id: 'passport-user' });
      }
    }
    const strategy = new PassportJsAuthStrategy(new SuccessfulStrategy(), { actionTimeoutMs: 1_000 });

    // When
    const principal = await strategy.authenticate(createGuardContext());

    // Then
    expect(principal).toMatchObject({ subject: 'passport-user' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the pending action timeout after failed strategy settlement', async () => {
    // Given
    vi.useFakeTimers();
    class FailedStrategy implements PassportJsStrategyLike {
      fail?: (challenge?: unknown, status?: number) => void;

      authenticate(): void {
        this.fail?.('credentials rejected', 401);
      }
    }
    const strategy = new PassportJsAuthStrategy(new FailedStrategy(), { actionTimeoutMs: 1_000 });

    // When
    const authentication = strategy.authenticate(createGuardContext());

    // Then
    await expect(authentication).rejects.toThrow(AuthenticationRequiredError);
    expect(vi.getTimerCount()).toBe(0);
  });
});
