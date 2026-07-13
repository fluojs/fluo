import { describe, expect, it, vi } from 'vitest';

const filesystemMockState = vi.hoisted(() => ({
  loads: 0,
}));

describe('@fluojs/terminus root import runtime safety', () => {
  it('does not load the optional Redis peer from the root entrypoint', async () => {
    vi.resetModules();
    vi.doMock('@fluojs/redis', () => {
      throw new Error('optional Redis peer should only load through @fluojs/terminus/redis');
    });

    try {
      const terminus = await import('./index.js');

      expect(terminus).toHaveProperty('TerminusModule');
      expect(terminus).not.toHaveProperty('RedisHealthIndicator');
    } finally {
      vi.doUnmock('@fluojs/redis');
    }
  });

  it('does not load the optional Prisma peer from the root entrypoint', async () => {
    vi.resetModules();
    vi.doMock('@fluojs/prisma', () => {
      throw new Error('optional Prisma peer should not load through @fluojs/terminus');
    });

    try {
      const terminus = await import('./index.js');

      expect(terminus).toHaveProperty('TerminusModule');
      expect(terminus).toHaveProperty('PrismaHealthIndicator');
    } finally {
      vi.doUnmock('@fluojs/prisma');
    }
  });

  it('does not load the optional Drizzle peer from the root entrypoint', async () => {
    vi.resetModules();
    vi.doMock('@fluojs/drizzle', () => {
      throw new Error('optional Drizzle peer should not load through @fluojs/terminus');
    });

    try {
      const terminus = await import('./index.js');

      expect(terminus).toHaveProperty('TerminusModule');
      expect(terminus).toHaveProperty('DrizzleHealthIndicator');
    } finally {
      vi.doUnmock('@fluojs/drizzle');
    }
  });

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

    try {
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
    } finally {
      vi.doUnmock('node:fs/promises');
    }
  });
});
