import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertBrowserObservation, browserObservationPolicy, prepareBrowserCommand, runBrowserOwnedCommand } from './browser-preparation.mjs';
import { productDomainPlan } from './react-product-acceptance.mjs';

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
  command.args[command.args.indexOf('--config') + 1] = join(root, 'tooling/ci/browser-playwright.config.mjs');
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
