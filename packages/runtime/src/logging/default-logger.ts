import type { ApplicationLogger } from '../types.js';

function formatDefaultLog(level: 'DEBUG' | 'ERROR' | 'LOG' | 'WARN', context: string, message: string): string {
  return `[fluo] ${level} [${context}] ${message}`;
}

/**
 * Creates the transport-neutral runtime logger used by default root bootstrap flows.
 *
 * @returns Application logger that writes through `console` without Node-only process metadata.
 */
export function createDefaultApplicationLogger(): ApplicationLogger {
  return {
    debug(message, context = 'fluo') {
      console.debug(formatDefaultLog('DEBUG', context, message));
    },
    error(message, error, context = 'fluo') {
      console.error(formatDefaultLog('ERROR', context, message));

      if (error) {
        console.error(error);
      }
    },
    log(message, context = 'fluo') {
      console.log(formatDefaultLog('LOG', context, message));
    },
    warn(message, context = 'fluo') {
      console.warn(formatDefaultLog('WARN', context, message));
    },
  };
}
