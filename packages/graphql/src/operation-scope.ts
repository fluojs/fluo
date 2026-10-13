import type { Container } from '@fluojs/di';
import type { ApplicationLogger } from '@fluojs/runtime';

/**
 * Adds distinct cleanup failures, flattening aggregates without changing error identity.
 * @param errors Failures collected for the current cleanup pass.
 * @param error Cleanup failure to collect.
 */
export function collectCleanupError(errors: unknown[], error: unknown): void {
  if (error instanceof AggregateError) {
    for (const nested of error.errors) {
      collectCleanupError(errors, nested);
    }

    return;
  }

  if (errors.includes(error)) {
    return;
  }

  errors.push(error);
}

/** Owns HTTP operation containers until disposal succeeds, allowing later shutdown retry. */
export class HttpOperationScopes {
  private readonly containers = new Map<Request, Container>();

  constructor(private readonly runtimeContainer: Container, private readonly logger: ApplicationLogger) {}

  getOrCreate(request: Request): Container {
    const existing = this.containers.get(request);

    if (existing) {
      return existing;
    }

    const created = this.runtimeContainer.createRequestScope();
    this.containers.set(request, created);
    return created;
  }

  async dispose(request: Request): Promise<unknown> {
    const operationContainer = this.containers.get(request);

    if (!operationContainer) {
      return;
    }

    try {
      await operationContainer.dispose();
    } catch (error) {
      this.logger.error('Failed to dispose GraphQL operation container.', error, 'GraphqlLifecycleService');
      return error;
    }

    this.containers.delete(request);
  }

  async disposeAll(): Promise<void> {
    const cleanupErrors: unknown[] = [];

    for (const request of [...this.containers.keys()]) {
      const cleanupError = await this.dispose(request);

      if (cleanupError !== undefined) {
        collectCleanupError(cleanupErrors, cleanupError);
      }
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Failed to dispose GraphQL operation containers.');
    }
  }
}

/** Owns socket operation removal, shared disposal and failed-container retry independently of HTTP. */
export class WebSocketOperationScopes {
  private readonly active = new Map<object, Map<string, Container>>();
  private readonly failed = new Map<object, Set<Container>>();
  private readonly inFlight = new Map<Container, Promise<unknown>>();
  private attemptedInCleanup: Set<Container> | undefined;

  constructor(private readonly runtimeContainer: Container, private readonly logger: ApplicationLogger) {}

  beginCleanupPass(): void {
    this.attemptedInCleanup = new Set<Container>();
  }

  endCleanupPass(): void {
    this.attemptedInCleanup = undefined;
  }

  getSocketKeys(): Set<object> {
    return new Set([...this.active.keys(), ...this.failed.keys()]);
  }

  hasCapacity(socketKey: object, operationId: string, limit: number): boolean {
    const operations = this.active.get(socketKey);
    return operations?.has(operationId) === true || (operations?.size ?? 0) < limit;
  }

  getOrCreate(socketKey: object, operationId: string): Container {
    const existingSocketContainers = this.active.get(socketKey);

    const existing = existingSocketContainers?.get(operationId);

    if (existing) {
      return existing;
    }

    const created = this.runtimeContainer.createRequestScope();
    const socketContainers = existingSocketContainers ?? new Map<string, Container>();
    socketContainers.set(operationId, created);
    this.active.set(socketKey, socketContainers);
    return created;
  }

  async dispose(socketKey: object, operationId: string): Promise<unknown> {
    const socketContainers = this.active.get(socketKey);
    const operationContainer = socketContainers?.get(operationId);

    if (!operationContainer) {
      return;
    }

    socketContainers?.delete(operationId);

    if (socketContainers && socketContainers.size === 0) {
      this.active.delete(socketKey);
    }

    return await this.disposeContainerOnce(socketKey, operationContainer);
  }

  private async disposeContainerOnce(socketKey: object, operationContainer: Container): Promise<unknown> {
    const inFlight = this.inFlight.get(operationContainer);

    if (inFlight) {
      return await inFlight;
    }

    const attempted = this.attemptedInCleanup;

    if (attempted?.has(operationContainer)) {
      return undefined;
    }

    attempted?.add(operationContainer);

    const disposal = operationContainer
      .dispose()
      .then(
        () => {
          this.failed.get(socketKey)?.delete(operationContainer);
          return undefined;
        },
        (error: unknown) => {
          const failedContainers = this.failed.get(socketKey) ?? new Set<Container>();
          failedContainers.add(operationContainer);
          this.failed.set(socketKey, failedContainers);
          this.logger.error('Failed to dispose GraphQL websocket operation container.', error, 'GraphqlLifecycleService');
          return error;
        },
      )
      .finally(() => {
        this.inFlight.delete(operationContainer);
      });

    this.inFlight.set(operationContainer, disposal);

    return await disposal;
  }

  async disposeAll(socketKey: object): Promise<void> {
    const cleanupErrors: unknown[] = [];
    const failedContainers = this.failed.get(socketKey);

    for (const operationContainer of [...(failedContainers ?? [])]) {
      const cleanupError = await this.disposeContainerOnce(socketKey, operationContainer);

      if (cleanupError !== undefined) {
        collectCleanupError(cleanupErrors, cleanupError);
      }
    }

    if (failedContainers?.size === 0) {
      this.failed.delete(socketKey);
    }

    const socketContainers = this.active.get(socketKey);

    for (const operationId of [...(socketContainers?.keys() ?? [])]) {
      const cleanupError = await this.dispose(socketKey, operationId);

      if (cleanupError !== undefined) {
        collectCleanupError(cleanupErrors, cleanupError);
      }
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Failed to dispose GraphQL websocket operation containers.');
    }
  }
}
