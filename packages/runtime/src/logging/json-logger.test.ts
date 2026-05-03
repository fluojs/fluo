import { afterEach, describe, expect, it, vi } from 'vitest';

import { createJsonApplicationLogger } from './json-logger.js';

describe('createJsonApplicationLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps structured JSON output stable while console logger options evolve', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createJsonApplicationLogger();
    const error = new Error('boom');

    logger.log('Application started', 'Bootstrap');
    logger.error('Application failed', error, 'Bootstrap');

    const logEntry = JSON.parse(String(stdout.mock.calls[0]?.[0])) as { context: string; level: string; message: string; timestamp: string };
    const errorEntry = JSON.parse(String(stderr.mock.calls[0]?.[0])) as { context: string; error: { message: string; name: string }; level: string; message: string };

    expect(logEntry).toMatchObject({ context: 'Bootstrap', level: 'log', message: 'Application started' });
    expect(logEntry.timestamp).toEqual(expect.any(String));
    expect(errorEntry).toMatchObject({
      context: 'Bootstrap',
      error: { message: 'boom', name: 'Error' },
      level: 'error',
      message: 'Application failed',
    });
  });
});
