import { describe, expect, it } from 'vitest';

import { shouldVerifyIsolatedHttpBenchmark } from './detect-pr-verification-scope.mjs';

describe('shouldVerifyIsolatedHttpBenchmark', () => {
  it('returns true when the isolated HTTP benchmark graph changes', () => {
    const changedFiles = ['tooling/benchmarks/http-comparison/pnpm-lock.yaml'];

    const result = shouldVerifyIsolatedHttpBenchmark(changedFiles);

    expect(result).toBe(true);
  });

  it('returns false when changes do not touch the isolated HTTP benchmark graph', () => {
    const changedFiles = ['tooling/benchmarks/runtime-module-graph/run.mjs', 'packages/http/src/index.ts'];

    const result = shouldVerifyIsolatedHttpBenchmark(changedFiles);

    expect(result).toBe(false);
  });
});
