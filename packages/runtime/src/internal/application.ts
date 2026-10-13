import { InvariantError, type PublicToken, type Token } from '@fluojs/core';
import type { Container } from '@fluojs/di';
import type { Dispatcher, HttpApplicationAdapter } from '@fluojs/http/portable';

import { formatHttpAdapterListenMessage } from '../http-application-options.js';
import type { RuntimePlatformShell } from '../platform-shell.js';
import { createLifecycleCloseError, createRetryableShutdownState } from '../retryable-shutdown.js';
import type { Application, ApplicationLogger, ApplicationState, CompiledModule, CreateApplicationOptions, CreateMicroserviceOptions, MicroserviceApplication, ModuleType } from '../types.js';
import { type ContextResolutionCache, type ContextCacheableTokens, installContextCacheInvalidation, resolveContextToken } from './context-resolution.js';
import { DEFAULT_MICROSERVICE_TOKEN, FluoMicroserviceApplication, isMicroserviceRuntime } from './microservice-application.js';
import { closeRuntimeResources, type RuntimeResources, type RuntimeCleanupCallback, type RuntimeShutdownPhase } from './runtime-resources.js';

/** Factory-owned HTTP assembly inputs; the shell owns their use and teardown. */
export interface HttpApplicationRuntime {
  readonly adapter: HttpApplicationAdapter;
  readonly hasHttpAdapter: boolean;
  readonly adapterlessListenMessage: string;
}

/**
 * 애플리케이션 라이프사이클과 상태 전이를 담당하는 최소 런타임 셸이다.
 */
export class FluoApplication implements Application {
  private applicationState: ApplicationState = 'bootstrapped';
  private closed = false;
  private closeStarted = false;
  private closingPromise: Promise<void> | undefined;
  private listenPromise: Promise<void> | undefined;
  private startupPromise: Promise<void> | undefined;
  private unregisterShutdownSignals: (() => void) | undefined;
  private readonly signalCleanupErrors: unknown[] = [];
  private connectedMicroservicesClosed = false;
  private readonly runtimeShutdownState = createRetryableShutdownState<RuntimeShutdownPhase>();
  private readonly contextResolutionCache: ContextResolutionCache = new Map();
  private readonly lifecycleInstances: unknown[];
  private readonly connectedMicroservices: MicroserviceApplication[] = [];

  readonly container: Container;
  readonly modules: CompiledModule[];
  private readonly adapter: HttpApplicationAdapter;
  private readonly runtimeCleanup: RuntimeCleanupCallback[];

  constructor(
    resources: RuntimeResources,
    readonly rootModule: ModuleType,
    readonly dispatcher: Dispatcher,
    readonly bootstrapTiming: Application['bootstrapTiming'],
    private readonly httpRuntime: HttpApplicationRuntime,
    private readonly platformShell: RuntimePlatformShell,
    private readonly logger: ApplicationLogger,
    private readonly contextCacheableTokens: ContextCacheableTokens,
    private readonly startupOptions: Pick<CreateApplicationOptions, 'shutdownRegistration' | 'forceExitTimeoutMs'>,
  ) {
    this.container = resources.container;
    this.modules = resources.modules;
    this.adapter = httpRuntime.adapter;
    this.runtimeCleanup = resources.runtimeCleanup;
    this.lifecycleInstances = resources.lifecycleInstances;
    installContextCacheInvalidation(this.container, this.contextResolutionCache, this.contextCacheableTokens);
  }

  get state(): ApplicationState {
    return this.applicationState;
  }

  get<T>(token: PublicToken<T>): Promise<T>;
  get<T>(token: Token<T>): Promise<T>;
  async get<T>(token: Token<T>): Promise<T> {
    if (this.closed) {
      return this.container.resolve(token);
    }

    this.assertProviderResolutionAllowed();
    const resolved = await resolveContextToken(
      this.container,
      token,
      this.contextCacheableTokens,
      this.contextResolutionCache,
    );
    this.assertProviderResolutionAllowed();

    return resolved;
  }

  /**
   * 애플리케이션이 더 이상 닫힌 상태가 아닌지 확인한다.
   */
  async ready(): Promise<void> {
    if (this.applicationState === 'closed') {
      throw new InvariantError('Application cannot become ready after it has been closed.');
    }

    await this.platformShell.assertCriticalReadiness();
  }

  async connectMicroservice(options: CreateMicroserviceOptions = {}): Promise<MicroserviceApplication> {
    this.assertApplicationOperationAllowed('connect a microservice');
    const microserviceToken = options.microserviceToken ?? DEFAULT_MICROSERVICE_TOKEN;
    const runtime = await this.container.resolve<unknown>(microserviceToken);
    this.assertApplicationOperationAllowed('connect a microservice');

    if (!isMicroserviceRuntime(runtime)) {
      throw new InvariantError('Resolved microservice token does not implement listen().');
    }

    const microservice = new FluoMicroserviceApplication(this, this.logger, runtime, false);
    this.connectedMicroservices.push(microservice);

    return microservice;
  }

  async startAllMicroservices(): Promise<void> {
    this.assertApplicationOperationAllowed('start microservices');
    const startedMicroservices: MicroserviceApplication[] = [];

    for (const microservice of this.connectedMicroservices) {
      try {
        this.assertApplicationOperationAllowed('start microservices');
        await microservice.listen();
        startedMicroservices.push(microservice);
      } catch (error) {
        await this.rollbackStartedMicroservices(startedMicroservices);
        throw error;
      }
    }
  }

  private async rollbackStartedMicroservices(startedMicroservices: readonly MicroserviceApplication[]): Promise<void> {
    for (const microservice of [...startedMicroservices].reverse()) {
      try {
        await microservice.close('bootstrap-failed');
      } catch (rollbackError) {
        this.logger.error(
          'Failed to roll back a started microservice after startup failure.',
          rollbackError,
          'FluoApplication',
        );
      }
    }
  }

  private async closeConnectedMicroservices(signal?: string): Promise<void> {
    const errors: unknown[] = [];

    for (const microservice of [...this.connectedMicroservices].reverse()) {
      try {
        await microservice.close(signal);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw createLifecycleCloseError(errors);
    }
  }

  private assertApplicationOperationAllowed(
    operation: 'connect a microservice' | 'dispatch' | 'start microservices',
  ): void {
    if (this.closeStarted) {
      throw new InvariantError(`Application cannot ${operation} after shutdown has started.`);
    }
  }

  private assertProviderResolutionAllowed(): void {
    if (this.closeStarted) {
      throw new InvariantError('Application cannot resolve providers after shutdown has started.');
    }
  }

  /**
   * 준비 검사를 통과한 뒤 어댑터에 바인딩을 위임하고 상태를 `ready`로 전이한다.
   */
  async listen(): Promise<void> {
    if (this.closeStarted) {
      throw new InvariantError('Application cannot listen after it has been closed.');
    }

    if (!this.httpRuntime.hasHttpAdapter) {
      throw new InvariantError(
        this.httpRuntime.adapterlessListenMessage,
      );
    }

    if (!this.startupPromise) {
      // Publish the transition before adapter or host callbacks can re-enter.
      // Close waits only for raw startup, never for startup's failure cleanup.
      this.listenPromise = Promise.resolve().then(() => this.startListening()).finally(() => {
        this.listenPromise = undefined;
      });
      this.startupPromise = this.listenPromise.catch(async (error: unknown) => {
        try {
          await this.close('bootstrap-failed');
        } catch (cleanupError) {
          try {
            this.logger.error('Failed to close application after startup failure.', cleanupError, 'FluoFactory');
          } catch {
            throw error;
          }
        }
        throw error;
      });
    }

    await this.startupPromise;
  }

  private async startListening(): Promise<void> {
    await this.ready();
    try {
      await this.adapter.listen(this.dispatcher);
    } catch (error: unknown) {
      try {
        this.logger.error('Failed to start the HTTP adapter.', error, 'FluoApplication');
      } catch {
        throw error;
      }
      throw error;
    }

    if (this.closeStarted) {
      throw new InvariantError('Application startup was interrupted by shutdown.');
    }

    this.applicationState = 'ready';
    this.logger.log('fluo application successfully started.', 'FluoApplication');
    const target = this.adapter.getListenTarget?.();
    if (target) {
      this.logger.log(formatHttpAdapterListenMessage(target), 'FluoFactory');
    }

    try {
      this.unregisterShutdownSignals = this.startupOptions.shutdownRegistration?.(
        this,
        this.logger,
        this.startupOptions.forceExitTimeoutMs,
      ) ?? undefined;
    } catch (error) {
      try {
        this.logger.error('Failed to register shutdown signals.', error, 'FluoFactory');
      } catch {
        throw error;
      }
      throw error;
    }

    if (this.closeStarted) {
      throw new InvariantError('Application startup was interrupted by shutdown.');
    }
  }

  dispatch = async (...args: Parameters<Dispatcher['dispatch']>): Promise<void> => {
    this.assertApplicationOperationAllowed('dispatch');
    await this.dispatcher.dispatch(...args);
  };

  /**
   * 어댑터 종료와 shutdown hook 실행을 담당하는 명시적 종료 경로다.
   */
  async close(signal?: string): Promise<void> {
    if (this.closed) {
      if (this.signalCleanupErrors.length > 0) {
        throw createLifecycleCloseError(this.signalCleanupErrors);
      }
      return;
    }

    if (this.closingPromise) {
      await this.closingPromise;
      return;
    }

    this.closeStarted = true;

    let resolveClose: () => void = () => undefined;
    let rejectClose: (reason?: unknown) => void = () => undefined;
    this.closingPromise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    void (async () => {
      const errors: unknown[] = [];

      if (this.listenPromise) {
        // Startup's caller receives its failure; teardown must still proceed.
        await this.listenPromise.then(() => undefined, () => undefined);
      }

      const unregister = this.unregisterShutdownSignals;
      this.unregisterShutdownSignals = undefined;
      try {
        unregister?.();
      } catch (error) {
        this.signalCleanupErrors.push(error);
      }

      if (!this.connectedMicroservicesClosed) {
        try {
          await this.closeConnectedMicroservices(signal);
          this.connectedMicroservicesClosed = true;
        } catch (error) {
          errors.push(error);
        }
      }

      try {
        await closeRuntimeResources({
          adapter: this.adapter,
          container: this.container,
          lifecycleInstances: this.lifecycleInstances,
          modules: this.modules,
          runtimeCleanup: this.runtimeCleanup,
          shutdownState: this.runtimeShutdownState,
          signal,
        });
      } catch (error) {
        errors.push(error);
      }

      if (errors.length > 0) {
        throw createLifecycleCloseError([...this.signalCleanupErrors, ...errors]);
      }

      this.closed = true;
      this.applicationState = 'closed';
      if (this.signalCleanupErrors.length > 0) {
        throw createLifecycleCloseError(this.signalCleanupErrors);
      }
    })().then(resolveClose, rejectClose);

    try {
      await this.closingPromise;
    } catch (error) {
      this.closingPromise = undefined;
      throw error;
    }
  }
}
