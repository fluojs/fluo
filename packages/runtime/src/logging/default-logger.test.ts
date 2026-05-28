import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultApplicationLogger } from './default-logger.js';

describe('createDefaultApplicationLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes transport-neutral console output without process metadata', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    createDefaultApplicationLogger().log('Application started', 'Bootstrap');

    expect(log).toHaveBeenCalledWith('[fluo] LOG [Bootstrap] Application started');
  });

  it('writes error objects after the formatted message', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('boom');

    createDefaultApplicationLogger().error('Application failed', error, 'Bootstrap');

    expect(errorLog).toHaveBeenNthCalledWith(1, '[fluo] ERROR [Bootstrap] Application failed');
    expect(errorLog).toHaveBeenNthCalledWith(2, error);
  });
});
