import type { MicroserviceTransportLogger } from '../types.js';

/**
 * Log transport event handler failure.
 *
 * @param logger The logger.
 * @param transportName The transport name.
 * @param error The error.
 */
export function logTransportEventHandlerFailure(
  logger: MicroserviceTransportLogger | undefined,
  transportName: string,
  error: unknown,
): void {
  logger?.error('Event handler failed.', error, transportName);
}
