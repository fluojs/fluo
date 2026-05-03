import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConsoleApplicationLogger } from './logger.js';

describe('createConsoleApplicationLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the default pretty console format compatible', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    createConsoleApplicationLogger({ color: false }).log('Application started', 'Bootstrap');

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toMatch(/^\[fluo\] \d+ - .+ LOG \[Bootstrap\] Application started$/);
  });

  it('honors explicit force color input when stdout is not a TTY', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalStdoutIsTty = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });

    try {
      createConsoleApplicationLogger({ environment: { forceColor: '1' } }).log('Application started', 'Bootstrap');
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalStdoutIsTty });
    }

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain('\u001B[32m[fluo]\u001B[0m');
    expect(log.mock.calls[0]?.[0]).toContain('\u001B[32mLOG\u001B[0m');
    expect(log.mock.calls[0]?.[0]).toContain('\u001B[33m[Bootstrap]\u001B[0m');
  });

  it('lets explicit no color input override force color input', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const originalStdoutIsTty = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });

    try {
      createConsoleApplicationLogger({ environment: { forceColor: '1', noColor: true } }).log(
        'Application started',
        'Bootstrap',
      );
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalStdoutIsTty });
    }

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).not.toContain('\u001B[');
    expect(log.mock.calls[0]?.[0]).toMatch(/^\[fluo\] \d+ - .+ LOG \[Bootstrap\] Application started$/);
  });

  it('filters messages below the configured level', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const logger = createConsoleApplicationLogger({ color: false, level: 'warn' });

    logger.debug('debug');
    logger.log('log');
    logger.warn('warn');
    logger.error('error');

    expect(debug).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('supports minimal output without timestamp and process metadata', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    createConsoleApplicationLogger({ color: false, mode: 'minimal' }).warn('Retrying connection', 'Worker');

    expect(warn).toHaveBeenCalledWith('[fluo] WARN [Worker] Retrying connection');
  });

  it('suppresses every method in silent mode including error objects', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const logger = createConsoleApplicationLogger({ mode: 'silent' });

    logger.debug('debug');
    logger.log('log');
    logger.warn('warn');
    logger.error('error', new Error('boom'));

    expect(debug).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
