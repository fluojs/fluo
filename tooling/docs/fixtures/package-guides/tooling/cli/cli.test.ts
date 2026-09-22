import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGenerateCommand } from '@fluojs/cli';
import { describe, expect, it } from 'vitest';

/**
 * @fluojs/cli guide evidence: the programmatic generate workflow, including
 * dry-run plan previews, files-only versus auto-registered wiring behavior,
 * and the --with-slice-test testing-module template. Runs write only into a
 * per-test temp directory, removed in finally.
 */

function createFixtureRoot(): string {
  return mkdtempSync(join(tmpdir(), 'fluo-cli-guide-fixture-'));
}

describe('@fluojs/cli guide examples', () => {
  it('previews generation as a dry-run plan without writing files', () => {
    const root = createFixtureRoot();
    try {
      const result = runGenerateCommand('service', 'User', root, { dryRun: true });

      expect(result.generatedFiles).toEqual([]);
      expect(result.plannedFiles.length).toBeGreaterThan(0);
      expect(
        result.plannedFiles.every((entry) => entry.action === 'create' || entry.action === 'module-create'),
      ).toBe(true);
      expect(existsSync(join(root, 'users'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('generates a files-only module and auto-registers a service into it', () => {
    const root = createFixtureRoot();
    try {
      const moduleResult = runGenerateCommand('module', 'User', root);
      expect(moduleResult.generatedFiles).toContain(join(root, 'users', 'user.module.ts'));
      expect(moduleResult.moduleRegistered).toBe(false);

      const serviceResult = runGenerateCommand('service', 'User', root);
      expect(serviceResult.generatedFiles).toContain(join(root, 'users', 'user.service.ts'));
      expect(serviceResult.moduleRegistered).toBe(true);
      expect(serviceResult.modulePath).toBe(join(root, 'users', 'user.module.ts'));

      const moduleSource = readFileSync(join(root, 'users', 'user.module.ts'), 'utf8');
      expect(moduleSource).toContain('UserService');
      expect(moduleSource).toContain('user.service');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('adds a slice test that compiles the module with the testing helpers', () => {
    const root = createFixtureRoot();
    try {
      const result = runGenerateCommand('module', 'Order', root, { withSliceTest: true });

      const sliceTestPath = result.generatedFiles.find((filePath) => filePath.endsWith('.slice.test.ts'));
      expect(sliceTestPath).toBeDefined();
      if (!sliceTestPath) {
        throw new Error('expected the generated slice test path');
      }

      expect(readFileSync(sliceTestPath, 'utf8')).toContain('Test.createTestingModule');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
