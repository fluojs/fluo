import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  acquireIssueSupervisorLease,
  heartbeatIssueSupervisorLease,
  releaseIssueSupervisorLease,
} from './issue-supervisor-files.mjs';

const directory = () => realpathSync(mkdtempSync(join(tmpdir(), 'fluo-issue-lease-')));

const options = (identities, now, pid) => ({
  pid,
  now: () => now.value,
  stale_after_ms: 100,
  process_identity: (requestedPid) => identities.get(requestedPid) ?? null,
});

test('issue supervisor lease protects a live owner and releases only its token', () => {
  const root = directory();
  const identities = new Map([[101, 'start-a'], [202, 'start-b']]);
  const now = { value: 1_000 };
  try {
    const first = acquireIssueSupervisorLease(root, options(identities, now, 101));
    assert.throws(
      () => acquireIssueSupervisorLease(root, options(identities, now, 202)),
      /already held/u,
    );
    assert.equal(releaseIssueSupervisorLease({ ...first, token: '00000000-0000-0000-0000-000000000000' }), false);
    assert.equal(heartbeatIssueSupervisorLease(first), true);
    assert.equal(releaseIssueSupervisorLease(first), true);
    const second = acquireIssueSupervisorLease(root, options(identities, now, 202));
    assert.equal(releaseIssueSupervisorLease(first), false);
    assert.equal(releaseIssueSupervisorLease(second), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('issue supervisor lease recovers crashes and PID reuse without timing waits', () => {
  const root = directory();
  const identities = new Map([[101, 'start-a'], [202, 'start-b']]);
  const now = { value: 1_000 };
  try {
    const crashed = acquireIssueSupervisorLease(root, options(identities, now, 101));
    identities.delete(101);
    const recovered = acquireIssueSupervisorLease(root, options(identities, now, 202));
    assert.equal(releaseIssueSupervisorLease(crashed), false);
    assert.equal(releaseIssueSupervisorLease(recovered), true);

    identities.set(101, 'start-a');
    const reused = acquireIssueSupervisorLease(root, options(identities, now, 101));
    identities.set(101, 'start-reused');
    const takeover = acquireIssueSupervisorLease(root, options(identities, now, 202));
    assert.equal(releaseIssueSupervisorLease(reused), false);
    assert.equal(releaseIssueSupervisorLease(takeover), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('issue supervisor lease never reclaims an inconclusive live owner regardless of age', () => {
  const root = directory();
  const identities = new Map([[101, 'start-a'], [202, 'start-b']]);
  const alive = new Set([101, 202]);
  const now = { value: 1_000 };
  try {
    const first = acquireIssueSupervisorLease(root, {
      ...options(identities, now, 101),
      process_alive: (pid) => alive.has(pid),
    });
    identities.delete(101);
    now.value = 100_000;
    assert.throws(
      () => acquireIssueSupervisorLease(root, {
        ...options(identities, now, 202),
        process_alive: (pid) => alive.has(pid),
      }),
      /already held/u,
    );
    alive.delete(101);
    const replacement = acquireIssueSupervisorLease(root, {
      ...options(identities, now, 202),
      process_alive: (pid) => alive.has(pid),
    });
    assert.equal(releaseIssueSupervisorLease(first), false);
    assert.equal(releaseIssueSupervisorLease(replacement), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('issue supervisor heartbeat uses the injected clock and stale live owners remain protected', () => {
  const root = directory();
  const identities = new Map([[101, 'start-a'], [202, 'start-b']]);
  const now = { value: 1_000 };
  try {
    const first = acquireIssueSupervisorLease(root, options(identities, now, 101));
    now.value = 2_000;
    assert.equal(heartbeatIssueSupervisorLease(first), true);
    now.value = 9_000;
    assert.throws(
      () => acquireIssueSupervisorLease(root, options(identities, now, 202)),
      /already held/u,
    );
    releaseIssueSupervisorLease(first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
