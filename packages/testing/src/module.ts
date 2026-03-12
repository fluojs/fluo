import type { Token } from '@konekti/core';
import type { ClassType, Provider } from '@konekti-internal/di';
import { bootstrapModule } from '@konekti-internal/module';

import type { TestingModuleBuilder, TestingModuleOptions, TestingModuleRef } from './types';

function normalizeOverride<T>(token: Token<T>, value: Provider<T> | T): Provider<T> {
  if (typeof value === 'function') {
    return {
      provide: token,
      useClass: value as unknown as ClassType<T>,
    };
  }

  if (typeof value === 'object' && value !== null && ('useClass' in value || 'useFactory' in value || 'useValue' in value)) {
    return {
      ...value,
      provide: token,
    } as Provider<T>;
  }

  return {
    provide: token,
    useValue: value,
  };
}

class DefaultTestingModuleBuilder implements TestingModuleBuilder {
  private readonly overrides: Provider[] = [];

  constructor(private readonly options: TestingModuleOptions) {}

  overrideProvider<T>(token: Token<T>, value: Provider<T> | T): this {
    this.overrides.push(normalizeOverride(token, value));
    return this;
  }

  async compile(): Promise<TestingModuleRef> {
    const bootstrapped = bootstrapModule(this.options.rootModule, {
      providers: this.options.providers,
    });

    if (this.overrides.length > 0) {
      bootstrapped.container.register(...this.overrides);
    }

    return {
      ...bootstrapped,
      has: (token) => bootstrapped.container.has(token),
      resolve: (token) => bootstrapped.container.resolve(token),
    };
  }
}

export function createTestingModule(options: TestingModuleOptions): TestingModuleBuilder {
  return new DefaultTestingModuleBuilder(options);
}
