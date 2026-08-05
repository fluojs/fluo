import { Module } from '@fluojs/core';
import { describe, expect, it } from 'vitest';
import { createTestingModule } from './module.js';

describe('TestingModuleBuilder compile failure cleanup', () => {
  it('disposes lifecycle providers when compile fails during module initialization', async () => {
    // Given
    const compileError = new Error('module initialization failed');
    const lifecycleEvents: string[] = [];

    class FailingLifecycleService {
      onModuleInit(): void {
        throw compileError;
      }

      onDestroy(): void {
        lifecycleEvents.push('destroyed');
      }
    }

    @Module({ providers: [FailingLifecycleService] })
    class FailingLifecycleModule {}

    // When
    const compilePromise = createTestingModule({ rootModule: FailingLifecycleModule }).compile();

    // Then
    await expect(compilePromise).rejects.toBe(compileError);
    expect(lifecycleEvents).toEqual(['destroyed']);
  });

  it('preserves compile and disposal failures when both operations fail', async () => {
    // Given
    const compileError = new Error('module initialization failed');
    const cleanupError = new Error('provider cleanup failed');

    class FailingLifecycleService {
      onModuleInit(): void {
        throw compileError;
      }

      onDestroy(): void {
        throw cleanupError;
      }
    }

    @Module({ providers: [FailingLifecycleService] })
    class FailingLifecycleModule {}

    // When
    const failure: unknown = await createTestingModule({ rootModule: FailingLifecycleModule })
      .compile()
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    // Then
    expect(failure).toBeInstanceOf(AggregateError);
    if (failure instanceof AggregateError) {
      expect(failure.errors[0]).toBe(compileError);
      expect(failure.errors[1]).toBe(cleanupError);
    }
  });

  it('disposes the effective override provider when its lifecycle hook fails', async () => {
    // Given
    const SERVICE_TOKEN = Symbol('service');
    const compileError = new Error('override initialization failed');
    const lifecycleEvents: string[] = [];

    class FailingOverrideService {
      onModuleInit(): void {
        throw compileError;
      }

      onDestroy(): void {
        lifecycleEvents.push('override:destroyed');
      }
    }

    @Module({ providers: [{ provide: SERVICE_TOKEN, useValue: { source: 'original' } }] })
    class OverrideModule {}

    // When
    const compilePromise = createTestingModule({ rootModule: OverrideModule })
      .overrideProvider(SERVICE_TOKEN, { provide: SERVICE_TOKEN, useClass: FailingOverrideService })
      .compile();

    // Then
    await expect(compilePromise).rejects.toBe(compileError);
    expect(lifecycleEvents).toEqual(['override:destroyed']);
  });
});
