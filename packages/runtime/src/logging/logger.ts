import type { ApplicationLogger } from '../types.js';

/** Severity threshold accepted by `createConsoleApplicationLogger(...)`. */
export type ConsoleApplicationLoggerLevel = 'debug' | 'error' | 'log' | 'warn';
/** Console formatting mode accepted by `createConsoleApplicationLogger(...)`. */
export type ConsoleApplicationLoggerMode = 'minimal' | 'pretty' | 'silent';

/** Options used to tune the Node console logger without replacing the runtime logger contract. */
export interface ConsoleApplicationLoggerOptions {
  /**
   * Controls console formatting.
   *
   * - `pretty` keeps the historical timestamp, pid, level, context, and message format.
   * - `minimal` writes only `[fluo] LEVEL [context] message`.
   * - `silent` suppresses all logger methods.
   */
  mode?: ConsoleApplicationLoggerMode;
  /** Lowest severity emitted by the logger. Defaults to `debug`, preserving existing output. */
  level?: ConsoleApplicationLoggerLevel;
  /** Override TTY-aware ANSI color detection. */
  color?: boolean;
}

const RESET = '\u001B[0m';
const BRIGHT_GREEN = '\u001B[32m';
const BRIGHT_RED = '\u001B[31m';
const BRIGHT_YELLOW = '\u001B[33m';
const DIM = '\u001B[2m';

const LEVEL_PRIORITY: Record<ConsoleApplicationLoggerLevel, number> = {
  debug: 10,
  log: 20,
  warn: 30,
  error: 40,
};

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

function formatMinimalLog(level: 'DEBUG' | 'ERROR' | 'LOG' | 'WARN', context: string, message: string, color: boolean): string {
  const prefix = colorize('[fluo]', BRIGHT_GREEN, color);
  const levelColor = level === 'ERROR' || level === 'WARN' ? BRIGHT_RED : BRIGHT_GREEN;
  const levelLabel = colorize(level, levelColor, color);
  const contextLabel = colorize(`[${context}]`, BRIGHT_YELLOW, color);

  return `${prefix} ${levelLabel} ${contextLabel} ${message}`;
}

function shouldLog(currentLevel: ConsoleApplicationLoggerLevel, configuredLevel: ConsoleApplicationLoggerLevel): boolean {
  return LEVEL_PRIORITY[currentLevel] >= LEVEL_PRIORITY[configuredLevel];
}

/**
 * Create console application logger.
 *
 * @param options Console logger mode, severity threshold, and color override.
 * @returns The create console application logger result.
 */
export function createConsoleApplicationLogger(options: ConsoleApplicationLoggerOptions = {}): ApplicationLogger {
  const mode = options.mode ?? 'pretty';
  const level = options.level ?? 'debug';
  const format = mode === 'minimal' ? formatMinimalLog : formatLog;

  if (mode === 'silent') {
    return {
      debug() {},
      error() {},
      log() {},
      warn() {},
    };
  }

  return {
    debug(message, context = 'fluo') {
      if (shouldLog('debug', level)) {
        console.debug(format('DEBUG', context, message, options.color ?? Boolean(process.stdout.isTTY)));
      }
    },
    error(message, error, context = 'fluo') {
      if (!shouldLog('error', level)) {
        return;
      }

      console.error(format('ERROR', context, message, options.color ?? Boolean(process.stderr.isTTY)));

      if (error) {
        console.error(error);
      }
    },
    log(message, context = 'fluo') {
      if (shouldLog('log', level)) {
        console.log(format('LOG', context, message, options.color ?? Boolean(process.stdout.isTTY)));
      }
    },
    warn(message, context = 'fluo') {
      if (shouldLog('warn', level)) {
        console.warn(format('WARN', context, message, options.color ?? Boolean(process.stderr.isTTY)));
      }
    },
  };
}
