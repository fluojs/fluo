import type { MicroserviceTransportLogger } from '../types.js';

export function logTransportEventHandlerFailure(
  logger: MicroserviceTransportLogger | undefined,
  transportName: string,
  error: unknown,
): void {
  logger?.error('Event handler failed.', error, transportName);
}
