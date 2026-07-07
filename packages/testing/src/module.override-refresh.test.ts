import { Module } from '@fluojs/core';
import { describe, expect, it } from 'vitest';

import { createTestingModule } from './index.js';

type Deferred = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

function createDeferred(): Deferred {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  if (!resolve) {
    throw new Error('Deferred resolver was not initialized.');
  }

  return { promise, resolve };
}

describe('TestingModuleRef post-compile overrides', () => {
  it('returns the replacement after container.override() invalidates a sync singleton read through get()', async () => {
    type ServiceValue = {
      readonly label: string;
    };

    const TOKEN = Symbol('post-compile-override-token');
    const originalValue: ServiceValue = { label: 'original' };
    const replacementValue: ServiceValue = { label: 'replacement' };

    @Module({ providers: [{ provide: TOKEN, useValue: originalValue }] })
    class OverrideModule {}

    const testingModule = await createTestingModule({ rootModule: OverrideModule }).compile();

    const original = testingModule.get<ServiceValue>(TOKEN);
    testingModule.container.override({ provide: TOKEN, useValue: replacementValue });
    const replacement = testingModule.get<ServiceValue>(TOKEN);

    expect(original).toBe(originalValue);
    expect(replacement).toBe(replacementValue);
  });

  it('keeps get() aligned after container.override() is repopulated through container.resolve()', async () => {
    type ServiceValue = {
      readonly label: string;
    };

    const TOKEN = Symbol('post-compile-override-resolve-token');
    const originalValue: ServiceValue = { label: 'original' };
    const replacementValue: ServiceValue = { label: 'replacement' };

    @Module({ providers: [{ provide: TOKEN, useValue: originalValue }] })
    class OverrideResolveModule {}

    const testingModule = await createTestingModule({ rootModule: OverrideResolveModule }).compile();

    const original = testingModule.get<ServiceValue>(TOKEN);
    testingModule.container.override({ provide: TOKEN, useValue: replacementValue });
    const resolvedReplacement = await testingModule.container.resolve<ServiceValue>(TOKEN);
    const syncReplacement = testingModule.get<ServiceValue>(TOKEN);

    expect(original).toBe(originalValue);
    expect(resolvedReplacement).toBe(replacementValue);
    expect(syncReplacement).toBe(replacementValue);
  });

  it('keeps multi-provider get() aligned when a dependency override is repopulated through container.resolve()', async () => {
    const DEPENDENCY = Symbol('post-compile-multi-dependency-token');
    const PLUGINS = Symbol('post-compile-multi-plugins-token');

    class Plugin {
      constructor(readonly value: string) {}
    }

    @Module({
      providers: [
        { provide: DEPENDENCY, useValue: 'original' },
        { provide: PLUGINS, useClass: Plugin, inject: [DEPENDENCY], multi: true },
      ],
    })
    class MultiOverrideResolveModule {}

    const testingModule = await createTestingModule({ rootModule: MultiOverrideResolveModule }).compile();

    const original = testingModule.get<Plugin[]>(PLUGINS);
    testingModule.container.override({ provide: DEPENDENCY, useValue: 'replacement' });
    const resolvedReplacement = await testingModule.container.resolve<Plugin[]>(PLUGINS);
    const syncReplacement = testingModule.get<Plugin[]>(PLUGINS);

    expect(original.map((plugin) => plugin.value)).toEqual(['original']);
    expect(resolvedReplacement.map((plugin) => plugin.value)).toEqual(['replacement']);
    expect(syncReplacement.map((plugin) => plugin.value)).toEqual(['replacement']);
  });

  it('preserves async stale-disposal ordering after container.override() and replacement get()', async () => {
    const TOKEN = Symbol('post-compile-async-disposal-token');
    const events: string[] = [];
    const originalDestroyStarted = createDeferred();
    const finishOriginalDestroy = createDeferred();

    class OriginalService {
      readonly label = 'original';

      async onDestroy(): Promise<void> {
        events.push('original:destroy:start');
        originalDestroyStarted.resolve();
        await finishOriginalDestroy.promise;
        events.push('original:destroy:end');
      }
    }

    class ReplacementService {
      readonly label = 'replacement';

      onDestroy(): void {
        events.push('replacement:destroy');
      }
    }

    @Module({ providers: [{ provide: TOKEN, useClass: OriginalService }] })
    class AsyncDisposalOverrideModule {}

    const testingModule = await createTestingModule({ rootModule: AsyncDisposalOverrideModule }).compile();

    const original = testingModule.get<OriginalService | ReplacementService>(TOKEN);
    testingModule.container.override({ provide: TOKEN, useClass: ReplacementService });
    const replacement = testingModule.get<OriginalService | ReplacementService>(TOKEN);

    expect(original).toBeInstanceOf(OriginalService);
    expect(replacement).toBeInstanceOf(ReplacementService);

    const disposePromise = testingModule.container.dispose().then(() => {
      events.push('container:disposed');
    });

    await originalDestroyStarted.promise;
    expect(events).toEqual(['original:destroy:start']);

    finishOriginalDestroy.resolve();
    await disposePromise;

    expect(events).toEqual([
      'original:destroy:start',
      'original:destroy:end',
      'replacement:destroy',
      'container:disposed',
    ]);
  });
});
