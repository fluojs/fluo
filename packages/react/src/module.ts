import { type Constructor, Module, type Token } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import type { MiddlewareLike } from '@fluojs/http/portable';
import { registerFrameworkResponseWriter, type FrameworkResponseWriterContext } from '@fluojs/http/internal';
import { defineModule, type ModuleDefinition, type ModuleType } from '@fluojs/runtime/internal';
import type { ReactSsrDiagnosticHandler } from './diagnostics.js';
import { parseReactSessionChange, type ReactFormResultOptions } from './form-result.js';
import { REACT_PAGE_RENDERER, type ReactPageRenderer } from './page-renderer.js';
import { createReactPageResultMiddleware } from './page-result.js';
import { validateReactRenderPolicyControllers } from './render-policy.js';

/**
 * Options for registering React routers through the fluo module graph.
 */
export type ReactModuleOptions = {
  /** React router or HTTP controller classes added to the existing HTTP handler source path. */
  readonly controllers: readonly Constructor[];
  /** Identity of the complete selected production client manifest and same-origin asset base. */
  readonly navigationBuildId?: string;
  /** Provider tokens exported from this dynamic React module. */
  readonly exports?: readonly Token[];
  /** Modules whose exported providers are visible to the registered React routers. */
  readonly imports?: readonly ModuleType[];
  /** Module-level middleware applied by the existing HTTP dispatcher to this module's routes. */
  readonly middleware?: readonly MiddlewareLike[];
  /** Application callback for stable phase-aware React SSR diagnostics. */
  readonly onDiagnostic?: ReactSsrDiagnosticHandler;
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
   * Acknowledge confirmed persistence through the existing native HTTP form path.
   *
   * @param options Application-approved native 303 destination and enhanced follow-up policy.
   * @returns A native 303 result or explicitly negotiated saved acknowledgement.
   * @throws TypeError For a malformed destination.
   */
  static formResult<const Options extends ReactFormResultOptions>(options: Options): Options {
    if (!options.destination.startsWith('/') || options.destination.startsWith('//')
      || Array.from(options.destination).some((character) =>
        character === '\\' || character.charCodeAt(0) <= 0x20)) {
      throw new TypeError('A form destination must be a root-relative HTTP document URL.');
    }
    const destination = options.destination;
    const followUp = options.followUp;
    const session = options.session === undefined ? undefined : parseReactSessionChange(options.session);
    if (options.session !== undefined && session === undefined) {
      throw new TypeError('A form session must carry a nonempty epoch and explicit transition reason.');
    }
    const data: unknown = Object.hasOwn(options, 'data') ? JSON.parse(JSON.stringify(options.data)) : undefined;
    const entry = registerFrameworkResponseWriter(options, (context) => {
      context.applySuccessResponseMetadata();
      if ((context.response.statusCode ?? 201) < 200 || (context.response.statusCode ?? 201) >= 300) {
        return context.response.send(undefined);
      }
      return context.response.redirect(303, destination);
    });
    Object.defineProperty(entry, Symbol.for('fluo.http.responseRepresentation'), {
      value: {
        mediaType: 'application/vnd.fluo.form+json;v=1',
        method: 'POST',
        body: (context: FrameworkResponseWriterContext) => {
          context.applySuccessResponseMetadata();
          if ((context.response.statusCode ?? 201) < 200 || (context.response.statusCode ?? 201) >= 300) {
            return { version: 1, outcome: 'rejected' };
          }
          context.response.setStatus(200);
          return { version: 1, outcome: 'saved', destination, followUp,
            ...(data === undefined ? {} : { data }),
            ...(session === undefined ? {} : { session }),
          };
        },
      },
    });
    return entry;
  }
  /**
   * Registers React routers and companion module metadata through the existing HTTP path.
   *
   * @param options React router controllers plus ordinary module imports, providers, exports, and middleware.
   * @returns A runtime module type suitable for `@Module({ imports: [...] })`.
   */
  static forRoot(options: ReactModuleOptions): ModuleType {
    if (options.navigationBuildId !== undefined && options.navigationBuildId.trim().length === 0) {
      throw new TypeError('React navigation build identity cannot be empty.');
    }
    class ReactRootModule extends ReactModule {}

    const pageRendererProvider: Provider<ReactPageRenderer> | undefined = options.renderPage === undefined
      ? undefined
      : { provide: REACT_PAGE_RENDERER, useValue: options.renderPage };
    const renderPolicyValidatorProvider: Provider = {
      provide: Symbol('fluo.react.render-policy-validator'),
      useValue: {
        onModuleInit(): void {
          validateReactRenderPolicyControllers(
            options.controllers,
            options.renderPage !== undefined,
          );
        },
      },
    };
    const exports = [
      ...(options.exports ?? []),
      ...(pageRendererProvider === undefined ? [] : [REACT_PAGE_RENDERER]),
    ];
    const providers = [
      ...(options.providers ?? []),
      renderPolicyValidatorProvider,
      ...(pageRendererProvider === undefined ? [] : [pageRendererProvider]),
    ];
    const middleware = [
      createReactPageResultMiddleware({
        ...(options.navigationBuildId === undefined ? {} : { navigationBuildId: options.navigationBuildId }),
        ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
        ...(options.renderPage === undefined ? {} : { renderPage: options.renderPage }),
      }),
      ...(options.middleware ?? []),
    ];
    const definition = {
      controllers: [...options.controllers],
      ...(exports.length > 0 ? { exports } : {}),
      ...(options.imports ? { imports: [...options.imports] } : {}),
      middleware,
      ...(providers.length > 0 ? { providers } : {}),
    } satisfies ModuleDefinition;

    return defineModule(ReactRootModule, definition);
  }
}
