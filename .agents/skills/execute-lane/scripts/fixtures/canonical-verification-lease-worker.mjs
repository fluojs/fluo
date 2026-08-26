import { readFileSync, readSync } from 'node:fs';

import {
  acquireCanonicalVerificationLease,
  releaseCanonicalVerificationLease,
} from '../review-loop-policy.mjs';

const [runtimeRoot, laneId, issueNumber, worktree, staleOwnerPath] =
  process.argv.slice(2);
let lease = null;

process.on('message', (message) => {
  if (message === 'start') {
    try {
      if (staleOwnerPath !== undefined) {
        const owner = JSON.parse(readFileSync(staleOwnerPath, 'utf8'));
        let live = true;
        try {
          process.kill(owner.pid, 0);
        } catch (error) {
          live = error?.code === 'EPERM';
        }
        if (live) {
          throw new TypeError('fixture expected a stale owner.');
        }
        process.send?.({ type: 'stale-observed', token: owner.token });
        readSync(4, Buffer.alloc(1), 0, 1, null);
      }
      lease = acquireCanonicalVerificationLease(
        runtimeRoot,
        laneId,
        Number(issueNumber),
        worktree,
      );
      process.send?.({ type: 'acquired', token: lease.token });
    } catch (error) {
      process.send?.({ type: 'rejected', message: error.message });
    }
    return;
  }
  if (message === 'release') {
    const released = lease === null
      ? false
      : releaseCanonicalVerificationLease(lease);
    process.send?.({ type: 'released', released });
    process.disconnect();
  }
});

process.send?.({ type: 'ready' });
