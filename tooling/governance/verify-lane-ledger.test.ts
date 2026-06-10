import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '../..');
const validatorPath = resolve(repoRoot, 'tooling/governance/verify-lane-ledger.mjs');
const fixtureDir = resolve(repoRoot, 'tooling/governance/fixtures/lane-ledger');

function runValidator(fixtureName: string): string {
  return execFileSync(process.execPath, [validatorPath, resolve(fixtureDir, fixtureName)], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runInvalidValidator(fixtureName: string): string {
  try {
    runValidator(fixtureName);
  } catch (error) {
    if (error && typeof error === 'object' && 'stderr' in error) {
      return String(error.stderr);
    }
    throw error;
  }

  throw new Error(`${fixtureName} unexpectedly passed lane ledger validation`);
}

describe('verify-lane-ledger merge authority governance', () => {
  it('accepts create-lane ledgers with PR merge authority and squash merge method', () => {
    expect(runValidator('valid-ready.json')).toContain('Lane ledger check passed for 1 file(s).');
  });

  it('rejects ledgers that do not grant PR merge authority', () => {
    expect(runInvalidValidator('invalid-pr-merge-false.json')).toContain('authority_scope.pr_merge must be true');
  });

  it('rejects ledgers that do not lock PR merges to squash', () => {
    expect(runInvalidValidator('invalid-merge-method.json')).toContain('pr_merge_method must be squash');
  });

  it('rejects ledgers that omit the PR merge method decision', () => {
    expect(runInvalidValidator('invalid-missing-merge-method.json')).toContain('pr_merge_method must be squash');
  });
});
