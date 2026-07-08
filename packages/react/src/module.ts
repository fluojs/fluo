import { Module, type Constructor, type Token } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import type { MiddlewareLike } from '@fluojs/http';
import { defineModule, type ModuleDefinition, type ModuleType } from '@fluojs/runtime';

/**
 * Options for registering React routers through the fluo module graph.
 */
export type ReactModuleOptions = {
  /** React router or HTTP controller classes added to the existing HTTP handler source path. */
  readonly controllers: readonly Constructor[];
  /** Provider tokens exported from this dynamic React module. */
  readonly exports?: readonly Token[];
  /** Modules whose exported providers are visible to the registered React routers. */
  readonly imports?: readonly ModuleType[];
  /** Module-level middleware applied by the existing HTTP dispatcher to this module's routes. */
  readonly middleware?: readonly MiddlewareLike[];
  /** Providers local to this dynamic React module and visible to registered routers. */
  readonly providers?: readonly Provider[];
};

/**
 * Runtime-neutral module facade for registering React routers in fluo applications.
 *
 * @remarks
 * `ReactModule.forRoot(...)` registers React routers through the same module/controller
 * metadata consumed by `@fluojs/runtime` and `@fluojs/http`. It does not install a
 * React-owned matcher, renderer, Vite integration, React Server Components hooks, or
 * server functions.
 */
@Module({})
export class ReactModule {
  /**
   * Registers React routers and companion module metadata through the existing HTTP path.
   *
   * @param options React router controllers plus ordinary module imports, providers, exports, and middleware.
   * @returns A runtime module type suitable for `@Module({ imports: [...] })`.
   */
  static forRoot(options: ReactModuleOptions): ModuleType {
    class ReactRootModule extends ReactModule {}

    const definition = {
      controllers: [...options.controllers],
      ...(options.exports ? { exports: [...options.exports] } : {}),
      ...(options.imports ? { imports: [...options.imports] } : {}),
      ...(options.middleware ? { middleware: [...options.middleware] } : {}),
      ...(options.providers ? { providers: [...options.providers] } : {}),
    } satisfies ModuleDefinition;

    return defineModule(ReactRootModule, definition);
  }
}
