import { describe, expect, it, vi } from 'vitest';

describe('CLI command lazy boundaries', () => {
  it('dispatches version before loading the runtime inspection command', async () => {
    const stderr: string[] = [];
    const stdout: string[] = [];

    vi.resetModules();
    vi.doMock('@fluojs/runtime', () => {
      throw new Error('runtime inspection dependency must remain unloaded');
    });

    try {
      const { runCli } = await import('./cli.js');
      const exitCode = await runCli(['version'], {
        stderr: { write: (message) => stderr.push(message) },
        stdout: { write: (message) => stdout.push(message) },
      });

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(stdout.join('')).toMatch(/^\d+\.\d+\.\d+\n$/);
    } finally {
      vi.doUnmock('@fluojs/runtime');
      vi.resetModules();
    }
  });
});
