import { describe, expect, it, vi } from 'vitest';

const filesystemMockState = vi.hoisted(() => ({
  loads: 0,
}));

describe('@fluojs/terminus root import runtime safety', () => {
  it('does not load Node filesystem modules until disk checks run', async () => {
    vi.resetModules();
    vi.doMock('node:fs/promises', () => {
      filesystemMockState.loads += 1;

      return {
        statfs: async () => {
          throw new Error('disk check should lazy-load node filesystem modules');
        },
      };
    });

    const terminus = await import('./index.js');

    expect(terminus).toHaveProperty('TerminusModule');
    expect(filesystemMockState.loads).toBe(0);
    await expect(new terminus.DiskHealthIndicator({ key: 'disk' }).check('disk')).rejects.toMatchObject({
      causes: {
        disk: {
          message: 'disk check should lazy-load node filesystem modules',
          status: 'down',
        },
      },
    });
    expect(filesystemMockState.loads).toBe(1);

    vi.doUnmock('node:fs/promises');
  });
});
