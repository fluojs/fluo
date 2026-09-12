import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { withCleanup } from './with-cleanup.js';

describe('explicit test cleanup ownership', () => {
  it('returns the operation result after successful cleanup', async () => {
    const result = { value: 42 };
    const cleanup = vi.fn(async () => undefined);
    await expect(withCleanup(async (defer) => {
      defer(cleanup);
      return result;
    })).resolves.toBe(result);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('preserves an asynchronous operation failure after cleanup', async () => {
    const primary = new Error('operation');
    const cleanup = vi.fn();
    await expect(withCleanup(async (defer) => {
      defer(cleanup);
      throw primary;
    })).rejects.toBe(primary);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('surfaces a cleanup failure after a successful operation', async () => {
    const failure = new Error('cleanup');
    await expect(withCleanup((defer) => {
      defer(async () => { throw failure; });
      return 42;
    })).rejects.toBe(failure);
  });

  it.each([false, true])('retains every cleanup failure in reverse order (primary failure: %s)', async (operationFails) => {
    const primary = new Error('operation');
    const first = new Error('first cleanup');
    const second = new Error('second cleanup');
    const calls: number[] = [];
    const result = withCleanup((defer) => {
      defer(() => { calls.push(1); throw first; });
      defer(async () => { calls.push(2); throw second; });
      defer(() => { calls.push(3); });
      if (operationFails) throw primary;
    });
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    await expect(result).rejects.toMatchObject({ errors: operationFails ? [primary, second, first] : [second, first] });
    expect(calls).toEqual([3, 2, 1]);
  });

  it('runs cleanup in reverse order on an early return', async () => {
    const calls: number[] = [];
    await expect(withCleanup((defer) => {
      defer(() => { calls.push(1); });
      defer(() => { calls.push(2); });
      if (calls.length === 0) return 'early';
      throw new Error('unreachable');
    })).resolves.toBe('early');
    expect(calls).toEqual([2, 1]);
  });

  it('preserves a synchronous throw and still runs cleanup', async () => {
    const primary = new Error('synchronous operation');
    const cleanup = vi.fn();
    await expect(withCleanup((defer) => {
      defer(cleanup);
      throw primary;
    })).rejects.toBe(primary);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it.each(['operation', 'cleanup', 'both'] as const)('does not mistake throw undefined for success (%s)', async (phase) => {
    const cleanup = vi.fn(() => {
      if (phase !== 'operation') throw undefined;
    });
    const result = withCleanup((defer) => {
      defer(cleanup);
      if (phase !== 'cleanup') throw undefined;
    });
    if (phase === 'both') {
      await expect(result).rejects.toBeInstanceOf(AggregateError);
      await expect(result).rejects.toMatchObject({ errors: [undefined, undefined] });
    } else {
      await expect(result).rejects.toBeUndefined();
    }
    expect(cleanup).toHaveBeenCalledOnce();
  });

  const shippedCopies = [
    'packages/cli/src/generators/templates/e2e.test.ts.ejs',
    'packages/cli/src/generators/templates/module.slice.test.ts.ejs',
    'packages/cli/src/generators/templates/repository.slice.test.ts.ejs',
    'packages/cli/src/generators/templates/resource.slice.test.ts.ejs',
    'packages/cli/src/new/templates/react-vite-ssr/src/app.test.ts.ejs',
    'tooling/cli/fixtures/generated-request-dto.ts.fixture',
    'packages/cli/src/new/scaffold.ts',
  ];
  it.each(shippedCopies)('ships the regression-tested helper implementation in %s', (path) => {
    const helper = readFileSync(new URL('./with-cleanup.ts', import.meta.url), 'utf8')
      .replace('// Repository-private test ownership; never intercepts Test factories or runner hooks.\n', '')
      .replace('export async function', 'async function');
    const shipped = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    expect(shipped.split(helper)).toHaveLength(path.endsWith('scaffold.ts') ? 3 : 2);
  });
});
