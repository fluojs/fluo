import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createToneUrl } from '../fixture/audio.mjs';

test('all four apps receive the same playable one-second local WAV', async () => {
  // Given: the suite owns one audio fixture, not framework-specific generated samples.
  const first = createToneUrl();
  const second = createToneUrl();
  try {
    // When: both independent mounts load their blob resources.
    const [left, right] = await Promise.all([first, second].map(async (url) =>
      new Uint8Array(await (await fetch(url)).arrayBuffer())));
    // Then: the bytes, format, and duration match across mounts.
    assert.deepEqual(left, right);
    assert.equal(left.byteLength, 44 + 8000 * 2);
    assert.equal(new TextDecoder().decode(left.subarray(0, 4)), 'RIFF');
    assert.equal(new DataView(left.buffer).getUint32(24, true), 8000);
  } finally {
    URL.revokeObjectURL(first);
    URL.revokeObjectURL(second);
  }
});
