import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolveWorkspaceBuildOrder, runWorkspaceBuildClosure } from './run-workspace-build-closure.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function expectBefore(order: string[], earlier: string, later: string) {
  expect(order).toContain(earlier);
  expect(order).toContain(later);
  expect(order.indexOf(earlier)).toBeLessThan(order.indexOf(later));
}

describe('resolveWorkspaceBuildOrder', () => {
  it('orders @fluojs/studio behind its declaration-producing dependencies', () => {
    const order = resolveWorkspaceBuildOrder('@fluojs/studio', repoRoot);

    expectBefore(order, '@fluojs/core', '@fluojs/di');
    expectBefore(order, '@fluojs/di', '@fluojs/http');
    expectBefore(order, '@fluojs/http', '@fluojs/runtime');
    expectBefore(order, '@fluojs/runtime', '@fluojs/studio');
  });

  it('orders @fluojs/testing behind runtime/http/di/core', () => {
    const order = resolveWorkspaceBuildOrder('@fluojs/testing', repoRoot);

    expectBefore(order, '@fluojs/core', '@fluojs/di');
    expectBefore(order, '@fluojs/di', '@fluojs/http');
    expectBefore(order, '@fluojs/http', '@fluojs/runtime');
    expectBefore(order, '@fluojs/runtime', '@fluojs/testing');
  });

  it('fails when a child build is terminated by signal', () => {
    const root = mkdtempSync(join(tmpdir(), 'fluo-build-closure-'));
    const packageDirectory = join(root, 'packages', 'app');
    const fakeManager = join(root, 'fake-pm.sh');

    mkdirSync(packageDirectory, { recursive: true });

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['packages/*'] }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(packageDirectory, 'package.json'),
      JSON.stringify({ name: '@test/app', version: '0.0.0', scripts: { build: 'noop' } }, null, 2),
      'utf8',
    );
    writeFileSync(fakeManager, '#!/bin/sh\nkill -TERM $$\n', 'utf8');
    chmodSync(fakeManager, 0o755);

    const result = runWorkspaceBuildClosure('@test/app', root, {
      packageManager: fakeManager,
      stdio: 'pipe',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('terminated by signal SIGTERM');
  });
});
