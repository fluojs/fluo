import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const { acquireLease } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/lane-lease.mjs',
  )
);

describe('execute-lane parent lane lease', () => {
  it('rejects a live owner and recovers a dead owner', () => {
    const directory = mkdtempSync(
      resolve(tmpdir(), 'fluo-parent-lease-'),
    );
    const starts = new Map([
      [101, 'process-101-start-a'],
      [202, 'process-202-start-a'],
    ]);
    const processIdentity = (pid: number) => starts.get(pid) ?? null;
    try {
      const first = acquireLease(directory, 'lane-4101-runtime', {
        pid: 101,
        process_identity: processIdentity,
        process_alive: (pid: number) => pid === 101,
      });
      expect(() =>
        acquireLease(directory, 'lane-4101-runtime', {
          pid: 202,
          process_identity: processIdentity,
          process_alive: (pid: number) => pid === 101,
        }),
      ).toThrow(/already held/u);

      starts.delete(101);
      const recovered = acquireLease(directory, 'lane-4101-runtime', {
        pid: 202,
        process_identity: (pid: number) =>
          pid === 202 ? 'process-202-start-a' : null,
        process_alive: () => false,
      });
      expect(first.release('stale-owner')).toBe(false);
      expect(recovered.release('settled')).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('recovers a reused PID only when its start fingerprint differs', () => {
    const directory = mkdtempSync(
      resolve(tmpdir(), 'fluo-parent-lease-reused-'),
    );
    try {
      const first = acquireLease(directory, 'lane-4101-runtime', {
        pid: 101,
        process_identity: () => 'process-101-start-a',
        process_alive: () => true,
      });
      const recovered = acquireLease(directory, 'lane-4101-runtime', {
        pid: 202,
        process_identity: (pid: number) =>
          pid === 101
            ? 'process-101-start-b'
            : 'process-202-start-a',
        process_alive: () => true,
      });

      expect(first.release('stale-owner')).toBe(false);
      expect(recovered.release('settled')).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
