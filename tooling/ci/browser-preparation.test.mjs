import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertBrowserObservation, browserObservationPolicy, prepareBrowserCommand, runBrowserOwnedCommand } from './browser-preparation.mjs';
import { productDomainPlan } from './react-product-acceptance.mjs';
import { createCommandRunner } from '../../examples/react-vite-ssr/tests/verify-background-starter.mjs';

function evidenceFixture(t, prefix) {
  const directory = process.env.FLUO_PRODUCT_TEST_EVIDENCE ?? tmpdir();
  mkdirSync(directory, { recursive: true });
  const root = mkdtempSync(join(directory, prefix));
  if (!process.env.FLUO_PRODUCT_TEST_EVIDENCE) t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('evidence roots: reused packed diagnostic root -> rejects before spawn and preserves bytes', (t) => {
  const root = evidenceFixture(t, 'fluo-root-reuse-');
  const originals = ['report.json', 'error-context.md', 'receipt.json', 'command.log'];
  for (const path of originals) writeFileSync(join(root, path), `previous ${path}\n`);
  let runner;

  assert.throws(() => { runner = createCommandRunner(root, []); }, /evidence root/u);

  runner?.dispose();
  for (const path of originals) assert.equal(readFileSync(join(root, path), 'utf8'), `previous ${path}\n`);
});

test('evidence roots: two packed owners claim one empty root -> exclusive claim before either spawn', (t) => {
  const parent = evidenceFixture(t, 'fluo-root-exclusive-');
  const root = join(parent, 'fresh');
  mkdirSync(root);
  const runner = createCommandRunner(root, []);
  t.after(() => runner.dispose());

  assert.throws(() => createCommandRunner(root, []), /evidence root/u);
});

test('packed command evidence: fresh root and real stdout/stderr -> retained combined contract and raw refs', async (t) => {
  const parent = evidenceFixture(t, 'fluo-packed-evidence-');
  const commands = [];
  const runner = createCommandRunner(join(parent, 'fresh'), commands, 'attempt-1');
  t.after(() => runner.dispose());
  const stdout = `${'O'.repeat(60_000)}PACKED_STDOUT_TAIL\n`;
  const stderr = `${'E'.repeat(60_000)}PACKED_STDERR_TAIL\n`;

  const diagnostics = await runner.run('large', ['-e',
    `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)});`],
  parent, { PACKED_CASE: 'large' }, process.execPath);

  assert.equal(commands.length, 1);
  assert.equal(commands[0].close, true);
  assert.equal(readFileSync(commands[0].evidence.stdout.path, 'utf8'), stdout);
  assert.equal(readFileSync(commands[0].evidence.stderr.path, 'utf8'), stderr);
  assert.equal(readFileSync(commands[0].log, 'utf8'), diagnostics);
  assert.ok(diagnostics.includes('PACKED_STDOUT_TAIL'));
  assert.ok(diagnostics.includes('PACKED_STDERR_TAIL'));
});

for (const mode of ['success', 'failure', 'cancellation']) {
  test(`command evidence: ${mode} real large streams -> exact raw tailbytes and bounded terminal receipt`, async (t) => {
    const parent = evidenceFixture(t, 'fluo-command-evidence-');
    const root = join(parent, 'fresh');
    const expected = { stdout: `${'O'.repeat(70_000)}STDOUT_TAIL\n`, stderr: `${'E'.repeat(70_000)}STDERR_TAIL\n` };
    const controller = new AbortController();
    let child;
    const command = { id: 'large', executable: process.execPath, env: { EVIDENCE_CASE: mode },
      args: ['-e', `
        process.stdout.write(${JSON.stringify(expected.stdout)});
        process.stderr.write(${JSON.stringify(expected.stderr)});
        ${mode === 'cancellation' ? `
          process.on('SIGTERM', () => process.exit(0));
          process.on('message', () => {});
          process.send('ready');
        ` : `process.exitCode = ${mode === 'failure' ? 7 : 0};`}
      `] };
    let terminal = '';
    const completed = runBrowserOwnedCommand(command, { cwd: parent, env: { ...process.env, ...command.env } }, {
      signal: controller.signal, evidence: { root, label: 'large', emit: (text) => { terminal += text; } },
      onChild(value) {
        child = value;
        if (mode === 'cancellation') {
          const ready = once(child, 'message', { signal: AbortSignal.timeout(5000) });
          void ready.then(() => controller.abort('SIGINT'));
        }
      },
    });
    t.after(() => child?.kill('SIGKILL'));

    const outcome = await completed;

    assert.ok(outcome.evidence, 'real owned execution must retain separate raw streams');
    const receipt = JSON.parse(readFileSync(outcome.evidence.receipt.path));
    for (const name of ['stdout', 'stderr']) {
      const bytes = readFileSync(receipt[name].path);
      assert.equal(bytes.toString(), expected[name]);
      assert.equal(receipt[name].bytes, Buffer.byteLength(expected[name]));
      assert.equal(receipt[name].sha256, createHash('sha256').update(bytes).digest('hex'));
    }
    assert.equal(receipt.closed, true);
    assert.equal(receipt.exit_code, mode === 'failure' ? 7 : 0);
    assert.equal(receipt.signal, null);
    assert.equal(receipt.cancelled, mode === 'cancellation');
    assert.equal(receipt.executable, command.executable);
    assert.deepEqual(receipt.args, command.args);
    assert.equal(receipt.cwd, parent);
    assert.deepEqual(receipt.env, command.env);
    assert.ok(Buffer.byteLength(terminal) < 4096);
    assert.ok(terminal.includes(outcome.evidence.receipt.path));
    assert.ok(!terminal.includes('STDOUT_TAIL'));
    await assert.rejects(runBrowserOwnedCommand(command, { cwd: parent, env: process.env },
      { evidence: { root, label: 'again' }, onChild() { assert.fail('reused evidence root spawned'); } }), /evidence root/u);
  });
}

function preparedFixture(t, id = 'fault-browser') {
  const root = mkdtempSync(join(tmpdir(), 'fluo-browser-preparation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const example = join(root, 'examples/react-vite-ssr');
  const write = (path, value) => {
    const target = join(example, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  for (const path of ['package.json', 'playwright.config.ts', 'playwright.reliability.config.ts']) {
    write(path, readFileSync(join(repo, 'examples/react-vite-ssr', path), 'utf8'));
  }
  mkdirSync(join(root, 'tooling/ci'), { recursive: true });
  writeFileSync(join(root, 'tooling/ci/browser-playwright.config.mjs'),
    readFileSync(join(repo, 'tooling/ci/browser-playwright.config.mjs')));
  write('dist/server/main.js', 'const probe = process.env.REACT_SSR_DELIVERY_PROBE;\n');
  write('dist/form-server/main.js', 'const control = new FormControl();\n');
  write('dist/client/client.js', 'export {};\n');
  write('dist/client/server.js', 'export {};\n');
  write('dist/client/product.js', 'export {};\n');
  write('dist/client/admin.js', 'export {};\n');
  write('dist/client/.vite/manifest.json', {
    'src/entry-client.ts': { isEntry: true, file: 'client.js' },
    'src/entry-server.ts': { isEntry: true, file: 'server.js' },
    'src/navigation-product.ts': { file: 'product.js' },
    'src/navigation-admin.ts': { file: 'admin.js' },
  });
  const command = structuredClone(productDomainPlan('tooling', '/fixture').find((entry) => entry.id === id));
  return { root, command, write };
}

for (const module of ['src/navigation-product.ts', 'src/navigation-admin.ts']) {
  test(`browser preparation: missing ${module} -> input error before spawn`, (t) => {
    const value = preparedFixture(t);
    const manifest = JSON.parse(readFileSync(join(value.root, 'examples/react-vite-ssr/dist/client/.vite/manifest.json')));
    delete manifest[module];
    value.write('dist/client/.vite/manifest.json', manifest);

    assert.throws(() => prepareBrowserCommand(value.root, value.command), (error) => {
      assert.equal(error.kind, 'input-preparation');
      assert.ok(error.message.includes(module));
      return true;
    });
  });
}

test('browser preparation: two server entries -> retains normal subprocess and form webserver identities', (t) => {
  const value = preparedFixture(t);

  const prepared = prepareBrowserCommand(value.root, value.command);

  assert.deepEqual(Object.keys(prepared.identities).sort(), [
    'dist/client/.vite/manifest.json', 'dist/form-server/main.js', 'dist/server/main.js',
  ]);
  assert.deepEqual(prepared.observer, browserObservationPolicy);
});

for (const key of ['src/entry-client.ts', 'src/entry-server.ts', 'client-dependency', 'client-through-server']) {
  test(`browser preparation: unsupported JavaScript output ${key} -> input error before spawn`, (t) => {
    const value = preparedFixture(t);
    const manifest = JSON.parse(readFileSync(join(value.root, 'examples/react-vite-ssr/dist/client/.vite/manifest.json')));
    if (key === 'client-dependency' || key === 'client-through-server') {
      manifest[key] = { file: 'unsupported.css' };
      manifest['src/entry-client.ts'].imports = [key === 'client-through-server' ? 'src/entry-server.ts' : key];
      if (key === 'client-through-server') manifest['src/entry-server.ts'].imports = [key];
    } else {
      manifest[key].file = 'unsupported.css';
    }
    value.write('dist/client/unsupported.css', 'body {}');
    value.write('dist/client/.vite/manifest.json', manifest);

    assert.throws(() => prepareBrowserCommand(value.root, value.command), (error) => {
      assert.equal(error.kind, 'input-preparation');
      assert.match(error.message, /unsupported JavaScript output/u);
      assert.ok(error.message.includes(key));
      return true;
    });
  });
}

for (const extension of ['js', 'mjs', 'cjs']) {
  test(`browser preparation: supported ${extension} graph and unrelated CSS entry -> accepts runtime contract`, (t) => {
    const value = preparedFixture(t);
    const manifest = JSON.parse(readFileSync(join(value.root, 'examples/react-vite-ssr/dist/client/.vite/manifest.json')));
    manifest['src/entry-client.ts'].file = `client.${extension}`;
    manifest['src/entry-client.ts'].imports = ['dependency'];
    manifest.dependency = { file: `dependency.${extension}`, imports: ['src/entry-client.ts'] };
    manifest.stylesheet = { file: 'standalone.css' };
    manifest['src/entry-server.ts'].imports = ['stylesheet'];
    value.write(`dist/client/client.${extension}`, 'export {};');
    value.write(`dist/client/dependency.${extension}`, 'export {};');
    value.write('dist/client/standalone.css', 'body {}');
    value.write('dist/client/.vite/manifest.json', manifest);

    assert.doesNotThrow(() => prepareBrowserCommand(value.root, value.command));
  });
}

for (const env of ['FLUO_BACKGROUND_EVIDENCE', 'FLUO_RELIABILITY_OUTPUT', 'FLUO_RELIABILITY_REPORT',
  'FLUO_BROWSER_OUTPUT', 'FLUO_RELIABILITY_SEED', 'FLUO_RELIABILITY_ACTIONS', 'FLUO_BROWSER_SUITE']) {
  test(`browser preparation: missing ${env} -> fails before spawning tests`, (t) => {
    const value = preparedFixture(t);
    delete value.command.env[env];

    assert.throws(() => prepareBrowserCommand(value.root, value.command), (error) => {
      assert.equal(error.kind, 'input-preparation');
      assert.match(error.message, /missing/u);
      return true;
    });
  });
}
for (const [name, mutate, expected] of [
  ['normal-entry-replaced', (v) => v.write('dist/server/main.js', 'new FormControl();\n'), /normal production entry replaced/u],
  ['form-entry-replaced', (v) => v.write('dist/form-server/main.js', 'REACT_SSR_DELIVERY_PROBE;\n'), /invalid form-server entry/u],
  ['form-entry-absent', (v) => rmSync(join(v.root, 'examples/react-vite-ssr/dist/form-server/main.js')), /missing artifact dist\/form-server/u],
  ['manifest-entry-absent', (v) => v.write('dist/client/.vite/manifest.json', {}), /missing client manifest entries/u],
  ['manifest-truncated', (v) => v.write('dist/client/.vite/manifest.json', '{'), /invalid client manifest/u],
  ['manifest-null', (v) => v.write('dist/client/.vite/manifest.json', 'null'), /invalid client manifest object/u],
  ['manifest-array', (v) => v.write('dist/client/.vite/manifest.json', []), /invalid client manifest object/u],
  ['manifest-asset-absent', (v) => rmSync(join(v.root, 'examples/react-vite-ssr/dist/client/client.js')), /missing artifact dist\/client\/client.js/u],
  ['runner-absent', (v) => v.write('package.json', { scripts: {} }), /package-local runner changed/u],
  ['report-mismatch', (v) => { v.command.env.PLAYWRIGHT_JSON_OUTPUT_NAME = '/other/report.json'; }, /report path mismatch/u],
  ['config-absent', (v) => { v.command.args = v.command.args.filter((arg) => !arg.endsWith('browser-playwright.config.mjs')); }, /missing prepared package-local config/u],
]) {
  test(`browser preparation: ${name} -> concrete input error rather than product failure`, (t) => {
    const value = preparedFixture(t);
    mutate(value);

    assert.throws(() => prepareBrowserCommand(value.root, value.command), expected);
  });
}

for (const [field, invalid] of [['src', 1], ['name', false], ['imports', 'chunk.js'],
  ['css', [1]], ['assets', null], ['isDynamicEntry', 'true']]) {
  test(`browser preparation: malformed manifest ${field} -> input error`, (t) => {
    const value = preparedFixture(t);
    const manifest = JSON.parse(readFileSync(join(value.root, 'examples/react-vite-ssr/dist/client/.vite/manifest.json')));
    manifest['src/navigation-product.ts'][field] = invalid;
    value.write('dist/client/.vite/manifest.json', manifest);

    assert.throws(() => prepareBrowserCommand(value.root, value.command), (error) => {
      assert.equal(error.kind, 'input-preparation');
      assert.ok(error.message.includes(field));
      return true;
    });
  });
}

test('browser preparation: navigation source aliases -> accepted runtime mappings', (t) => {
  const value = preparedFixture(t);
  const manifest = JSON.parse(readFileSync(join(value.root, 'examples/react-vite-ssr/dist/client/.vite/manifest.json')));
  for (const [key, module] of [['product', 'src/navigation-product.ts'], ['admin', 'src/navigation-admin.ts']]) {
    manifest[key] = { ...manifest[module], src: module };
    delete manifest[module];
  }
  value.write('dist/client/.vite/manifest.json', manifest);

  assert.doesNotThrow(() => prepareBrowserCommand(value.root, value.command));
});

test('observer preparation: default lifetime -> input block rather than test-failed receipt', () => {
  assert.throws(() => assertBrowserObservation({ persistent: false, timeout_ms: 300000, completion: 'command-close' }),
    /persistent command-close observer/u);
});

test('owned runner: controlled 360000ms observer boundary -> stays alive until actual process close', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => t.mock.timers.reset());
  let child;
  const completed = runBrowserOwnedCommand({
    executable: process.execPath,
    args: ['-e', `process.on('message', () => process.exit(0)); process.send({ ready: true });`],
  }, { env: process.env }, {
    observer: { persistent: true, completion: 'command-close', default_lifetime_ms: 300000 },
    onChild(value) {
      child = value;
      const ready = once(child, 'message', { signal: AbortSignal.timeout(5000) });
      void ready.then(() => {
        t.mock.timers.tick(360000);
        assert.equal(child.exitCode, null);
        child.send({ release: true });
      });
    },
  });
  t.after(() => child?.kill('SIGKILL'));

  const outcome = await completed;

  assert.equal(outcome.status, 'passed');
  assert.equal(outcome.closed, true);
  assert.equal(outcome.descendantCleanup, 'owned-group-close');
});

test('owned runner: actual failing process -> terminal test-failed result not observer timeout', async () => {
  const command = { executable: process.execPath, args: ['-e', 'process.exit(7)'] };

  const outcome = await runBrowserOwnedCommand(command, { env: process.env });

  assert.equal(outcome.status, 'test-failed');
  assert.equal(outcome.exitCode, 7);
  assert.equal(outcome.signal, null);
  assert.equal(outcome.closed, true);
});

test('owned runner: cancellation at subscribed readiness -> retains cancellation despite handled zero exit', async (t) => {
  const controller = new AbortController();
  let child;
  const command = { executable: process.execPath, args: ['-e', `
    process.on('SIGTERM', () => process.exit(0));
    process.on('message', () => {});
    process.send({ ready: true });
  `] };
  const completed = runBrowserOwnedCommand(command, { env: process.env }, {
    signal: controller.signal,
    onChild(value) {
      child = value;
      const ready = once(child, 'message', { signal: AbortSignal.timeout(5000) });
      void ready.then(() => controller.abort('SIGINT'));
    },
  });
  t.after(() => child?.kill('SIGKILL'));

  const outcome = await completed;

  assert.equal(outcome.status, 'cancelled');
  assert.equal(outcome.cancelled, true);
  assert.equal(outcome.closed, true);
  assert.equal(outcome.exitCode, 0);
});
