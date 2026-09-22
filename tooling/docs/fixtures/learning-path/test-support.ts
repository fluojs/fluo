import type { TestApp } from '@fluojs/testing';
import { expect } from 'vitest';

/**
 * Shared deterministic assertions for the learning-path checkpoint suites.
 *
 * The seed record matches the exact data every checkpoint directory ships,
 * and every stage keeps the root-owned /health and /ready endpoints.
 */

export const SEED_POST = { id: '1', title: 'Hello Fluo', content: 'First post' } as const;

export async function expectHealthAndReady(app: TestApp): Promise<void> {
  const health = await app.request('GET', '/health').send();
  expect(health.status).toBe(200);
  expect(health.body).toEqual({ status: 'ok' });

  const ready = await app.request('GET', '/ready').send();
  expect(ready.status).toBe(200);
  expect(ready.body).toEqual({ status: 'ready' });
}
