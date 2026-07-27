import { Module, type Constructor, type Token } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import type { MiddlewareLike } from '@fluojs/http';
import { defineModule, type ModuleDefinition, type ModuleType } from '@fluojs/runtime';

import { REACT_PAGE_RENDERER, type ReactPageRenderer } from './page-renderer.js';

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
  /** Application callback that composes page elements into existing React server entries. */
  readonly renderPage?: ReactPageRenderer;
};

/**
 * Runtime-neutral module facade for registering React routers in fluo applications.
 *
 * @remarks
 * `ReactModule.forRoot(...)` registers React routers through the same module/controller
 * metadata consumed by `@fluojs/runtime` and `@fluojs/http`. It does not install a
 * React-owned matcher, renderer, Vite integration, React Server Components hooks, or
 * server functions. The stable root package owns runtime-neutral SSR contracts; future
 * `@fluojs/react/vite`, `@fluojs/react/client`, and `@fluojs/react/experimental/rsc`
 * subpaths own build assets, browser navigation, and RSC/server-function experiments.
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

    const pageRendererProvider: Provider<ReactPageRenderer> | undefined = options.renderPage === undefined
      ? undefined
      : { provide: REACT_PAGE_RENDERER, useValue: options.renderPage };
    const exports = [
      ...(options.exports ?? []),
      ...(pageRendererProvider === undefined ? [] : [REACT_PAGE_RENDERER]),
    ];
    const providers = [
      ...(options.providers ?? []),
      ...(pageRendererProvider === undefined ? [] : [pageRendererProvider]),
    ];
    const definition = {
      controllers: [...options.controllers],
      ...(exports.length > 0 ? { exports } : {}),
      ...(options.imports ? { imports: [...options.imports] } : {}),
      ...(options.middleware ? { middleware: [...options.middleware] } : {}),
      ...(providers.length > 0 ? { providers } : {}),
    } satisfies ModuleDefinition;

    return defineModule(ReactRootModule, definition);
  }
}
