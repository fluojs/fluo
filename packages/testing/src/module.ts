import type { Token } from '@konekti/core';
import { getModuleMetadata } from '@konekti/core';
import type { ClassType, Provider } from '@konekti/di';
import type { BootstrapResult, ModuleDefinition, ModuleType } from '@konekti/runtime';
import { bootstrapModule, defineModule } from '@konekti/runtime';

import { createDispatcher, createHandlerMapping } from '@konekti/http';
import type { Guard, HandlerSource, Interceptor } from '@konekti/http';
import { createTestRequestContextMiddleware, makeRequest, type TestRequestWithOptions } from './http.js';
import type { TestingModuleBuilder, TestingModuleOptions, TestingModuleRef } from './types.js';

export function extractModuleProviders(moduleType: ModuleType): Provider[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.providers)) {
    return [];
  }

  return metadata.providers as Provider[];
}

export function extractModuleControllers(moduleType: ModuleType): ClassType[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.controllers)) {
    return [];
  }

  return metadata.controllers as ClassType[];
}

export function extractModuleImports(moduleType: ModuleType): ModuleType[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.imports)) {
    return [];
  }

  return metadata.imports as ModuleType[];
}

function createHandlerSources(bootstrappedModules: BootstrapResult['modules']): HandlerSource[] {
  return bootstrappedModules.flatMap((compiledModule) =>
    (compiledModule.definition.controllers ?? []).map((controllerToken) => ({
      controllerToken,
      moduleMiddleware: compiledModule.definition.middleware ?? [],
      moduleType: compiledModule.type,
    })),
  );
}

function createTestingDispatcher(bootstrapped: BootstrapResult): ReturnType<typeof createDispatcher> {
  const handlerMapping = createHandlerMapping(createHandlerSources(bootstrapped.modules));

  return createDispatcher({
    appMiddleware: [createTestRequestContextMiddleware()],
    handlerMapping,
    rootContainer: bootstrapped.container,
  });
}

function isProviderDescriptor<T>(value: Provider<T> | T): value is Exclude<Provider<T>, ClassType<T>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'provide' in value &&
    ('useClass' in value || 'useFactory' in value || 'useValue' in value || 'useExisting' in value)
  );
}

function isClassConstructor<T>(value: Provider<T> | T): value is ClassType<T> {
  if (typeof value !== 'function') {
    return false;
  }

  const source = Function.prototype.toString.call(value);
  return source.startsWith('class ');
}

function normalizeOverride<T>(token: Token<T>, value: Provider<T> | T): Provider<T> {
  if (isProviderDescriptor(value)) {
    if (value.provide !== token) {
      throw new Error(
        `overrideProvider token mismatch: expected ${String(token)} but received provider for ${String(value.provide)}.`,
      );
    }

    return { ...value, provide: token } as Provider<T>;
  }

  if (isClassConstructor(value)) {
    return { provide: token, useClass: value };
  }

  return { provide: token, useValue: value };
}

class DefaultTestingModuleBuilder implements TestingModuleBuilder {
  private readonly overrides: Provider[] = [];
  private readonly moduleReplacements = new Map<ModuleType, ModuleType>();

  constructor(private readonly options: TestingModuleOptions) {}

  overrideProvider<T>(token: Token<T>, value: Provider<T> | T): this {
    this.overrides.push(normalizeOverride(token, value));
    return this;
  }

  overrideProviders(overrides: Array<[Token, unknown]>): this {
    for (const [token, value] of overrides) {
      this.overrideProvider(token, value);
    }

    return this;
  }

  overrideGuard(guard: Token<Guard>, fake: Partial<Guard> = {}): this {
    const passthrough: Guard = { canActivate: () => true, ...fake };
    this.overrides.push({ provide: guard as Token<Guard>, useValue: passthrough });
    return this;
  }

  overrideInterceptor(interceptor: Token<Interceptor>, fake: Partial<Interceptor> = {}): this {
    const passthrough: Interceptor = { intercept: (_ctx, next) => next.handle(), ...fake };
    this.overrides.push({ provide: interceptor as Token<Interceptor>, useValue: passthrough });
    return this;
  }

  overrideFilter(filter: Token<unknown>, fake: unknown = {}): this {
    this.overrides.push({ provide: filter, useValue: fake });
    return this;
  }

  overrideModule(module: ModuleType, replacement: ModuleType): this {
    this.moduleReplacements.set(module, replacement);
    return this;
  }

  async compile(): Promise<TestingModuleRef> {
    const bootstrapped = this.bootstrapTestingModule();

    return this.createTestingModuleRef(bootstrapped);
  }

  private bootstrapTestingModule(): BootstrapResult {
    const rootModule = this._applyModuleReplacements(this.options.rootModule);

    const bootstrapped = bootstrapModule(rootModule, {
      providers: this.options.providers,
    });

    if (this.overrides.length > 0) {
      bootstrapped.container.override(...this.overrides);
    }

    return bootstrapped;
  }

  private createTestingModuleRef(bootstrapped: BootstrapResult): TestingModuleRef {
    const dispatcher = createTestingDispatcher(bootstrapped);

    return {
      ...bootstrapped,
      has: (token) => bootstrapped.container.has(token),
      resolve: (token) => bootstrapped.container.resolve(token),
      resolveAll: async <T>(tokens: Token<T>[]): Promise<T[]> => {
        const results: T[] = [];
        const errors: Array<{ token: Token; error: unknown }> = [];

        for (const token of tokens) {
          try {
            results.push(await bootstrapped.container.resolve<T>(token));
          } catch (error) {
            errors.push({ token, error });
          }
        }

        if (errors.length > 0) {
          const summary = errors
            .map(({ token, error }) => `  - ${String(token)}: ${error instanceof Error ? error.message : String(error)}`)
            .join('\n');

          throw new Error(`Failed to resolve ${errors.length} of ${tokens.length} tokens:\n${summary}`);
        }

        return results;
      },
      dispatch: (request: TestRequestWithOptions) => makeRequest(dispatcher, request),
    };
  }

  private _applyModuleReplacements(module: ModuleType): ModuleType {
    if (this.moduleReplacements.size === 0) {
      return module;
    }

    const replacement = this.moduleReplacements.get(module);
    if (replacement) {
      return replacement;
    }

    const metadata = getModuleMetadata(module);
    if (!metadata?.imports || metadata.imports.length === 0) {
      return module;
    }

    const rewrittenImports = this.rewriteModuleImports(metadata.imports as ModuleType[]);
    const hasChange = rewrittenImports.some(
      (imp, i) => imp !== (metadata.imports as ModuleType[])[i],
    );

    if (!hasChange) {
      return module;
    }

    class PatchedModule {}
    defineModule(PatchedModule as unknown as ModuleType, {
      ...(metadata as ModuleDefinition),
      imports: rewrittenImports,
    });

    return PatchedModule as unknown as ModuleType;
  }

  private rewriteModuleImports(imports: ModuleType[]): ModuleType[] {
    return imports.map((moduleImport) => this._applyModuleReplacements(moduleImport));
  }
}

export function createTestingModule(options: TestingModuleOptions): TestingModuleBuilder {
  return new DefaultTestingModuleBuilder(options);
}
