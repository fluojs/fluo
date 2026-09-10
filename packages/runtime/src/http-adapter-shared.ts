import type { HttpApplicationAdapter } from '@fluojs/http/portable';

import { FluoFactory } from './bootstrap.js';
import { createDefaultApplicationLogger } from './logging/default-logger.js';
import type { Application, ApplicationLogger, CreateApplicationOptions, ModuleType } from './types.js';

export { createDefaultApplicationLogger };
export {
  createHttpAdapterMiddleware,
  formatHttpAdapterListenMessage,
  type HttpAdapterCorsInput,
  type HttpAdapterListenTarget,
  type HttpAdapterMiddlewareOptions,
} from './http-application-options.js';
export type { HttpAdapterShutdownRegistration } from './types.js';

/** Options retained for platform helpers pending their host-specific migrations. */
export type BootstrapHttpAdapterApplicationOptions = Omit<CreateApplicationOptions, 'adapter'>;

/** Options retained for platform run helpers, using the Factory lifecycle. */
export type RunHttpAdapterApplicationOptions = BootstrapHttpAdapterApplicationOptions;

/**
 * Bootstraps an HTTP application with the provided adapter and options.
 *
 * @param rootModule The root application module class.
 * @param options Bootstrap configuration for middleware and logging.
 * @param adapter The HTTP platform adapter to use.
 * @param logger Logger instance used for bootstrap diagnostics.
 * @returns A promise that resolves to the initialized application instance.
 */
export async function bootstrapHttpAdapterApplication(
  rootModule: ModuleType,
  options: BootstrapHttpAdapterApplicationOptions,
  adapter: HttpApplicationAdapter,
  logger: ApplicationLogger = options.logger ?? createDefaultApplicationLogger(),
): Promise<Application> {
  return FluoFactory.create(rootModule, { ...options, adapter, logger });
}

/**
 * Boots and runs an HTTP application using the provided adapter and options,
 * including setup for shutdown management and logging.
 *
 * @param rootModule - The root application module class.
 * @param options - Run configuration including shutdown and logging settings.
 * @param adapter - The managed HTTP platform adapter to use.
 * @param logger - Logger instance used for runtime diagnostics.
 * @returns A promise that resolves to the running application instance.
 */
export async function runHttpAdapterApplication(
  rootModule: ModuleType,
  options: RunHttpAdapterApplicationOptions,
  adapter: HttpApplicationAdapter,
  logger: ApplicationLogger = options.logger ?? createDefaultApplicationLogger(),
): Promise<Application> {
  const app = await FluoFactory.create(rootModule, { ...options, adapter, logger });
  await app.listen();
  return app;
}
