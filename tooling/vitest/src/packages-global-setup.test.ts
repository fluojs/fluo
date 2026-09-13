import { execFileSync } from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import packagesGlobalSetup from './packages-global-setup.js';

describe('packages project emitted artifact setup', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs the locked Terminus and Prisma build closures with a termination signal', () => {
    packagesGlobalSetup();

    expect(execFileSync).toHaveBeenCalledTimes(2);
    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      expect.arrayContaining(['@fluojs/terminus']),
      expect.objectContaining({
        killSignal: 'SIGTERM',
        timeout: 60_000,
      }),
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      expect.arrayContaining(['@fluojs/prisma']),
      expect.objectContaining({
        killSignal: 'SIGTERM',
        timeout: 60_000,
      }),
    );
  });
});
