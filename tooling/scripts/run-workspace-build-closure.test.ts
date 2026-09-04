import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
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
  it('resolves @fluojs/studio as a standalone build closure', () => {
    const order = resolveWorkspaceBuildOrder('@fluojs/studio', repoRoot);

    expect(order).toEqual(['@fluojs/studio']);
  });

  it('orders @fluojs/runtime behind Studio and its declaration-producing dependencies', () => {
    const order = resolveWorkspaceBuildOrder('@fluojs/runtime', repoRoot);

    expectBefore(order, '@fluojs/core', '@fluojs/di');
    expectBefore(order, '@fluojs/di', '@fluojs/http');
    expectBefore(order, '@fluojs/http', '@fluojs/runtime');
    expectBefore(order, '@fluojs/studio', '@fluojs/runtime');
  });

  it('orders @fluojs/testing behind runtime/http/di/core', () => {
    const order = resolveWorkspaceBuildOrder('@fluojs/testing', repoRoot);

    expectBefore(order, '@fluojs/core', '@fluojs/di');
    expectBefore(order, '@fluojs/di', '@fluojs/http');
    expectBefore(order, '@fluojs/http', '@fluojs/runtime');
    expectBefore(order, '@fluojs/runtime', '@fluojs/testing');
    expect(order).not.toContain('@fluojs/platform-deno');
    expect(order).not.toContain('@fluojs/platform-bun');
    expect(order).not.toContain('@fluojs/platform-cloudflare-workers');
  });

  it('ignores dev-only workspace dependencies when resolving build order', () => {
    const root = mkdtempSync(join(tmpdir(), 'fluo-build-closure-dev-deps-'));

    mkdirSync(join(root, 'packages', 'app'), { recursive: true });
    mkdirSync(join(root, 'packages', 'test-helper'), { recursive: true });

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['packages/*'] }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(root, 'packages', 'app', 'package.json'),
      JSON.stringify(
        { devDependencies: { '@test/helper': 'workspace:^' }, name: '@test/app', version: '0.0.0' },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(root, 'packages', 'test-helper', 'package.json'),
      JSON.stringify({ dependencies: { '@test/app': 'workspace:^' }, name: '@test/helper', version: '0.0.0' }, null, 2),
      'utf8',
    );

    expect(resolveWorkspaceBuildOrder('@test/app', root)).toEqual(['@test/app']);
  });

  it('includes declared declaration-producing workspace dev dependencies in build order', () => {
    const root = mkdtempSync(join(tmpdir(), 'fluo-build-closure-declaration-dev-deps-'));

    mkdirSync(join(root, 'packages', 'app'), { recursive: true });
    mkdirSync(join(root, 'packages', 'declaration-helper'), { recursive: true });

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['packages/*'] }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(root, 'packages', 'app', 'package.json'),
      JSON.stringify(
        {
          devDependencies: { '@test/declaration-helper': 'workspace:^' },
          fluo: { declarationBuildDevDependencies: ['@test/declaration-helper'] },
          name: '@test/app',
          version: '0.0.0',
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(root, 'packages', 'declaration-helper', 'package.json'),
      JSON.stringify({ name: '@test/declaration-helper', types: './dist/index.d.ts', version: '0.0.0' }, null, 2),
      'utf8',
    );

    expect(resolveWorkspaceBuildOrder('@test/app', root)).toEqual(['@test/declaration-helper', '@test/app']);
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
    const enteredFifo = join(root, 'entered.fifo');
    const readyFifo = join(root, 'ready.fifo');
    const releaseFifo = join(root, 'release.fifo');
    for (const fifo of [enteredFifo, readyFifo, releaseFifo]) {
      expect(spawnSync('mkfifo', ['-m', '600', fifo]).status).toBe(0);
    }
    const helperModuleUrl = new URL('./run-workspace-build-closure.mjs', import.meta.url).href;
    const runnerSource = `
      import { writeFileSync } from 'node:fs';
      import { runWorkspaceBuildClosure } from ${JSON.stringify(helperModuleUrl)};
      if (process.env.WORKER_ID === 'second') writeFileSync(${JSON.stringify(readyFifo)}, 'ready');
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
      '#!/bin/sh\nprintf "start %s\\n" "$$" >> "$BUILD_LOG"\nif [ "$WORKER_ID" = first ]; then\n  printf entered > "$ENTERED_FIFO"\n  cat "$RELEASE_FIFO" >/dev/null\nfi\nprintf "end %s\\n" "$$" >> "$BUILD_LOG"\n',
      'utf8',
    );
    chmodSync(fakeManager, 0o755);

    const runWorker = async (workerId: string) => {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '--eval', runnerSource], {
          cwd: root,
          env: {
            ...process.env,
            BUILD_LOG: buildLog,
            ENTERED_FIFO: enteredFifo,
            RELEASE_FIFO: releaseFifo,
            WORKER_ID: workerId,
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

    const waitForFifo = (fifo: string) => new Promise<void>((resolve, reject) => {
      const reader = spawn('cat', [fifo], { stdio: ['ignore', 'pipe', 'pipe'] });
      reader.stdout.once('data', () => {
        reader.kill();
        resolve();
      });
      reader.once('error', reject);
    });

    const firstEntered = waitForFifo(enteredFifo);
    const firstWorker = runWorker('first');
    await firstEntered;

    const secondReady = waitForFifo(readyFifo);
    const secondWorker = runWorker('second');
    await secondReady;

    expect(readFileSync(buildLog, 'utf8').trim().split('\n')).toHaveLength(1);
    await new Promise<void>((resolve, reject) => {
      const release = spawn('sh', ['-c', `printf release > ${JSON.stringify(releaseFifo)}`]);
      release.once('error', reject);
      release.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`release exited with ${code}`)));
    });
    await Promise.all([firstWorker, secondWorker]);

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

  it('recovers a stale workspace build lock left behind by a dead process', () => {
    const root = mkdtempSync(join(tmpdir(), 'fluo-build-closure-stale-lock-'));
    const packageDirectory = join(root, 'packages', 'app');
    const fakeManager = join(root, 'fake-pm.sh');
    const lockDirectory = join(root, '.workspace-build-closure.lock');

    mkdirSync(packageDirectory, { recursive: true });
    mkdirSync(lockDirectory, { recursive: true });

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
      join(lockDirectory, 'owner.json'),
      JSON.stringify({ pid: 999_999, startedAt: Date.now() - 60_000 }),
      'utf8',
    );
    writeFileSync(fakeManager, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(fakeManager, 0o755);

    const result = runWorkspaceBuildClosure('@test/app', root, {
      packageManager: fakeManager,
      stdio: 'pipe',
    });

    expect(result.status).toBe(0);
  });
});
