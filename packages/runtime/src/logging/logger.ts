import type { ApplicationLogger } from '../types.js';

const RESET = '\u001B[0m';
const BRIGHT_GREEN = '\u001B[32m';
const BRIGHT_RED = '\u001B[31m';
const BRIGHT_YELLOW = '\u001B[33m';
const DIM = '\u001B[2m';

function colorize(value: string, color: string, enabled: boolean): string {
  return enabled ? `${color}${value}${RESET}` : value;
}

function formatLog(level: 'DEBUG' | 'ERROR' | 'LOG' | 'WARN', context: string, message: string, color: boolean): string {
  const prefix = colorize('[fluo]', BRIGHT_GREEN, color);
  const pid = colorize(String(process.pid), BRIGHT_YELLOW, color);
  const timestamp = colorize(new Date().toLocaleString('en-US'), DIM, color);
  const levelColor = level === 'ERROR' || level === 'WARN' ? BRIGHT_RED : BRIGHT_GREEN;
  const levelLabel = colorize(level, levelColor, color);
  const contextLabel = colorize(`[${context}]`, BRIGHT_YELLOW, color);

  return `${prefix} ${pid} - ${timestamp} ${levelLabel} ${contextLabel} ${message}`;
}

/**
 * Create console application logger.
 *
 * @returns The create console application logger result.
 */
export function createConsoleApplicationLogger(): ApplicationLogger {
  return {
    debug(message, context = 'fluo') {
      console.debug(formatLog('DEBUG', context, message, Boolean(process.stdout.isTTY)));
    },
    error(message, error, context = 'fluo') {
      console.error(formatLog('ERROR', context, message, Boolean(process.stderr.isTTY)));

      if (error) {
        console.error(error);
      }
    },
    log(message, context = 'fluo') {
      console.log(formatLog('LOG', context, message, Boolean(process.stdout.isTTY)));
    },
    warn(message, context = 'fluo') {
      console.warn(formatLog('WARN', context, message, Boolean(process.stderr.isTTY)));
    },
  };
}
