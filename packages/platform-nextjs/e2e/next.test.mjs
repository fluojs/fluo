import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
import {
  cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile,
} from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(here, '../../..');
const packageRoot = path.dirname(here);
const requestTimeout = 15_000;
const firstFrame = 'event: chunk\ndata: {"sequence":1}\n\n';
const secondFrame = 'event: chunk\ndata: {"sequence":2}\n\n';

function bounded(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function installed(name, source = packageRoot) {
  if (['next', 'react', 'react-dom'].includes(name) && process.env.FLUO_E2E_NEXT_ROOT) {
    return realpath(path.join(process.env.FLUO_E2E_NEXT_ROOT, 'node_modules', name));
  }
  for (const base of [source, worktree]) {
    try {
      return await realpath(path.join(base, 'node_modules', name));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`Missing ${name}; the lead must install dependencies before this suite.`);
}

async function prepare(app) {
  await cp(path.join(here, 'fixture'), app, { recursive: true });
  const modules = path.join(app, 'node_modules');
  const staged = new Set();

  async function stage(name, source) {
    if (staged.has(name)) return;
    staged.add(name);
    const destination = path.join(modules, name);
    await mkdir(path.dirname(destination), { recursive: true });
    if (!name.startsWith('@fluojs/')) {
      await symlink(await installed(name, source), destination, 'dir');
      return;
    }
    const directory = path.join(worktree, 'packages', name.slice('@fluojs/'.length));
    const manifest = await json(path.join(directory, 'package.json'));
    assert.ok(manifest.files.includes('dist'), `${name} must ship dist`);
    await mkdir(destination, { recursive: true });
    // Copy the real export map and publish allowlist, never src or source aliases.
    await cp(path.join(directory, 'package.json'), path.join(destination, 'package.json'));
    for (const file of manifest.files) {
      assert.match(file, /^[\w./-]+$/, 'Publish entries must be literal paths');
      assert.ok(!file.split('/').includes('..'));
      await cp(path.join(directory, file), path.join(destination, file), { recursive: true });
    }
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      await stage(dependency, directory);
    }
  }

  const direct = [
    '@fluojs/core', '@fluojs/http', '@fluojs/runtime', '@fluojs/platform-nextjs',
    'next', 'react', 'react-dom', 'typescript', '@types/node', '@types/react',
    '@types/react-dom',
  ];
  for (const name of direct) await stage(name, packageRoot);
  const versions = {};
  for (const name of direct) {
    versions[name] = (await json(path.join(modules, name, 'package.json'))).version;
  }
  assert.match(versions.next, /^16\./, 'This suite verifies Next 16');
  await writeFile(path.join(app, 'package.json'), JSON.stringify({
    name: 'fluo-next-production-e2e',
    private: true,
    type: 'module',
    dependencies: versions,
  }, null, 2));
  await writeFile(path.join(app, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      lib: ['dom', 'dom.iterable', 'esnext'],
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'react-jsx',
      plugins: [{ name: 'next' }],
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  }, null, 2));
  return versions;
}

function run(command, args, cwd, env, logFile, children, readiness = false) {
  const ready = Promise.withResolvers();
  const outputEvents = new EventEmitter();
  let address;
  let readyLine = false;
  let output = '';
  const child = spawn(command, args, {
    cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exit = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error: error.message, code: null }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    let pending = '';
    stream.on('data', (chunk) => {
      appendFileSync(logFile, chunk);
      output += chunk;
      pending += stripVTControlCharacters(chunk);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) {
        outputEvents.emit('line', line);
        const match = line.match(/Local:\s+(http:\/\/[^\s]+)/);
        if (match) address = match[1];
        if (/\bReady in\b/.test(line)) readyLine = true;
        if (readiness && readyLine && address) ready.resolve(address);
      }
    });
  }
  const processRun = {
    child, exit,
    command: [command, ...args],
    output: () => output,
    onLine(predicate) {
      const observed = Promise.withResolvers();
      const listener = (line) => {
        if (predicate(line)) observed.resolve(line);
      };
      outputEvents.on('line', listener);
      return bounded(Promise.race([
        observed.promise,
        exit.then((result) => {
          throw new Error(`Next exited before output event: ${JSON.stringify(result)}`);
        }),
      ]), requestTimeout, 'Next output event').finally(() => {
        outputEvents.off('line', listener);
      });
    },
    ready: () => bounded(Promise.race([
      ready.promise,
      exit.then((result) => {
        throw new Error(`Next exited before readiness: ${JSON.stringify(result)}\n${output}`);
      }),
    ]), 60_000, 'Next production readiness'),
  };
  children.push(processRun);
  return processRun;
}

function signalGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function stop(processRun) {
  if (processRun.child.exitCode !== null || processRun.child.signalCode !== null) {
    await processRun.exit;
    return;
  }
  signalGroup(processRun.child, 'SIGTERM');
  const escalation = setTimeout(() => signalGroup(processRun.child, 'SIGKILL'), 5_000);
  try {
    await bounded(processRun.exit, 10_000, 'Next process cleanup');
  } finally {
    clearTimeout(escalation);
  }
}

function request(base, route, { method = 'GET', body, headers = {} } = {}) {
  const signal = AbortSignal.timeout(requestTimeout);
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(route, base), {
      method, headers, signal, agent: false,
    });
    req.once('error', reject);
    req.once('response', (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('error', reject);
      response.once('aborted', () => reject(new Error(`Response aborted: ${route}`)));
      response.once('end', () => resolve({
        method, route, status: response.statusCode,
        headers: response.headers,
        rawHeaders: response.rawHeaders,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    // All response/error subscriptions exist before any request bytes are sent.
    req.end(body);
  });
}

function streamRequest(base, route) {
  const first = Promise.withResolvers();
  const completed = Promise.withResolvers();
  let body = '';
  let ended = false;
  let headers;
  let status;
  const req = http.request(new URL(route, base), {
    agent: false, signal: AbortSignal.timeout(requestTimeout),
  });
  const fail = (error) => completed.reject(error);
  req.once('error', fail);
  req.once('response', (response) => {
    headers = response.headers;
    status = response.statusCode;
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      body += chunk;
      if (body.includes('\n\n')) first.resolve();
    });
    response.once('error', fail);
    response.once('aborted', () => fail(new Error('SSE response aborted')));
    response.once('end', () => {
      ended = true;
      completed.resolve({ status, headers, body });
    });
  });
  // Subscribe to both first-frame and completion signals before triggering GET.
  const firstChunk = bounded(Promise.race([
    first.promise,
    completed.promise.then(() => {
      throw new Error('SSE ended before the release request');
    }),
  ]), requestTimeout, 'First SSE frame');
  req.end();
  return {
    firstChunk,
    completed: completed.promise,
    snapshot: () => ({ body, ended, headers, status }),
    close: () => req.destroy(),
  };
}

test('packaged Fluo serves both routers in a real Next 16 production build', {
  timeout: 360_000,
}, async (t) => {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Node >=24 is required');
  const evidenceRoot = path.join(worktree, '.omo');
  await mkdir(evidenceRoot, { recursive: true });
  const evidence = await mkdtemp(path.join(evidenceRoot, 'platform-nextjs-e2e-'));
  const app = path.join(evidence, 'app');
  const sentinel = path.join(evidence, 'bootstrap.jsonl');
  await writeFile(sentinel, '');
  const children = [];
  const report = {
    node: process.version,
    compiler: process.env.FLUO_E2E_COMPILER ?? 'scoped',
    commands: [],
    http: [],
    evidence,
  };
  const accessorEvents = [];
  const joined = new Set();
  const allJoined = Promise.withResolvers();
  const heldLoads = [];
  let holdSharedLoad = true;
  const gate = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture.test');
    const event = Object.fromEntries(url.searchParams);
    accessorEvents.push(event);
    if (event.event.startsWith('joined:')) {
      joined.add(event.event);
      if (joined.size === 3) allJoined.resolve();
    }
    if (holdSharedLoad && event.event === 'load' && event.key === 'shared') {
      heldLoads.push(response);
    } else {
      response.end('ok');
    }
  });
  await new Promise((resolve, reject) => {
    gate.once('error', reject);
    gate.listen(0, '127.0.0.1', resolve);
  });
  const gateAddress = gate.address();
  assert.ok(gateAddress && typeof gateAddress !== 'string');
  t.diagnostic(`Evidence: ${evidence}`);
  try {
    report.versions = await prepare(app);
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      NO_COLOR: '1',
      FLUO_E2E_WORKTREE: worktree,
      FLUO_E2E_BOOTSTRAP: sentinel,
      FLUO_E2E_ACCESSOR_GATE: `http://127.0.0.1:${gateAddress.port}`,
    };
    delete env.FORCE_COLOR;
    delete env.NODE_OPTIONS;
    const nextCli = createRequire(path.join(app, 'package.json')).resolve('next/dist/bin/next');

    await t.test('dev serves client store SSR alongside decorated server DTOs', async () => {
      const dev = run(process.execPath,
        [nextCli, 'dev', '--turbopack', '--hostname', '127.0.0.1', '--port', '0'],
        app, { ...env, NODE_ENV: 'development', FLUO_E2E_PHASE: 'dev' },
        path.join(evidence, 'dev.log'), children, true);
      try {
        const base = await dev.ready();
        for (const [route, options, status, expected] of [
          ['/', {}, 200, /<output id="store">FLUO_SSR_STORE_OK<\/output>/],
          ['/api/app/health', {}, 200, /"status":"ok"/],
          ['/api/app/binding?count=42', {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: 'session=hello' },
            body: '{"message":"dev DTO"}',
          }, 201, /"message":"dev DTO"/],
        ]) {
          const response = await request(base, route, options);
          report.http.push({ ...response, phase: 'dev' });
          assert.equal(response.status, status, response.body);
          assert.match(response.body, expected);
        }
      } finally {
        await stop(dev);
        report.commands.push({ command: dev.command, ...await dev.exit, phase: 'dev' });
        await writeFile(sentinel, '');
      }
    });

    await t.test('resolves only published package exports before building', async () => {
      const preflight = run(process.execPath, ['--input-type=module', '-e', `
        import { createRequire } from 'node:module';
        import { access } from 'node:fs/promises';
        import { fileURLToPath } from 'node:url';
        for (const name of [
          '@fluojs/core', '@fluojs/http', '@fluojs/runtime',
          '@fluojs/platform-nextjs', '@fluojs/platform-nextjs/app-router',
          '@fluojs/platform-nextjs/pages-router', '@fluojs/platform-nextjs/next-config',
        ]) {
          const url = import.meta.resolve(name);
          if (!url.includes('/app/node_modules/@fluojs/') || !url.includes('/dist/')) {
            throw new Error('Not a staged dist export: ' + url);
          }
          await access(fileURLToPath(url));
          await import(name);
          console.log(name + ' -> ' + url);
        }
        const loader = createRequire(import.meta.url).resolve(
          '@fluojs/platform-nextjs/decorators-loader'
        );
        await access(loader);
        console.log('decorators-loader -> ' + loader);
      `], app, env, path.join(evidence, 'exports.log'), children);
      const result = await bounded(preflight.exit, 30_000, 'Package exports');
      report.commands.push({ command: preflight.command, ...result });
      assert.equal(result.code, 0, preflight.output());
    });

    await t.test('builds App and Pages routes without bootstrapping either backend', async () => {
      const build = run(process.execPath, [nextCli, 'build', '--turbopack'], app,
        { ...env, FLUO_E2E_PHASE: 'build' }, path.join(evidence, 'build.log'), children);
      const result = await bounded(build.exit, 240_000, 'Next production build');
      report.commands.push({ command: build.command, ...result });
      assert.equal(result.code, 0, build.output());
      assert.equal(await readFile(sentinel, 'utf8'), '', 'Build imported the backend');
      const appPaths = await json(path.join(app, '.next/server/app-paths-manifest.json'));
      const pagesPaths = await json(path.join(app, '.next/server/pages-manifest.json'));
      assert.ok(appPaths['/api/app/[[...path]]/route']);
      assert.ok(pagesPaths['/api/pages/[[...path]]']);
      assert.ok(appPaths['/shared/page']);
      assert.ok(appPaths['/api/shared/route']);
      assert.ok(pagesPaths['/api/shared-auth']);
      assert.equal(accessorEvents.length, 0, 'Build must not invoke application accessors');
    });

    // A failed subtest does not throw from t.test; do not start an unbuilt app.
    assert.ok(report.commands.every(({ code }) => code === 0), 'Preflight/build failed');
    const server = run(process.execPath,
      [nextCli, 'start', '--hostname', '127.0.0.1', '--port', '0'],
      app, { ...env, FLUO_E2E_PHASE: 'serve' },
      path.join(evidence, 'server.log'), children, true);
    const base = await server.ready();
    assert.notEqual(new URL(base).port, '0', 'Next must report its bound ephemeral port');
    assert.equal(await readFile(sentinel, 'utf8'), '', 'Next start imported the backend');
    report.commands.push({ command: server.command, address: base });

    const records = async () => (await readFile(sentinel, 'utf8')).trim().split('\n')
      .filter(Boolean).map((line) => JSON.parse(line));
    const capture = async (route, options) => {
      const response = await request(base, route, options);
      report.http.push(response);
      t.diagnostic(`${response.method} ${route} -> ${response.status} ${response.body}`);
      return response;
    };
    const jsonHeaders = { 'content-type': 'application/json' };
    await t.test('production renders the client store through its original import', async () => {
      const response = await capture('/');
      assert.equal(response.status, 200);
      assert.match(response.body, /<output id="store">FLUO_SSR_STORE_OK<\/output>/);
    });
    await t.test('App Router keeps Next.js host method restrictions', async () => {
      const response = await capture('/api/app/health', { method: 'QUERY' });
      assert.equal(response.status, 400);
      assert.equal(await readFile(sentinel, 'utf8'), '',
        'A method rejected by Next must not bootstrap Fluo');
    });
    for (const facade of ['app', 'pages']) {
      const prefix = `/api/${facade}`;
      await t.test(`${facade}: concurrent first GETs bootstrap exactly once`, async () => {
        const before = await records();
        const responses = await Promise.all([
          capture(`${prefix}/health`), capture(`${prefix}/health`),
        ]);
        for (const response of responses) {
          assert.equal(response.status, 200);
          assert.equal(JSON.parse(response.body).status, 'ok');
        }
        const instance = JSON.parse(responses[0].body).instance;
        assert.equal(JSON.parse(responses[1].body).instance, instance);
        assert.deepEqual((await records()).slice(before.length).map((entry) => ({
          event: entry.event, instance: entry.instance, phase: entry.phase,
        })), [
          { event: 'start', instance, phase: 'serve' },
          { event: 'ready', instance, phase: 'serve' },
        ]);
      });
      await t.test(`${facade}: an explicit HEAD route preserves status without a body`, async () => {
        const response = await capture(`${prefix}/health`, { method: 'HEAD' });
        assert.equal(response.status, 200);
        assert.equal(response.body, '');
      });
      await t.test(`${facade}: ordinary JSON POST`, async () => {
        const response = await capture(`${prefix}/echo`, {
          method: 'POST', headers: jsonHeaders, body: '{"message":"hello Next"}',
        });
        assert.equal(response.status, 201);
        assert.deepEqual(JSON.parse(response.body), { body: { message: 'hello Next' } });
      });
      for (const [label, route, options, status] of [
        ['malformed JSON', `${prefix}/echo`, {
          method: 'POST', headers: jsonHeaders, body: '{',
        }, 400],
        ['missing Fluo route', `${prefix}/missing`, {}, 404],
      ]) {
        await t.test(`${facade}: ${label} reaches Fluo error handling`, async () => {
          const response = await capture(route, options);
          assert.equal(response.status, status);
          assert.match(response.headers['content-type'], /application\/json/);
          assert.equal(JSON.parse(response.body).error.status, status);
        });
      }
      await t.test(`${facade}: field DTO conversion and independent Set-Cookie fields`, async () => {
        const response = await capture(`${prefix}/binding?count=42`, {
          method: 'POST',
          headers: { ...jsonHeaders, cookie: 'session=hello%20Next; theme=light' },
          body: '{"message":"bound body"}',
        });
        assert.equal(response.status, 201);
        assert.deepEqual(JSON.parse(response.body), {
          facade, count: 42, session: 'converted:hello Next', message: 'bound body',
        });
        const cookies = [];
        for (let i = 0; i < response.rawHeaders.length; i += 2) {
          if (response.rawHeaders[i].toLowerCase() === 'set-cookie') {
            cookies.push(response.rawHeaders[i + 1]);
          }
        }
        assert.deepEqual(cookies, [
          'session=rotated; Path=/; HttpOnly; SameSite=Lax',
          'theme=dark; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
        ]);
      });
      await t.test(`${facade}: receives an SSE frame before releasing the second`, async () => {
        const route = `${prefix}/stream/${randomUUID()}`;
        const stream = streamRequest(base, route);
        try {
          await stream.firstChunk;
          const first = stream.snapshot();
          assert.equal(first.status, 200);
          assert.match(first.headers['content-type'], /^text\/event-stream/);
          assert.equal(first.body, firstFrame);
          assert.equal(first.ended, false);
          const released = await capture(`${route}/release`, { method: 'POST' });
          assert.equal(released.status, 202);
          assert.deepEqual(JSON.parse(released.body), { released: true });
          const finished = await stream.completed;
          assert.equal(finished.body, firstFrame + secondFrame);
          report.http.push({
            method: 'GET', route, ...finished, firstFrameBeforeRelease: true,
          });
          t.diagnostic(`GET ${route} -> 200; first frame before release, second frame then EOF`);
        } finally {
          stream.close();
        }
      });
      await t.test(`${facade}: assertion failure before release closes the SSE generator`, async () => {
        const id = randomUUID();
        const route = `${prefix}/stream/${id}`;
        const closed = server.onLine((line) => line === `FLUO_E2E_STREAM_CLOSED ${id}`);
        const stream = streamRequest(base, route);
        const injected = new Error('FLUO_E2E_EXPECTED_ASSERTION_FAILURE');
        // Attach rejection handlers before GET/cleanup can fail; await both signals.
        const failedAssertion = assert.rejects(async () => {
          try {
            await stream.firstChunk;
            throw injected;
          } finally {
            stream.close();
          }
        }, (error) => error === injected);
        await Promise.all([closed, failedAssertion]);
        const released = await capture(`${route}/release`, { method: 'POST' });
        assert.equal(released.status, 202);
        assert.deepEqual(JSON.parse(released.body), { released: false },
          'The generator must have removed its pending gate');
        report.http.push({
          method: 'GET', route, status: stream.snapshot().status,
          closedBeforeRelease: true,
        });
      });
    }
    report.bootstrap = await records();
    assert.equal(report.bootstrap.length, 4, 'Exactly two lazy backend instances expected');

    let sharedInstance;
    await t.test('RSC, auth callback, and Route Handler join one pending application across bundles', async () => {
      // Register the join signal before triggering any request. The loader stays
      // blocked at the real HTTP gate until all three consumer paths have joined.
      const joinedSignal = bounded(allJoined.promise, requestTimeout, 'Three accessor consumers');
      const responses = Promise.all([
        capture('/shared', { headers: { 'x-fixture-actor': 'rsc-reader' } }),
        capture('/api/shared-auth', { headers: { 'x-fixture-actor': 'auth-reader' } }),
        capture('/api/shared', { headers: { 'x-fixture-actor': 'route-reader' } }),
      ]);
      const releaseLoad = joinedSignal.then(() => {
        holdSharedLoad = false;
        for (const response of heldLoads.splice(0)) response.end('ok');
      });
      const [, [rsc, auth, route]] = await Promise.all([releaseLoad, responses]);
      assert.equal(rsc.status, 200);
      assert.equal(auth.status, 200);
      assert.equal(route.status, 200);
      const fromRsc = Object.fromEntries(
        [...rsc.body.matchAll(/data-(instance|pid|evaluation|actor)="([^"]+)"/g)]
          .map((match) => [match[1], match[2]]),
      );
      const fromAuth = JSON.parse(auth.body);
      const fromRoute = JSON.parse(route.body);
      sharedInstance = fromRoute.instance;
      assert.ok(sharedInstance);
      assert.equal(fromRsc.instance, sharedInstance);
      assert.equal(fromAuth.instance, sharedInstance);
      assert.equal(Number(fromRsc.pid), fromRoute.pid);
      assert.equal(fromAuth.pid, fromRoute.pid);
      assert.deepEqual([fromRsc.actor, fromAuth.actor, fromRoute.actor],
        ['rsc-reader', 'auth-reader', 'route-reader']);
      assert.ok(new Set([fromRsc.evaluation, fromAuth.evaluation, fromRoute.evaluation]).size >= 2,
        'The fixture must observe distinct evaluations of the shared accessor source');
      assert.equal(accessorEvents.filter((event) => event.event === 'load' && event.key === 'shared').length, 1);
      const anonymous = await capture('/api/shared');
      assert.equal(JSON.parse(anonymous.body).actor, 'anonymous');
      report.sharedApplication = { rsc: fromRsc, auth: fromAuth, route: fromRoute };
    });

    await t.test('another application key and another Next process remain isolated', async () => {
      const other = await capture('/api/shared-other');
      assert.equal(other.status, 200);
      assert.notEqual(JSON.parse(other.body).instance, sharedInstance);
      const second = run(process.execPath,
        [nextCli, 'start', '--hostname', '127.0.0.1', '--port', '0'],
        app, { ...env, FLUO_E2E_PHASE: 'serve' },
        path.join(evidence, 'second-process.log'), children, true);
      try {
        const secondBase = await second.ready();
        const response = await request(secondBase, '/api/shared');
        assert.equal(response.status, 200);
        const value = JSON.parse(response.body);
        assert.notEqual(value.instance, sharedInstance);
        assert.notEqual(value.pid, report.sharedApplication.route.pid);
        report.processIsolation = value;
        assert.equal((await request(secondBase, '/api/shared-closed', { method: 'POST' })).status, 200);
      } finally {
        await stop(second);
      }
    });

    await t.test('failed initialization stays failed and explicit close never reloads', async () => {
      const failures = await Promise.all([
        capture('/api/shared-failure'), capture('/api/shared-failure'),
      ]);
      failures.push(await capture('/api/shared-failure'));
      for (const response of failures) {
        assert.equal(response.status, 500);
        assert.equal(JSON.parse(response.body).error, 'FLUO_E2E_SHARED_BOOTSTRAP_FAILURE');
      }
      assert.equal(accessorEvents.filter((event) => event.event === 'load' && event.key === 'failed').length, 1);
      const before = accessorEvents.filter((event) => event.event === 'load').length;
      assert.equal((await capture('/api/shared-closed', { method: 'POST' })).status, 200);
      assert.equal((await capture('/api/shared-closed')).status, 503);
      assert.equal((await capture('/api/shared-closed')).status, 503);
      assert.equal(accessorEvents.filter((event) => event.event === 'load').length, before);
    });

    await t.test('a lazy bootstrap failure still closes the production server after an assertion', async () => {
      await stop(server);
      const failing = run(process.execPath,
        [nextCli, 'start', '--hostname', '127.0.0.1', '--port', '0'],
        app, { ...env, FLUO_E2E_PHASE: 'failure', FLUO_E2E_FAIL_BOOTSTRAP: '1' },
        path.join(evidence, 'bootstrap-failure.log'), children, true);
      const failureBase = await failing.ready();
      const before = (await records()).length;
      try {
        for (const facade of ['app', 'pages']) {
          const failure = failing.onLine((line) => line.includes('FLUO_E2E_EXPECTED_BOOTSTRAP_FAILURE'));
          const [response] = await Promise.all([
            request(failureBase, `/api/${facade}/health`), failure,
          ]);
          report.http.push({ ...response, expectedBootstrapFailure: true });
          assert.equal(response.status, 500);
        }
        const attempts = (await records()).slice(before);
        assert.equal(attempts.length, 2);
        assert.ok(attempts.every(({ event, phase }) => event === 'start' && phase === 'failure'));
        const injected = new Error('FLUO_E2E_EXPECTED_BOOTSTRAP_ASSERTION_FAILURE');
        await assert.rejects(async () => {
          try {
            throw injected;
          } finally {
            await stop(failing);
          }
        }, (error) => error === injected);
        const exit = await failing.exit;
        assert.ok(exit.code !== null || exit.signal !== null);
        report.bootstrapFailureCleanup = exit;
      } finally {
        await stop(failing);
      }
    });
  } finally {
    try {
      for (const child of children.toReversed()) await stop(child);
      report.exits = await Promise.all(children.map(async (child) => ({
        command: child.command, ...await child.exit,
      })));
    } finally {
      holdSharedLoad = false;
      for (const response of heldLoads.splice(0)) response.end('cleanup');
      gate.closeAllConnections();
      await new Promise((resolve, reject) => gate.close((error) => error ? reject(error) : resolve()));
      report.accessorEvents = accessorEvents;
      await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
      await rm(app, { recursive: true, force: true });
    }
  }
});
