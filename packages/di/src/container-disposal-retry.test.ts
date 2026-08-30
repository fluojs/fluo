import { describe, expect, it, vi } from 'vitest';

import { Container } from './container.js';

describe('Container disposal retry', () => {
  it('retries only failed hooks in reverse creation order', async () => {
    // Given
    const events: string[] = [];
    const firstFailure = new Error('first failed');
    const lastFailure = new Error('last failed');
    let firstAttempts = 0;
    let lastAttempts = 0;

    class FirstFailingService {
      onDestroy(): void {
        firstAttempts += 1;
        events.push(`first:${firstAttempts}`);

        if (firstAttempts === 1) {
          throw firstFailure;
        }
      }
    }

    class SuccessfulService {
      readonly onDestroy = vi.fn(() => {
        events.push('successful');
      });
    }

    class LastFailingService {
      onDestroy(): void {
        lastAttempts += 1;
        events.push(`last:${lastAttempts}`);

        if (lastAttempts === 1) {
          throw lastFailure;
        }
      }
    }

    const container = new Container().register(
      FirstFailingService,
      SuccessfulService,
      LastFailingService,
    );
    await container.resolve(FirstFailingService);
    const successfulService = await container.resolve<SuccessfulService>(SuccessfulService);
    await container.resolve(LastFailingService);

    // When
    const firstError = await container.dispose().catch((error: unknown) => error);

    // Then
    if (!(firstError instanceof AggregateError)) {
      expect.unreachable('expected the first disposal to aggregate both failed hooks');
    }

    expect(firstError.errors).toEqual([lastFailure, firstFailure]);
    expect(events).toEqual(['last:1', 'successful', 'first:1']);

    // When
    await container.dispose();

    // Then
    expect(events).toEqual(['last:1', 'successful', 'first:1', 'last:2', 'first:2']);
    expect(successfulService.onDestroy).toHaveBeenCalledOnce();

    // When
    await container.dispose();

    // Then
    expect(events).toEqual(['last:1', 'successful', 'first:1', 'last:2', 'first:2']);
  });

  it('retries nested request scopes before their parent and root', async () => {
    // Given
    const events: string[] = [];
    let childAttempts = 0;
    let parentAttempts = 0;
    let rootAttempts = 0;

    class RootService {
      onDestroy(): void {
        rootAttempts += 1;
        events.push(`root:${rootAttempts}`);

        if (rootAttempts === 1) {
          throw new Error('root failed');
        }
      }
    }

    class ParentRequestService {
      onDestroy(): void {
        parentAttempts += 1;
        events.push(`parent:${parentAttempts}`);

        if (parentAttempts === 1) {
          throw new Error('parent failed');
        }
      }
    }

    class ChildRequestService {
      onDestroy(): void {
        childAttempts += 1;
        events.push(`child:${childAttempts}`);

        if (childAttempts === 1) {
          throw new Error('child failed');
        }
      }
    }

    const root = new Container().register(
      RootService,
      { provide: ParentRequestService, scope: 'request', useClass: ParentRequestService },
      { provide: ChildRequestService, scope: 'request', useClass: ChildRequestService },
    );
    const parentScope = root.createRequestScope();
    const childScope = parentScope.createRequestScope();
    await root.resolve(RootService);
    await parentScope.resolve(ParentRequestService);
    await childScope.resolve(ChildRequestService);

    // When
    const firstError = await root.dispose().catch((error: unknown) => error);

    // Then
    if (!(firstError instanceof AggregateError)) {
      expect.unreachable('expected child, parent, and root disposal failures to be aggregated');
    }

    expect(firstError.errors.map((error) => error instanceof Error ? error.message : error)).toEqual([
      'child failed',
      'parent failed',
      'root failed',
    ]);
    expect(events).toEqual(['child:1', 'parent:1', 'root:1']);

    // When
    await root.dispose();

    // Then
    expect(events).toEqual(['child:1', 'parent:1', 'root:1', 'child:2', 'parent:2', 'root:2']);
  });

  it('shares the active disposal while retaining failed cleanup for a later retry', async () => {
    // Given
    const failure = new Error('shared disposal failed');
    let attempts = 0;
    let releaseFirstAttempt = (): void => {};
    let reportAttemptStarted = (): void => {};
    const firstAttemptCanFinish = new Promise<void>((resolve) => {
      releaseFirstAttempt = resolve;
    });
    const attemptStarted = new Promise<void>((resolve) => {
      reportAttemptStarted = resolve;
    });

    class SharedDisposalService {
      async onDestroy(): Promise<void> {
        attempts += 1;
        reportAttemptStarted();
        await firstAttemptCanFinish;

        if (attempts === 1) {
          throw failure;
        }
      }
    }

    const container = new Container().register(SharedDisposalService);
    await container.resolve(SharedDisposalService);

    // When
    const firstDispose = container.dispose();
    const concurrentDispose = container.dispose();
    await attemptStarted;

    // Then
    expect(attempts).toBe(1);

    // When
    releaseFirstAttempt();
    const concurrentResults = await Promise.allSettled([firstDispose, concurrentDispose]);

    // Then
    expect(concurrentResults.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(concurrentResults.map((result) => result.status === 'rejected' ? result.reason : undefined)).toEqual([
      failure,
      failure,
    ]);

    // When
    await container.dispose();

    // Then
    expect(attempts).toBe(2);
  });

  it('keeps every operation terminal after failed disposal starts', async () => {
    // Given
    let attempts = 0;

    class RetryingService {
      onDestroy(): void {
        attempts += 1;

        if (attempts === 1) {
          throw new Error('retrying service failed');
        }
      }
    }

    class LaterService {}

    const container = new Container().register(RetryingService);
    await container.resolve(RetryingService);

    // When
    await expect(container.dispose()).rejects.toThrow('retrying service failed');

    // Then
    await expect(container.resolve(RetryingService)).rejects.toThrow('Container has been disposed');
    expect(() => container.register(LaterService)).toThrow('Container has been disposed');
    expect(() => container.override(RetryingService)).toThrow('Container has been disposed');
    expect(() => container.createRequestScope()).toThrow('Container has been disposed');

    // When
    await container.dispose();

    // Then
    expect(attempts).toBe(2);
  });

  it('retries a failed stale override cleanup on a later explicit disposal', async () => {
    // Given
    const events: string[] = [];
    let staleAttempts = 0;
    const token = Symbol('RetryableStaleOverrideToken');

    class StaleService {
      onDestroy(): void {
        staleAttempts += 1;
        events.push(`stale:${staleAttempts}`);

        if (staleAttempts === 1) {
          throw new Error('stale cleanup failed');
        }
      }
    }

    class ReplacementService {
      readonly onDestroy = vi.fn(() => {
        events.push('replacement');
      });
    }

    const container = new Container().register({ provide: token, useClass: StaleService });
    await container.resolve(token);

    // When
    container.override({ provide: token, useClass: ReplacementService });

    // Then
    await expect(container.resolve(token)).rejects.toThrow('stale cleanup failed');

    // When
    const replacement = await container.resolve<ReplacementService>(token);

    // Then
    expect(events).toEqual(['stale:1']);

    // When
    await container.dispose();

    // Then
    expect(events).toEqual(['stale:1', 'stale:2', 'replacement']);
    expect(replacement.onDestroy).toHaveBeenCalledOnce();

    // When
    await container.dispose();

    // Then
    expect(events).toEqual(['stale:1', 'stale:2', 'replacement']);
  });
});
