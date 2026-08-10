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

  it('uses the 30,000 ms default and clears the timer after timeout settlement', async () => {
    // Given
    vi.useFakeTimers();
    const strategy = new PassportJsAuthStrategy(new UnsettledStrategy());

    // When
    const authentication = strategy.authenticate(createGuardContext());
    const rejection = expect(authentication).rejects.toThrow(AuthenticationRequiredError);
    await vi.advanceTimersByTimeAsync(29_999);

    // Then
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
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
    const strategy = new PassportJsAuthStrategy(new SuccessfulStrategy());

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

  it('cancels every in-flight authentication when application shutdown starts', async () => {
    // Given
    vi.useFakeTimers();
    const strategy = new PassportJsAuthStrategy(new UnsettledStrategy());
    const firstAuthentication = strategy.authenticate(createGuardContext());
    const secondAuthentication = strategy.authenticate(createGuardContext());
    const firstRejection = expect(firstAuthentication).rejects.toThrow(AuthenticationRequiredError);
    const secondRejection = expect(secondAuthentication).rejects.toThrow(AuthenticationRequiredError);

    // When
    strategy.onApplicationShutdown();

    // Then
    await Promise.all([firstRejection, secondRejection]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('PassportJsAuthStrategy terminal actions', () => {
  it('settles once with success when fail follows success', async () => {
    // Given
    vi.useFakeTimers();
    let challengeMessageReads = 0;
    const lateChallenge = {
      get message() {
        challengeMessageReads += 1;
        return 'late failure';
      },
    };
    class SuccessThenFailStrategy implements PassportJsStrategyLike {
      fail?: (challenge?: unknown, status?: number) => void;
      success?: (user: unknown) => void;

      authenticate(): void {
        this.success?.({ id: 'passport-user' });
        this.fail?.(lateChallenge, 401);
      }
    }
    const mapPrincipal = vi.fn(() => ({ claims: {}, subject: 'passport-user' }));
    const strategy = new PassportJsAuthStrategy(new SuccessThenFailStrategy(), {
      actionTimeoutMs: 1_000,
      mapPrincipal,
    });

    // When
    const authentication = strategy.authenticate(createGuardContext());
    const settlement = vi.fn();
    void authentication.then(settlement, settlement);
    const principal = await authentication;

    // Then
    expect(principal).toEqual({ claims: {}, subject: 'passport-user' });
    expect(mapPrincipal).toHaveBeenCalledTimes(1);
    expect(settlement).toHaveBeenCalledTimes(1);
    expect(challengeMessageReads).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles once with failure when success follows fail', async () => {
    // Given
    vi.useFakeTimers();
    class FailThenSuccessStrategy implements PassportJsStrategyLike {
      fail?: (challenge?: unknown, status?: number) => void;
      success?: (user: unknown) => void;

      authenticate(): void {
        this.fail?.('credentials rejected', 401);
        this.success?.({ id: 'late-user' });
      }
    }
    const mapPrincipal = vi.fn(() => ({ claims: {}, subject: 'late-user' }));
    const strategy = new PassportJsAuthStrategy(new FailThenSuccessStrategy(), {
      actionTimeoutMs: 1_000,
      mapPrincipal,
    });

    // When
    const authentication = strategy.authenticate(createGuardContext());
    const settlement = vi.fn();
    void authentication.then(settlement, settlement);

    // Then
    await expect(authentication).rejects.toThrow('credentials rejected');
    expect(mapPrincipal).not.toHaveBeenCalled();
    expect(settlement).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
