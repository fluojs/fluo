import { getCurrentRequestContext } from '@konekti/http';

import type { ApplicationLogger } from './types.js';

type LogLevel = 'error' | 'log';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string;
  context?: string;
}

function buildEntry(level: LogLevel, message: string, context?: string): LogEntry {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };

  const requestId = getCurrentRequestContext()?.requestId;

  if (requestId) {
    entry.requestId = requestId;
  }

  if (context) {
    entry.context = context;
  }

  return entry;
}

export function createJsonApplicationLogger(): ApplicationLogger {
  return {
    error(message, _error, context) {
      process.stderr.write(JSON.stringify(buildEntry('error', message, context)) + '\n');
    },
    log(message, context) {
      process.stdout.write(JSON.stringify(buildEntry('log', message, context)) + '\n');
    },
  };
}
