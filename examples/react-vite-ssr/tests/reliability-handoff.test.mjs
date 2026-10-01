import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumeHandoff } from './reliability-handoff.mjs';

test('rejects absent engine receipts before any device can be called complete', async (t) => {
  // Given: an isolated output root with no executed browser evidence.
  const root = mkdtempSync(join(tmpdir(), 'fluo-reliability-handoff-'));
  t.after(() => rmSync(root, { recursive: true }));
  // When: a caller tries to consume an incomplete exact-head handoff.
  // Then: machine-consumed missing coverage fails instead of producing evidence-complete.
  await assert.rejects(consumeHandoff({ version: 1, head: 'a'.repeat(40),
    correctnessReceipts: [], physicalDevices: [{ kind: 'mobile', physical: false }] }, root), /three correctness engines/u);
});
