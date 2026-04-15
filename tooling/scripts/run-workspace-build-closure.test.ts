import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
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

  it('serializes concurrent workspace build closures that share the same repo root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fluo-build-closure-lock-'));
    const packageDirectory = join(root, 'packages', 'app');
    const fakeManager = join(root, 'fake-pm.sh');
    const buildLog = join(root, 'build.log');
    const helperModuleUrl = new URL('./run-workspace-build-closure.mjs', import.meta.url).href;
    const runnerSource = `
      import { runWorkspaceBuildClosure } from ${JSON.stringify(helperModuleUrl)};
      const result = runWorkspaceBuildClosure('@test/app', ${JSON.stringify(root)}, {
        packageManager: ${JSON.stringify(fakeManager)},
        stdio: 'pipe',
      });
      if (result.status !== 0) {
        console.error(result.stderr || result.stdout);
        process.exit(result.status);
      }
    `;

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
    writeFileSync(
      fakeManager,
      '#!/bin/sh\nprintf "start %s\\n" "$$" >> "$BUILD_LOG"\nsleep 0.2\nprintf "end %s\\n" "$$" >> "$BUILD_LOG"\n',
      'utf8',
    );
    chmodSync(fakeManager, 0o755);

    const runWorker = async () => {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '--eval', runnerSource], {
          cwd: root,
          env: {
            ...process.env,
            BUILD_LOG: buildLog,
          },
          stdio: 'pipe',
        });
        const childEvents = child as unknown as NodeJS.EventEmitter;

        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += String(chunk);
        });

        void once(childEvents, 'error').then(([error]) => {
          reject(error);
        });

        void once(childEvents, 'exit').then(([code]) => {
          if (code === 0) {
            resolve();
            return;
          }

          reject(new Error(stderr || `worker exited with code ${code ?? 'unknown'}`));
        });
      });
    };

    await Promise.all([runWorker(), runWorker()]);

    const events = readFileSync(buildLog, 'utf8').trim().split('\n');
    expect(events).toHaveLength(4);

    const [firstStart, firstEnd, secondStart, secondEnd] = events.map((event) => event.split(' '));

    expect(firstStart[0]).toBe('start');
    expect(firstEnd[0]).toBe('end');
    expect(firstStart[1]).toBe(firstEnd[1]);
    expect(secondStart[0]).toBe('start');
    expect(secondEnd[0]).toBe('end');
    expect(secondStart[1]).toBe(secondEnd[1]);
    expect(firstStart[1]).not.toBe(secondStart[1]);
  });
});
