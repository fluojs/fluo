import { test } from '@playwright/test';
import { runLongSession } from './long-session-run';

test('operates the seeded event-driven jukebox for the declared soak duration', async ({ page }, info) => {
  // Given: a separate job, not a PR correctness run disguised as a soak.
  const profile = process.env.FLUO_RELIABILITY_SOAK_PROFILE ?? 'scheduled';
  if (!['scheduled', 'lane-3886-one-hour'].includes(profile)) throw new Error('Unknown soak profile');
  const minimum = profile === 'lane-3886-one-hour' ? 3_600_000 : 7_200_000;
  const duration = Number(process.env.FLUO_RELIABILITY_SOAK_MS ?? minimum);
  if (!Number.isSafeInteger(duration) || duration < minimum) throw new Error('Soak is shorter than its declared profile');
  test.setTimeout(duration + 15 * 60_000);
  // When: event-settled cycles continue until the actual duration boundary.
  // Then: resource checkpoints and duration are independent requirements.
  await runLongSession(page, info, duration);
});
