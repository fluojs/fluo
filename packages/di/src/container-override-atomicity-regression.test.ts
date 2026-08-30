import { describe, expect, it } from 'vitest';

import { Container } from './container.js';
import { DuplicateProviderError, ScopeMismatchError } from './errors.js';
import { Scope } from './types.js';

describe('Container override batch atomicity regressions', () => {
  it('leaves earlier single registrations unchanged when a later token group is ambiguous', async () => {
    // Given
    const stable = Symbol('stable-single');
    const ambiguous = Symbol('ambiguous-multi');
    const container = new Container().register(
      { provide: stable, useValue: 'original' },
      { provide: ambiguous, useValue: 'original-multi', multi: true },
    );

    // When
    expect(() =>
      container.override(
        { provide: stable, useValue: 'replacement' },
        { provide: ambiguous, useValue: 'replacement-multi', multi: true },
        { provide: ambiguous, useValue: 'replacement-single' },
      ),
    ).toThrow(DuplicateProviderError);

    // Then
    await expect(container.resolve<string>(stable)).resolves.toBe('original');
    await expect(container.resolve<string[]>(ambiguous)).resolves.toEqual(['original-multi']);
  });

  it('leaves earlier multi registrations unchanged when a later token group is duplicated', async () => {
    // Given
    const stable = Symbol('stable-multi');
    const duplicated = Symbol('duplicated-single');
    const container = new Container().register(
      { provide: stable, useValue: 'original-a', multi: true },
      { provide: stable, useValue: 'original-b', multi: true },
      { provide: duplicated, useValue: 'original' },
    );

    // When
    expect(() =>
      container.override(
        { provide: stable, useValue: 'replacement-a', multi: true },
        { provide: duplicated, useValue: 'replacement-one' },
        { provide: duplicated, useValue: 'replacement-two' },
      ),
    ).toThrow(DuplicateProviderError);

    // Then
    await expect(container.resolve<string[]>(stable)).resolves.toEqual(['original-a', 'original-b']);
    await expect(container.resolve<string>(duplicated)).resolves.toBe('original');
  });

  it('keeps cached singleton instances and disposal ownership when a batch is rejected', async () => {
    // Given
    const stable = Symbol('stable-cached');
    const ambiguous = Symbol('ambiguous-cached');
    const destroyed: string[] = [];

    class CachedService {
      onDestroy(): void {
        destroyed.push('cached');
      }
    }

    const container = new Container().register(
      { provide: stable, useClass: CachedService },
      { provide: ambiguous, useValue: 'original-multi', multi: true },
    );
    const cachedInstance = await container.resolve<CachedService>(stable);

    // When
    expect(() =>
      container.override(
        { provide: stable, useValue: new CachedService() },
        { provide: ambiguous, useValue: 'replacement-multi', multi: true },
        { provide: ambiguous, useValue: 'replacement-single' },
      ),
    ).toThrow(DuplicateProviderError);

    // Then
    await expect(container.resolve<CachedService>(stable)).resolves.toBe(cachedInstance);
    expect(destroyed).toEqual([]);
    expect(container.inspectResolutionState().singletonCache.has(stable)).toBe(true);
  });

  it('leaves earlier registrations unchanged when a later group introduces a request-scope singleton', async () => {
    // Given
    const stable = Symbol('stable-request-scope');
    const introduced = Symbol('introduced-singleton');
    const root = new Container().register({ provide: stable, useValue: 'original' });
    const requestScope = root.createRequestScope();

    // When
    expect(() =>
      requestScope.override(
        { provide: stable, useValue: 'replacement' },
        { provide: introduced, scope: Scope.DEFAULT, useValue: 'new-singleton' },
      ),
    ).toThrow(ScopeMismatchError);

    // Then
    await expect(requestScope.resolve<string>(stable)).resolves.toBe('original');
    expect(requestScope.has(introduced)).toBe(false);
  });
});
