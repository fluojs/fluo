import { describe, expect, it } from 'vitest';

import {
  shouldForceFullVerificationByPath,
  shouldVerifyIsolatedHttpBenchmark,
  shouldVerifyReactAppBenchmark,
} from './detect-pr-verification-scope.mjs';

describe('shouldForceFullVerificationByPath', () => {
  it('treats changeset files as neutral when a package changes', () => {
    const changedFiles = ['packages/http/src/index.ts', '.changeset/quiet-pandas-smile.md'];

    const result = shouldForceFullVerificationByPath(changedFiles);

    expect(result).toBeUndefined();
  });
});

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

describe('shouldVerifyReactAppBenchmark', () => {
  it('selects an isolated React comparison change', () => {
    expect(shouldVerifyReactAppBenchmark(['tooling/benchmarks/react-app-comparison/baseline.json'])).toBe(true);
  });

  it('does not enable React comparison for existing HTTP benchmark changes', () => {
    expect(shouldVerifyReactAppBenchmark(['tooling/benchmarks/http-comparison/pnpm-lock.yaml'])).toBe(false);
  });
});
