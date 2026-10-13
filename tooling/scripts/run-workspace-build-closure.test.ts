import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';

import { createWorkspaceArtifactWriter, resolveWorkspaceBuildOrder, runWorkspaceBuildClosure, withWorkspaceArtifactSnapshot } from './run-workspace-build-closure.mjs';
import * as buildClosure from './run-workspace-build-closure.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function artifactWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'fluo-artifact-consumer-'));
  const directory = join(root, 'packages/app');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: '@test/app', type: 'module', types: './dist/index.d.ts', scripts: { build: 'noop' },
  }));
  writeFileSync(join(directory, 'index.ts'), 'export const value: number = 1;\n');
  const manager = join(root, 'manager.cjs');
  writeFileSync(manager, `#!${process.execPath}
const fs = require('node:fs');
const ts = require(${JSON.stringify(join(repoRoot, 'node_modules/typescript/lib/typescript.js'))});
const source = fs.readFileSync('index.ts', 'utf8');
const emitted = ts.transpileDeclaration(source, {
  fileName: 'index.ts', compilerOptions: { isolatedDeclarations: true },
});
if (emitted.diagnostics.length) throw new Error(JSON.stringify(emitted.diagnostics));
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.d.ts', emitted.outputText);
`);
  chmodSync(manager, 0o755);
  return { root, directory, manager };
}

function declarationDiagnostics(directory: string) {
  const consumer = join(directory, 'consumer.mts');
  writeFileSync(consumer, "import { value } from './dist/index.js';\nconst number: number = value;\n");
  return ts.getPreEmitDiagnostics(ts.createProgram([consumer], {
    noEmit: true, strict: true, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [],
  })).map((diagnostic) => diagnostic.code);
}

function artifactProcess(source: string, directory: string, environment: NodeJS.ProcessEnv = process.env) {
  const events = new EventEmitter();
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import { once } from 'node:events';
    import * as closure from ${JSON.stringify(new URL('./run-workspace-build-closure.mjs', import.meta.url).href)};
    const originalWait = Atomics.wait;
    let reported = false;
    Atomics.wait = (...args) => {
      if (!reported) { process.send('blocked'); reported = true; }
      return originalWait(...args);
    };
    process.once('message', async () => {
      try { ${source}; process.send('completed'); process.disconnect(); }
      catch (error) { console.error(error); process.exitCode = 1; process.disconnect(); }
    });
  `], { cwd: directory, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.on('message', (message) => { if (typeof message === 'string') events.emit(message); });
  const signal = AbortSignal.timeout(10_000);
  const closed = once(child, 'close', { signal });
  void closed.catch(() => {});
  return {
    child, closed,
    event: (name: string) => {
      const observed = Promise.race([
        once(events, name, { signal }),
        closed.then(() => { throw new Error(`Artifact process exited before ${name}`); }),
      ]);
      // Cleanup can cancel an armed event after a different assertion failed.
      // Awaiting callers still receive the rejection.
      void observed.catch(() => {});
      return observed;
    },
    stop: () => {
      if (child.exitCode === null && child.signalCode === null && child.pid) {
        process.kill(-child.pid, 'SIGKILL');
      }
    },
  };
}

function gateFixture() {
  const fixture = artifactWorkspace();
  expect(runWorkspaceBuildClosure('@test/app', fixture.root, { packageManager: fixture.manager }).status).toBe(0);
  const artifact = join(realpathSync(fixture.directory), 'dist');
  const key = createHash('sha256').update(artifact).digest('hex');
  const lockDirectory = join(realpathSync(fixture.root), '.omo/workspace-artifact-locks', key);
  const gate = join(lockDirectory, 'gate');
  const barriers = Object.fromEntries(['publication', 'recovery-a', 'recovery-b', 'lease'].map((name) => {
    const path = join(fixture.root, `${name}.fifo`);
    expect(spawnSync('mkfifo', [path]).status).toBe(0);
    return [name, path];
  }));
  return { ...fixture, artifact, lockDirectory, gate, barriers };
}

function gateProcess(
  fixture: ReturnType<typeof gateFixture>,
  mode: 'reader' | 'writer',
  barriers: Readonly<{ publication?: string; recovery?: string; lease?: string }>,
) {
  return artifactProcess(`
    const fs = (await import('node:fs')).default;
    const { syncBuiltinESMExports } = await import('node:module');
    const gate = ${JSON.stringify(fixture.gate)};
    const directory = ${JSON.stringify(fixture.lockDirectory)};
    const barriers = ${JSON.stringify(barriers)};
    const read = fs.readFileSync;
    const write = fs.writeFileSync;
    const remove = fs.rmSync;
    let publicationPaused = false, recoveryPaused = false, leasePaused = false;
    fs.writeFileSync = (path, value, ...args) => {
      const name = String(path);
      if (barriers.publication && !publicationPaused
        && (name === gate + '/owner.json' || (name.startsWith(gate + '/') && name.endsWith('.pending')))) {
        publicationPaused = true;
        write(path, '');
        process.send('publication-paused');
        read(barriers.publication);
      }
      if (barriers.lease && !leasePaused && name.startsWith(directory + '/')
        && !name.startsWith(gate + '/') && name.endsWith('.json')) {
        leasePaused = true;
        process.send('lease-paused');
        read(barriers.lease);
      }
      return write(path, value, ...args);
    };
    fs.rmSync = (path, ...args) => {
      if (barriers.recovery && !recoveryPaused
        && (String(path) === gate || String(path) === gate + '/owner.json')) {
        recoveryPaused = true;
        process.send('recovery-paused');
        read(barriers.recovery);
      }
      return remove(path, ...args);
    };
    syncBuiltinESMExports();
    const clean = await import(${JSON.stringify(new URL('./clean-dist.mjs', import.meta.url).href)});
    const lease = clean.acquireWorkspaceArtifactLeases([${JSON.stringify(fixture.artifact)}], ${JSON.stringify(mode)});
    const release = once(process, 'message');
    process.send('leased');
    await release;
    lease.release();
  `, fixture.root);
}

async function releaseGateBarrier(path: string) {
  const writer = spawn(process.execPath, ['--eval', `require('node:fs').writeFileSync(${JSON.stringify(path)}, 'release')`]);
  const closed = once(writer, 'close', { signal: AbortSignal.timeout(10_000) });
  expect((await closed)[0]).toBe(0);
}

describe('workspace artifact writer termination', () => {
  it.each(['gate', 'artifact'] as const)('writer.stop: cancelled after %s publication -> releases only its process entries', async (phase) => {
    const fixture = gateFixture();
    const owner = createWorkspaceArtifactWriter(fixture.artifact, fixture.root, { pauseAfterPublication: phase });
    try {
      await owner.ready;
      const publication = owner.attempt();
      if (!publication.path) throw new Error('Writer did not report its published owner path.');
      expect(existsSync(publication.path)).toBe(true);

      await owner.stop();

      expect(existsSync(publication.path)).toBe(false);
      expect(readdirSync(fixture.gate)).toEqual([]);
      expect(readdirSync(fixture.lockDirectory).filter((entry) => entry.endsWith('.json'))).toEqual([]);
      withWorkspaceArtifactSnapshot(['@test/app'], fixture.root, () => {
        expect(declarationDiagnostics(fixture.directory)).toEqual([]);
      });
    } finally {
      await owner.stop();
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it.each(['gate', 'artifact'] as const)('writer: terminated after %s publication -> future consumers recover with parent alive', async (phase) => {
    const fixture = gateFixture();
    const owner = createWorkspaceArtifactWriter(fixture.artifact, fixture.root, { pauseAfterPublication: phase });
    const actors = ['reader', 'writer'].map((mode) => artifactProcess(`
      const clean = await import(${JSON.stringify(new URL('./clean-dist.mjs', import.meta.url).href)});
      const lease = clean.acquireWorkspaceArtifactLeases([${JSON.stringify(fixture.artifact)}], ${JSON.stringify(mode)});
      lease.release();
    `, fixture.root));
    const states = actors.map((actor) => Promise.race([
      actor.event('blocked').then(() => 'blocked'),
      actor.event('completed').then(() => 'completed'),
    ]));
    try {
      await owner.ready;
      const publication = owner.attempt();
      if (!publication.path) throw new Error('Writer did not report its published owner path.');
      expect(JSON.parse(readFileSync(publication.path, 'utf8')).pid).toBe(publication.pid);
      owner.child.kill('SIGKILL');
      expect((await owner.exited)[1]).toBe('SIGKILL');
      process.kill(process.pid, 0);
      const observed: string[] = [];
      for (const [index, actor] of actors.entries()) {
        actor.child.send('start');
        const state = await states[index];
        observed.push(state);
        if (state === 'completed') expect((await actor.closed)[0]).toBe(0);
      }
      console.info('TERMINATED_OWNER_OBSERVATION', JSON.stringify({
        phase, parentPid: process.pid, ownerPid: publication.pid, parentAlive: true, observed,
      }));
      expect(observed).toEqual(['completed', 'completed']);
      expect(publication.pid).not.toBe(process.pid);
      for (const actor of actors) expect((await actor.closed)[0]).toBe(0);
      withWorkspaceArtifactSnapshot(['@test/app'], fixture.root, () => {
        expect(declarationDiagnostics(fixture.directory)).toEqual([]);
      });
      expect(readdirSync(fixture.gate)).toEqual([]);
      expect(readdirSync(fixture.lockDirectory).filter((entry) => entry.endsWith('.json'))).toEqual([]);
    } finally {
      for (const actor of actors) actor.stop();
      await owner.stop();
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

describe('workspace artifact gate ownership', () => {
  it('gate: partial owner publication -> does not admit a reader beside a paused writer', async () => {
    const fixture = gateFixture();
    const a = gateProcess(fixture, 'reader', { publication: fixture.barriers.publication });
    const b = gateProcess(fixture, 'writer', { lease: fixture.barriers.lease });
    const publication = a.event('publication-paused');
    const writerPaused = b.event('lease-paused');
    const readerState = Promise.race([
      a.event('blocked').then(() => 'blocked'),
      a.event('leased').then(() => 'leased'),
    ]);
    const aLeased = a.event('leased');
    const bLeased = b.event('leased');
    try {
      a.child.send('start');
      await publication;
      b.child.send('start');
      await writerPaused;
      await releaseGateBarrier(fixture.barriers.publication);
      const state = await readerState;
      await releaseGateBarrier(fixture.barriers.lease);
      await bLeased;

      expect(state, 'The partial gate owner entered the reader callback while the writer callback was paused.').toBe('blocked');
      b.child.send('release');
      expect((await b.closed)[0]).toBe(0);
      await aLeased;
      expect(declarationDiagnostics(fixture.directory)).toEqual([]);
      a.child.send('release');
      expect((await a.closed)[0]).toBe(0);
    } finally {
      a.stop();
      b.stop();
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('gate: two dead owner recoverers -> the later remover cannot steal the replacement owner', async () => {
    const fixture = gateFixture();
    mkdirSync(fixture.gate, { recursive: true });
    writeFileSync(join(fixture.gate, 'owner.json'), JSON.stringify({ pid: 999_999 }));
    const a = gateProcess(fixture, 'reader', {
      recovery: fixture.barriers['recovery-a'], lease: fixture.barriers.lease,
    });
    const b = gateProcess(fixture, 'writer', { recovery: fixture.barriers['recovery-b'] });
    const aRecovery = a.event('recovery-paused');
    const bRecovery = b.event('recovery-paused');
    const readerPaused = a.event('lease-paused');
    const writerState = Promise.race([
      b.event('blocked').then(() => 'blocked'),
      b.event('leased').then(() => 'leased'),
    ]);
    const aLeased = a.event('leased');
    const bLeased = b.event('leased');
    try {
      a.child.send('start');
      await aRecovery;
      b.child.send('start');
      await bRecovery;
      await releaseGateBarrier(fixture.barriers['recovery-a']);
      await readerPaused;
      await releaseGateBarrier(fixture.barriers['recovery-b']);
      const state = await writerState;
      await releaseGateBarrier(fixture.barriers.lease);
      await aLeased;

      expect(state, 'A stale recovery removed the live replacement gate and admitted a second owner.').toBe('blocked');
      expect(declarationDiagnostics(fixture.directory)).toEqual([]);
      a.child.send('release');
      expect((await a.closed)[0]).toBe(0);
      await bLeased;
      b.child.send('release');
      expect((await b.closed)[0]).toBe(0);
    } finally {
      a.stop();
      b.stop();
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('gate: killed callback owner -> a queued writer recovers only the dead entry', async () => {
    const fixture = gateFixture();
    const a = gateProcess(fixture, 'reader', { lease: fixture.barriers.lease });
    const b = gateProcess(fixture, 'writer', {});
    const readerPaused = a.event('lease-paused');
    const writerBlocked = b.event('blocked');
    const writerLeased = b.event('leased');
    try {
      a.child.send('start');
      await readerPaused;
      b.child.send('start');
      await writerBlocked;
      a.stop();
      expect((await a.closed)[1]).toBe('SIGKILL');
      await writerLeased;
      b.child.send('release');
      expect((await b.closed)[0]).toBe(0);

      expect(readdirSync(fixture.gate)).toEqual([]);
      withWorkspaceArtifactSnapshot(['@test/app'], fixture.root, () => {
        expect(declarationDiagnostics(fixture.directory)).toEqual([]);
      });
    } finally {
      a.stop();
      b.stop();
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

describe('workspace artifact consumption', () => {
  it('clean-dist: active declaration reader -> consumes intact output before writer resumes', async () => {
    const fixture = artifactWorkspace();
    const built = runWorkspaceBuildClosure('@test/app', fixture.root, { packageManager: fixture.manager });
    expect(built.status).toBe(0);
    const cleanUrl = new URL('./clean-dist.mjs', import.meta.url).href;
    const writer = spawn(process.execPath, ['--input-type=module', '--eval', `
      const wait = Atomics.wait;
      let reported = false;
      Atomics.wait = (...args) => {
        if (!reported) { process.send('blocked'); reported = true; }
        return wait(...args);
      };
      process.once('message', async () => {
        process.send('attempt');
        process.argv[1] = new URL(${JSON.stringify(cleanUrl)}).pathname;
        await import(${JSON.stringify(cleanUrl)});
        process.send('completed');
        process.disconnect();
      });
    `], { cwd: fixture.directory, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const events: string[] = ['build-returned'];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const closed = once(writer, 'close', { signal: controller.signal });
    void closed.catch(() => {});
    const attempted = new Promise<void>((resolve) => {
      writer.on('message', (message) => { if (message === 'attempt') resolve(); });
    });
    const observed = new Promise<unknown>((resolve) => {
      writer.on('message', (message) => {
        if (message === 'blocked' || message === 'completed') resolve(message);
      });
    });
    try {
      // The base has no snapshot lease. Its real deletion still runs and exposes TS2307,
      // rather than a missing-export/setup error, for this same regression command.
      const snapshot = Reflect.get(buildClosure, 'withWorkspaceArtifactSnapshot');
      const consume = async () => {
        events.push('reader-entered');
        writer.send('start');
        await Promise.race([attempted, closed.then(() => { throw new Error('writer exited before attempt'); })]);
        events.push('writer-attempted');
        const state = await Promise.race([observed, closed.then(() => { throw new Error('writer exited before observation'); })]);
        const codes = declarationDiagnostics(fixture.directory);
        events.push('reader-consumed');
        expect(codes, `writer state=${state}; declaration diagnostics=${codes}`).toEqual([]);
        expect(state).toBe('blocked');
      };
      if (typeof snapshot === 'function') {
        await snapshot(['@test/app'], fixture.root, consume);
      } else {
        await consume();
      }
      await closed;
      events.push('writer-resumed');
      expect(events).toEqual([
        'build-returned', 'reader-entered', 'writer-attempted', 'reader-consumed', 'writer-resumed',
      ]);
    } finally {
      clearTimeout(timer);
      writer.kill();
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it.each(['success', 'failure', 'cancellation'] as const)(
    'snapshot: reader %s -> releases protection and resumes the competing build',
    async (outcome) => {
      const fixture = artifactWorkspace();
      expect(runWorkspaceBuildClosure('@test/app', fixture.root, { packageManager: fixture.manager }).status).toBe(0);
      const writer = artifactProcess(`
        const result = closure.runWorkspaceBuildClosure('@test/app', ${JSON.stringify(fixture.root)}, {
          packageManager: ${JSON.stringify(fixture.manager)},
        });
        if (result.status !== 0) throw new Error(result.stderr);
      `, fixture.root);
      const blocked = writer.event('blocked');
      const completed = writer.event('completed');
      try {
        const consume = withWorkspaceArtifactSnapshot(['@test/app'], fixture.root, async () => {
          writer.child.send('start');
          await blocked;
          expect(declarationDiagnostics(fixture.directory)).toEqual([]);
          if (outcome === 'failure') throw new Error('consumer failed');
          if (outcome === 'cancellation') {
            const cancellation = new AbortController();
            const aborted = once(cancellation.signal, 'abort');
            cancellation.abort();
            await aborted;
            cancellation.signal.throwIfAborted();
          }
          return 'consumed';
        });
        if (outcome === 'success') await expect(consume).resolves.toBe('consumed');
        else await expect(consume).rejects.toThrow();
        await completed;
        expect((await writer.closed)[0]).toBe(0);
        expect(declarationDiagnostics(fixture.directory)).toEqual([]);
      } finally {
        writer.stop();
        rmSync(fixture.root, { recursive: true, force: true });
      }
    },
  );

  it('snapshot: killed reader owner -> recovers stale protection without skipping a real build', async () => {
    const fixture = artifactWorkspace();
    const reader = artifactProcess(`
      await closure.withWorkspaceArtifactSnapshot(['@test/app'], ${JSON.stringify(fixture.root)}, async () => {
        const release = once(process, 'message');
        process.send('leased');
        await release;
      });
    `, fixture.root);
    const leased = reader.event('leased');
    try {
      reader.child.send('start');
      await leased;
      reader.stop();
      expect((await reader.closed)[1]).toBe('SIGKILL');
      const result = runWorkspaceBuildClosure('@test/app', fixture.root, { packageManager: fixture.manager });
      expect(result.status).toBe(0);
      expect(declarationDiagnostics(fixture.directory)).toEqual([]);
    } finally {
      reader.stop();
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it.each(['independent-artifact', 'independent-worktree', 'shared-reader'] as const)(
    'snapshot: %s -> completes while the original reader is still active',
    async (kind) => {
      const fixture = artifactWorkspace();
      const other = artifactWorkspace();
      const otherDirectory = join(fixture.root, 'packages/other');
      mkdirSync(otherDirectory);
      writeFileSync(join(otherDirectory, 'package.json'), JSON.stringify({ name: '@test/other', scripts: { build: 'noop' } }));
      writeFileSync(join(otherDirectory, 'index.ts'), 'export const value: number = 1;\n');
      const workerRoot = kind === 'independent-worktree' ? other.root : fixture.root;
      const source = kind === 'shared-reader'
        ? `await closure.withWorkspaceArtifactSnapshot(['@test/app'], ${JSON.stringify(workerRoot)}, () => 'read');`
        : `if (closure.runWorkspaceBuildClosure(${JSON.stringify(kind === 'independent-artifact' ? '@test/other' : '@test/app')},
            ${JSON.stringify(workerRoot)}, { packageManager: ${JSON.stringify(fixture.manager)} }).status !== 0) throw new Error('build failed');`;
      const worker = artifactProcess(source, workerRoot);
      const completed = worker.event('completed');
      try {
        await withWorkspaceArtifactSnapshot(['@test/app'], fixture.root, async () => {
          worker.child.send('start');
          await completed;
          expect((await worker.closed)[0]).toBe(0);
        });
      } finally {
        worker.stop();
        rmSync(fixture.root, { recursive: true, force: true });
        rmSync(other.root, { recursive: true, force: true });
      }
    },
  );

  it('closure: nested clean-dist prebuild -> inherits only its exact writer artifact lease', async () => {
    const fixture = artifactWorkspace();
    const cleanPath = fileURLToPath(new URL('./clean-dist.mjs', import.meta.url));
    writeFileSync(fixture.manager, readFileSync(fixture.manager, 'utf8').replace(
      '\nconst fs',
      `\nconst cleaned = require('node:child_process').spawnSync(process.execPath, [${JSON.stringify(cleanPath)}]);
if (cleaned.status !== 0) throw new Error(String(cleaned.stderr));\nconst fs`,
    ));
    const worker = artifactProcess(`
      const result = closure.runWorkspaceBuildClosure('@test/app', ${JSON.stringify(fixture.root)}, {
        packageManager: ${JSON.stringify(fixture.manager)},
        consume: (result) => { if (result.status !== 0) throw new Error('bad status'); },
      });
      if (result.status !== 0) throw new Error(result.stderr);
    `, fixture.root);
    const completed = worker.event('completed');
    try {
      worker.child.send('start');
      await completed;
      expect((await worker.closed)[0]).toBe(0);
      expect(declarationDiagnostics(fixture.directory)).toEqual([]);
    } finally {
      worker.stop();
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('closure: crossed independent dependency branches -> completes without a reader/writer cycle', async () => {
    const fixture = artifactWorkspace();
    const definitions: Readonly<Record<string, readonly string[]>> = {
      'shared-x': [], 'shared-y': [],
      aa: ['shared-x'], zz: ['shared-y'],
      bb: ['shared-y'], yy: ['shared-x'],
      'app-a': ['aa', 'zz'], 'app-b': ['bb', 'yy'],
    };
    for (const [name, dependencies] of Object.entries(definitions)) {
      const directory = join(fixture.root, 'packages', name);
      mkdirSync(directory);
      writeFileSync(join(directory, 'package.json'), JSON.stringify({
        name: `@test/${name}`, scripts: { build: 'emit' },
        dependencies: Object.fromEntries(dependencies.map((dependency) => [`@test/${dependency}`, 'workspace:*'])),
      }));
      writeFileSync(join(directory, 'index.ts'), 'export const value: number = 1;\n');
    }
    const enteredFifo = join(fixture.root, 'entered.fifo');
    const releaseFifo = join(fixture.root, 'release.fifo');
    for (const path of [enteredFifo, releaseFifo]) expect(spawnSync('mkfifo', [path]).status).toBe(0);
    writeFileSync(fixture.manager, `${readFileSync(fixture.manager, 'utf8')}
if (process.env.ACTOR === 'a' && process.cwd().endsWith('/shared-x')) {
  fs.writeFileSync(process.env.ENTERED_FIFO, 'entered');
  fs.readFileSync(process.env.RELEASE_FIFO);
}
`);
    const source = (target: string) => `
      const fs = await import('node:fs');
      const { syncBuiltinESMExports } = await import('node:module');
      let lastRead = '';
      const read = fs.default.readFileSync;
      fs.default.readFileSync = (path, ...args) => { lastRead = String(path); return read(path, ...args); };
      syncBuiltinESMExports();
      Atomics.wait = (...args) => {
        if (!reported && lastRead.includes('/workspace-artifact-locks/') && !lastRead.includes('/gate/')) {
          process.send('blocked'); reported = true;
        }
        return originalWait(...args);
      };
      const result = closure.runWorkspaceBuildClosure(${JSON.stringify(target)}, ${JSON.stringify(fixture.root)}, {
        packageManager: ${JSON.stringify(fixture.manager)},
      });
      if (result.status !== 0) throw new Error(result.stderr);
    `;
    const a = artifactProcess(source('@test/app-a'), fixture.root, {
      ...process.env, ACTOR: 'a', ENTERED_FIFO: enteredFifo, RELEASE_FIFO: releaseFifo,
    });
    const b = artifactProcess(source('@test/app-b'), fixture.root);
    const outcome = Promise.race([
      a.event('blocked').then(() => 'cycle'),
      a.event('completed').then(() => 'completed'),
    ]);
    const bBlocked = b.event('blocked');
    const bCompleted = b.event('completed');
    const enteredReader = spawn('cat', [enteredFifo], { stdio: ['ignore', 'pipe', 'pipe'] });
    const entered = once(enteredReader.stdout, 'data', { signal: AbortSignal.timeout(10_000) });
    try {
      a.child.send('start');
      await entered;
      enteredReader.kill();
      b.child.send('start');
      await bBlocked;
      const release = spawn(process.execPath, ['--eval', `require('node:fs').writeFileSync(${JSON.stringify(releaseFifo)}, 'release')`]);
      const released = once(release, 'close', { signal: AbortSignal.timeout(10_000) });
      expect((await released)[0]).toBe(0);
      expect(await outcome, 'Both builders retain a declaration reader while waiting for the other writer.').toBe('completed');
      await bCompleted;
      expect((await a.closed)[0]).toBe(0);
      expect((await b.closed)[0]).toBe(0);
    } finally {
      a.stop();
      b.stop();
      enteredReader.kill();
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

function expectBefore(order: string[], earlier: string, later: string) {
  expect(order).toContain(earlier);
  expect(order).toContain(later);
  expect(order.indexOf(earlier)).toBeLessThan(order.indexOf(later));
}

describe('resolveWorkspaceBuildOrder', () => {
  it('orders @fluojs/studio behind its diagnostics declaration dependency', () => {
    const order = resolveWorkspaceBuildOrder('@fluojs/studio', repoRoot);

    expectBefore(order, '@fluojs/diagnostics', '@fluojs/studio');
    expect(order).toEqual(['@fluojs/diagnostics', '@fluojs/studio']);
  });

  it('orders @fluojs/runtime behind its declaration-producing dependencies without Studio', () => {
    const order = resolveWorkspaceBuildOrder('@fluojs/runtime', repoRoot);

    expectBefore(order, '@fluojs/diagnostics', '@fluojs/core');
    expectBefore(order, '@fluojs/persistence', '@fluojs/core');
    expectBefore(order, '@fluojs/core', '@fluojs/di');
    expectBefore(order, '@fluojs/core', '@fluojs/auth');
    expectBefore(order, '@fluojs/auth', '@fluojs/http');
    expectBefore(order, '@fluojs/di', '@fluojs/validation');
    expectBefore(order, '@fluojs/validation', '@fluojs/http');
    expectBefore(order, '@fluojs/http', '@fluojs/runtime');
    expect(order).not.toContain('@fluojs/studio');
    expect(order).toEqual([
      '@fluojs/diagnostics',
      '@fluojs/persistence',
      '@fluojs/core',
      '@fluojs/di',
      '@fluojs/auth',
      '@fluojs/validation',
      '@fluojs/http',
      '@fluojs/runtime',
    ]);
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
