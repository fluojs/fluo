import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { detectPackageManager, resolveBootstrapAnswers } from './prompt.js';

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('detectPackageManager', () => {
  it('detects bun from npm_config_user_agent', () => {
    expect(detectPackageManager(process.cwd(), { npm_config_user_agent: 'bun/1.2.5 npm/? node/v22.0.0 darwin arm64' })).toBe('bun');
  });

  it('detects bun from bun lockfiles in parent directories', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-prompt-'));
    const nestedDirectory = join(workspaceDirectory, 'apps', 'starter-app');
    createdDirectories.push(workspaceDirectory);

    writeFileSync(join(workspaceDirectory, 'bun.lock'), 'lockfileVersion = 1\n');

    expect(detectPackageManager(nestedDirectory, {})).toBe('bun');
  });
});

describe('resolveBootstrapAnswers', () => {
  it('uses the detected bun package manager when none is provided explicitly', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'konekti-cli-prompt-'));
    createdDirectories.push(workspaceDirectory);

    writeFileSync(
      join(workspaceDirectory, 'package.json'),
      JSON.stringify({ name: 'workspace', packageManager: 'bun@1.2.5' }, null, 2),
    );

    expect(resolveBootstrapAnswers({ projectName: 'starter-app' }, workspaceDirectory, {})).toEqual({
      packageManager: 'bun',
      projectName: 'starter-app',
      targetDirectory: './starter-app',
    });
  });
});
