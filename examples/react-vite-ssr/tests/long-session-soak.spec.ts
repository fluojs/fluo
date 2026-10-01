import { test } from '@playwright/test';
import { runLongSession } from './long-session-run';

test('operates the seeded event-driven jukebox for at least two hours', async ({ page }, info) => {
  // Given: a separate job, not a PR correctness run disguised as a soak.
  const duration = Number(process.env.FLUO_RELIABILITY_SOAK_MS ?? 2 * 60 * 60_000);
  if (!Number.isSafeInteger(duration) || duration < 2 * 60 * 60_000) throw new Error('Soak must be at least two hours');
  test.setTimeout(duration + 15 * 60_000);
  // When: event-settled cycles continue until the actual duration boundary.
  // Then: resource checkpoints and duration are independent requirements.
  await runLongSession(page, info, duration);
});
