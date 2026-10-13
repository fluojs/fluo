import { InvariantError, type Token } from '@fluojs/core';
import type { Container } from '@fluojs/di';

import { createLifecycleCloseError } from '../retryable-shutdown.js';
import type { ApplicationContext, ApplicationLogger, ApplicationState, CompiledModule, MicroserviceApplication, MicroserviceRuntime, ModuleType } from '../types.js';
import { hasMethod } from './lifecycle.js';

/**
 * Same-realm default token for the microservice runtime.
 *
 * @internal
 */
export const DEFAULT_MICROSERVICE_TOKEN = Symbol.for('fluo.microservices.service') as Token<MicroserviceRuntime>;

/**
 * Recognizes the runtime transport listen capability.
 *
 * @internal
 * @param value Candidate capability owner.
 * @returns Whether the runtime implements listen().
 */
export function isMicroserviceRuntime(value: unknown): value is MicroserviceRuntime {
  return hasMethod(value, 'listen');
}

function hasMicroserviceRuntimeClose(value: MicroserviceRuntime): value is MicroserviceRuntime & { close(signal?: string): void | Promise<void> } {
  return typeof value.close === 'function';
}

async function closeMicroserviceRuntime(runtime: MicroserviceRuntime, signal?: string): Promise<void> {
  if (!hasMicroserviceRuntimeClose(runtime)) {
    return;
  }

  await runtime.close(signal);
}

/**
 * Transport shell retaining terminal close results and explicit context ownership.
 *
 * @internal
 */
export class FluoMicroserviceApplication implements MicroserviceApplication {
  private closed = false;
  private closeStarted = false;
  private closingPromise: Promise<void> | undefined;
  private listenPromise: Promise<void> | undefined;
  private microserviceState: ApplicationState = 'bootstrapped';

  constructor(
    private readonly context: ApplicationContext,
    private readonly logger: ApplicationLogger,
    private readonly runtime: MicroserviceRuntime,
    private readonly closeContextOnClose: boolean,
  ) {}

  get container(): Container {
    return this.context.container;
  }

  get modules(): CompiledModule[] {
    return this.context.modules;
  }

  get rootModule(): ModuleType {
    return this.context.rootModule;
  }

  get state(): ApplicationState {
    return this.microserviceState;
  }

  async get<T>(token: Token<T>): Promise<T> {
    return this.context.get(token);
  }

  async listen(): Promise<void> {
    if (this.closeStarted) {
      throw new InvariantError('Microservice cannot listen after it has been closed.');
    }

    if (this.microserviceState === 'ready') {
      return;
    }

    if (this.listenPromise) {
      await this.listenPromise;
      return;
    }

    this.listenPromise = this.startListening();

    try {
      await this.listenPromise;
    } finally {
      this.listenPromise = undefined;
    }
  }

  private async startListening(): Promise<void> {
    if (this.closeStarted) {
      throw new InvariantError('Microservice cannot listen after it has been closed.');
    }

    await this.runtime.listen();

    if (this.closeStarted) {
      throw new InvariantError('Microservice startup was interrupted by shutdown.');
    }

    this.microserviceState = 'ready';
    this.logger.log('fluo microservice successfully started.', 'FluoFactory');
  }

  async send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    this.assertTransportIngressOpen('send');

    if (!this.runtime.send) {
      throw new InvariantError('Resolved microservice runtime does not implement send().');
    }

    return await this.runtime.send(pattern, payload, signal);
  }

  async emit(pattern: string, payload: unknown): Promise<void> {
    this.assertTransportIngressOpen('emit');

    if (!this.runtime.emit) {
      throw new InvariantError('Resolved microservice runtime does not implement emit().');
    }

    await this.runtime.emit(pattern, payload);
  }

  async close(signal?: string): Promise<void> {
    if (this.closed) {
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
      this.runtime.markShutdownStarted?.();

      if (this.listenPromise) {
        try {
          await this.listenPromise;
        } catch {}
      }

      if (this.closeContextOnClose) {
        const errors: unknown[] = [];

        try {
          await closeMicroserviceRuntime(this.runtime, signal);
        } catch (error) {
          errors.push(error);
        }

        try {
          await this.context.close(signal);
        } catch (error) {
          errors.push(error);
        }

        if (errors.length > 0) {
          throw createLifecycleCloseError(errors);
        }
      } else {
        await closeMicroserviceRuntime(this.runtime, signal);
      }

      this.closed = true;
      this.microserviceState = 'closed';
    })().then(resolveClose, rejectClose);

    await this.closingPromise;
  }

  private assertTransportIngressOpen(operation: 'emit' | 'send'): void {
    if (this.closeStarted) {
      throw new InvariantError(`Microservice cannot ${operation} after shutdown has started.`);
    }
  }
}
