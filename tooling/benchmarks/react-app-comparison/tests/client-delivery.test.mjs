import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  attributeDeliveryStages,
  captureDeliverySource,
  deliveryGraphPlugin,
  readDeliveryVersions,
  staticChunkClosure,
  summarizeDeliveryGraph,
  summarizeDeliveryRequests,
  verifyDeliveryTraceFiles,
} from '../src/client-delivery.mjs';

const execFileAsync = promisify(execFile);

test('version provenance reads installed manifests and rejects absent or range-valued versions', async (t) => {
  const app = await mkdtemp(join(tmpdir(), 'fluo-delivery-versions-'));
  t.after(() => rm(app, { recursive: true }));
  const names = ['react', 'react-dom', 'vite', '@fluojs/react'];
  for (const [index, name] of names.entries()) {
    const path = join(app, 'node_modules', name);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'package.json'), JSON.stringify({ name, version: `1.2.${index}` }));
  }
  const versions = await readDeliveryVersions(app);
  assert.deepEqual(Object.fromEntries(Object.entries(versions).map(([name, value]) => [name, value.version])), {
    react: '1.2.0', 'react-dom': '1.2.1', vite: '1.2.2', '@fluojs/react': '1.2.3',
  });
  await writeFile(join(app, 'node_modules/react/package.json'), JSON.stringify({ version: '^1.2.0' }));
  await assert.rejects(readDeliveryVersions(app), /Unavailable resolved/u);
  await rm(join(app, 'node_modules/react/package.json'));
  await assert.rejects(readDeliveryVersions(app), /ENOENT/u);
});

test('source capture retains parseable untracked inputs and independently verifiable hashes', async (t) => {
  const output = await mkdtemp(join(tmpdir(), 'fluo-delivery-source-'));
  t.after(() => rm(output, { recursive: true }));
  const source = fileURLToPath(new URL('../../../../', import.meta.url));
  const provenance = await captureDeliverySource(source, output);
  const patch = await readFile(join(output, 'source.patch'));
  const untracked = await readFile(join(output, 'untracked-inputs.json'));
  assert.match(provenance.head, /^[a-f0-9]{40}$/u);
  assert.equal(provenance.patchSha256, createHash('sha256').update(patch).digest('hex'));
  assert.equal(provenance.untrackedSha256, createHash('sha256').update(untracked).digest('hex'));
  for (const input of JSON.parse(untracked)) {
    assert.equal(input.sha256, createHash('sha256').update(input.content).digest('hex'));
    assert.equal(input.content, await readFile(join(source, input.path), 'utf8'));
  }
});

test('source capture retains the entire staged and unstaged patch beyond the exec buffer limit', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'fluo-delivery-large-source-'));
  t.after(() => rm(root, { recursive: true }));
  const source = join(root, 'source');
  const output = join(root, 'output');
  await mkdir(source);
  await mkdir(output);
  const git = (...args) => execFileAsync('git', args, { cwd: source });
  await git('init');
  await writeFile(join(source, 'tracked.txt'), 'original\n');
  await writeFile(join(source, 'binary.bin'), Buffer.from([0, 1, 2]));
  await git('add', '.');
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
    '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial fixture');
  const staged = 'staged change\n'.repeat(80_000);
  await writeFile(join(source, 'tracked.txt'), staged);
  await writeFile(join(source, 'binary.bin'), Buffer.from([0, 3, 4]));
  await git('add', '.');
  await writeFile(join(source, 'tracked.txt'), `${staged}unstaged ending\n`);
  await writeFile(join(source, 'untracked.txt'), 'untracked input\n');
  const expectedPath = join(root, 'expected.patch');
  await git('diff', 'HEAD', '--binary', `--output=${expectedPath}`);
  const expected = await readFile(expectedPath);
  assert.ok(expected.byteLength > 1024 * 1024);

  const provenance = await captureDeliverySource(source, output);
  const patch = await readFile(join(output, 'source.patch'));
  assert.deepEqual(patch, expected);
  assert.equal(provenance.patchSha256, createHash('sha256').update(expected).digest('hex'));
  assert.equal(provenance.dirty, (await git('status', '--porcelain=v1')).stdout.trim());
  const untracked = await readFile(join(output, 'untracked-inputs.json'));
  assert.equal(provenance.untrackedSha256, createHash('sha256').update(untracked).digest('hex'));
  assert.deepEqual(JSON.parse(untracked), [{
    path: 'untracked.txt',
    content: 'untracked input\n',
    sha256: createHash('sha256').update('untracked input\n').digest('hex'),
  }]);
  await assert.rejects(captureDeliverySource(source, output), { code: 'EEXIST' });
  assert.deepEqual(await readFile(join(output, 'source.patch')), expected);
});

test('stage attribution requires approved built module requests and a rendered frame', () => {
  const manifest = {
    entry: { isEntry: true, name: 'entry-client', file: 'entry.js' },
    'src/initial.ts': { file: 'initial.js' },
    'src/destination.ts': { file: 'destination.js' },
  };
  const requests = [
    { id: 'html', type: 'Document', url: 'https://example.test/', complete: true, start: 1, end: 2 },
    ...['entry', 'initial', 'destination'].map((name, index) => ({
      id: name, type: 'Script', url: `https://example.test/assets/${name}.js`,
      complete: true, start: index + 2, end: index + 3,
    })),
    { id: 'approval', type: 'Fetch', url: 'https://example.test/destination', complete: true, start: 4, end: 5,
      accept: 'application/vnd.fluo.react-navigation+json;v=2' },
  ];
  const stages = [
    { name: 'hydration-control-ack', time: 12 }, { name: 'rendered-commit', time: 30 },
    { name: 'rendered-frame', time: 34 },
  ];
  const initial = { destination: { module: './initial.ts' } };
  const destination = { destination: { module: './destination.ts' } };
  const result = attributeDeliveryStages(manifest, requests, stages, initial, destination);
  assert.deepEqual(result.map((stage) => stage.name), [
    'html', 'bootstrap', 'initial-module', 'hydration-control-ack',
    'navigation-payload', 'destination-module', 'rendered-commit', 'rendered-frame',
  ]);
  assert.equal(result[5].requestId, 'destination');
  assert.throws(() => attributeDeliveryStages(manifest, requests, stages.slice(0, 2), initial, destination), /rendered-frame/u);
  assert.throws(() => attributeDeliveryStages(manifest, requests.slice(0, 3), stages, initial, destination), /navigation-payload/u);
  assert.throws(() => attributeDeliveryStages(manifest, requests, stages, initial, {
    destination: { module: './unbuilt.ts' },
  }), /Unbuilt/u);
});

test('emitted static closure excludes lazy destinations and deduplicates shared edges', () => {
  // Given: two entries import one shared chunk; a destination is dynamic only.
  const graph = { chunks: [
    { file: 'bootstrap.js', imports: ['shared.js'], bytes: 10, modules: [{ id: 'entry.ts', renderedBytes: 8 }] },
    { file: 'initial.js', imports: ['shared.js'], bytes: 20, modules: [{ id: 'page.ts', renderedBytes: 12 }] },
    { file: 'shared.js', imports: [], bytes: 30, modules: [{ id: 'react.js', renderedBytes: 28 }] },
    { file: 'destination.js', imports: ['shared.js'], bytes: 40, modules: [{ id: 'other.ts', renderedBytes: 36 }] },
  ] };
  // When: the graph is classified for the actual bootstrap and approved initial module.
  const result = summarizeDeliveryGraph(graph, ['bootstrap.js', 'initial.js']);
  // Then: shared bytes occur once and destination-only code remains outside the eager closure.
  assert.deepEqual(result, {
    eager: ['bootstrap.js', 'initial.js', 'shared.js'],
    eagerBytes: 60,
    lazy: ['destination.js'],
    duplicateModules: [],
    reactRuntimeRoots: [],
  });
  assert.throws(() => staticChunkClosure(graph, ['missing.js']), /Missing emitted chunk/u);
});

test('graph detects two physical React runtimes even when emitted module IDs differ', () => {
  const graph = { chunks: [
    { file: 'one.js', imports: [], bytes: 10, modules: [
      { id: '/app/node_modules/react/cjs/react.production.js', renderedBytes: 8 },
      { id: '\0/app/node_modules/react/index.js?commonjs-proxy', renderedBytes: 1 },
    ] },
    { file: 'two.js', imports: [], bytes: 10, modules: [
      { id: '/other/node_modules/react/cjs/react.production.js', renderedBytes: 7 },
    ] },
  ] };
  assert.deepEqual(summarizeDeliveryGraph(graph, ['one.js']).reactRuntimeRoots, [
    '/app/node_modules/react', '/other/node_modules/react',
  ]);
});

test('graph distinguishes emitted module duplicates from zero-byte tree-shaken members', () => {
  const graph = { chunks: [
    { file: 'one.js', imports: [], bytes: 10, modules: [{ id: 'react.js', renderedBytes: 8 }] },
    { file: 'two.js', imports: [], bytes: 10, modules: [
      { id: 'react.js', renderedBytes: 7 }, { id: 'unused.js', renderedBytes: 0 },
    ] },
  ] };
  assert.deepEqual(summarizeDeliveryGraph(graph, ['one.js']).duplicateModules, [
    { id: 'react.js', files: ['one.js', 'two.js'] },
  ]);
});

test('build observer records real code bytes and edges without mutating the bundle', () => {
  const bundle = {
    'entry.js': {
      type: 'chunk', fileName: 'entry.js', isEntry: true, isDynamicEntry: false,
      facadeModuleId: '/src/entry.ts', code: 'é', imports: ['shared.js'], dynamicImports: ['page.js'],
      modules: { '/src/entry.ts': { renderedLength: 2, originalLength: 5 } },
    },
    'style.css': { type: 'asset', fileName: 'style.css', source: 'body{}' },
  };
  const before = structuredClone(bundle);
  let result;
  deliveryGraphPlugin((graph) => { result = graph; }).generateBundle({}, bundle);
  assert.equal(result.chunks[0].bytes, 2);
  assert.deepEqual(result.chunks[0].dynamicImports, ['page.js']);
  assert.deepEqual(result.chunks[0].modules, [{ id: '/src/entry.ts', renderedBytes: 2, originalBytes: 5 }]);
  assert.deepEqual(bundle, before);
});

test('missing assets or body capture cannot become zero-valued complete observations', () => {
  assert.equal(summarizeDeliveryRequests([]).status, 'inconclusive');
  assert.deepEqual(summarizeDeliveryRequests([{ type: 'Script', complete: false, url: '/entry.js' }]), {
    status: 'inconclusive', decodedBytes: null, encodedTransportBytes: null, duplicateTransfers: [],
  });
});

test('inventory keeps cache hits separate from duplicate network transfers', () => {
  const requests = [
    { type: 'Script', url: '/entry.js', complete: true, decodedBytes: 100, encodedTransportBytes: 40 },
    { type: 'Script', url: '/entry.js', complete: true, diskCache: true, decodedBytes: 100, encodedTransportBytes: 0 },
    { type: 'Script', url: '/entry.js', complete: true, decodedBytes: 100, encodedTransportBytes: 40 },
  ];
  assert.deepEqual(summarizeDeliveryRequests(requests), {
    status: 'complete', decodedBytes: 300, encodedTransportBytes: 80,
    duplicateTransfers: [{ url: '/entry.js', count: 2 }],
  });
});

test('trace verification rejects missing, partial and symlink-escaped evidence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'fluo-delivery-'));
  const outside = await mkdtemp(join(tmpdir(), 'fluo-delivery-outside-'));
  t.after(() => Promise.all([rm(root, { recursive: true }), rm(outside, { recursive: true })]));
  const hash = createHash('sha256').update('{}').digest('hex');
  for (const file of ['source.patch', 'untracked-inputs.json', 'package.json']) {
    await writeFile(join(root, file), '{}');
  }
  const manifest = {
    entry: { isEntry: true, name: 'entry-client', file: 'entry.js' },
    'src/initial.ts': { file: 'initial.js' },
    'src/destination.ts': { file: 'destination.js' },
  };
  const manifestRaw = JSON.stringify(manifest);
  await writeFile(join(root, 'manifest.json'), manifestRaw);
  const requests = [
    { id: 'html', type: 'Document', url: 'https://fixture.test/', complete: true, start: 1, end: 2 },
    ...['entry', 'initial', 'destination'].map((name, index) => ({
      id: name, type: 'Script', url: `https://fixture.test/assets/${name}.js`,
      complete: true, start: index + 2, end: index + 3,
    })),
    { id: 'approval', type: 'Fetch', url: 'https://fixture.test/search', complete: true, start: 4, end: 5,
      accept: 'application/vnd.fluo.react-navigation+json;v=2' },
  ];
  const stages = [
    { name: 'hydration-control-ack', time: 12 },
    { name: 'rendered-commit', time: 30 }, { name: 'rendered-frame', time: 34 },
  ];
  const initial = { destination: { module: './initial.ts' } };
  const destination = { destination: { module: './destination.ts' } };
  const record = {
    version: 1, complete: true,
    provenance: {
      head: 'a'.repeat(40), lockSha256: 'b'.repeat(64), buildId: 'c'.repeat(64),
      browser: 'fixture-browser', runtime: 'fixture-runtime', pnpm: 'fixture-pnpm',
      dataset: 'fixture', profile: 'fixture', uncertainty: 'fixture', cache: 'cold',
      resolvedVersions: Object.fromEntries(['react', 'react-dom', 'vite', '@fluojs/react']
        .map((name) => [name, { version: '1.2.3' }])),
      patchSha256: hash, untrackedSha256: hash,
      manifestSha256: createHash('sha256').update(manifestRaw).digest('hex'), packageSha256: hash,
    },
    requests, stages, initial, destination,
    inventory: { status: 'complete' },
    attributed: attributeDeliveryStages(manifest, requests, stages, initial, destination),
  };
  const complete = JSON.stringify(record);
  await writeFile(join(root, 'complete.json'), complete);
  await writeFile(join(root, 'partial.json'), '{"version":1');
  await writeFile(join(outside, 'escape.json'), complete);
  await symlink(join(outside, 'escape.json'), join(root, 'escape.json'));
  await verifyDeliveryTraceFiles(root, ['complete.json']);
  for (const [index, stage] of record.attributed.entries()) {
    await t.test(`${stage.name} rejects the other stage clock`, async () => {
      const changed = structuredClone(record);
      changed.attributed[index] = stage.clock === 'cdp-monotonic-seconds'
        ? { name: stage.name, clock: 'document-performance-milliseconds', time: 12 }
        : { name: stage.name, clock: 'cdp-monotonic-seconds', requestId: 'html', start: 1, end: 2 };
      await writeFile(join(root, 'wrong-clock.json'), JSON.stringify(changed));
      await assert.rejects(verifyDeliveryTraceFiles(root, ['wrong-clock.json']), /attribution/u);
    });
    await t.test(`${stage.name} rejects mismatched raw observation`, async () => {
      const changed = structuredClone(record);
      if (stage.clock === 'cdp-monotonic-seconds') changed.attributed[index].end += 0.5;
      else changed.attributed[index].time += 0.5;
      await writeFile(join(root, 'wrong-observation.json'), JSON.stringify(changed));
      await assert.rejects(verifyDeliveryTraceFiles(root, ['wrong-observation.json']), /attribution/u);
    });
  }
  for (const [name, mutate] of [
    ['unrelated request', (r) => { r.attributed[5] = { ...r.attributed[5], requestId: 'html', start: 1, end: 2 }; }],
    ['wrong module', (r) => { r.attributed[5].module = './initial.ts'; }],
    ['missing DOM observation', (r) => { r.stages.pop(); }],
    ['duplicate DOM observation', (r) => { r.stages.push({ ...r.stages[0] }); }],
    ['wrong request asset', (r) => { r.requests[1].url = 'https://fixture.test/assets/unrelated.js'; }],
  ]) {
    await t.test(`delivery attribution rejects ${name}`, async () => {
      const changed = structuredClone(record);
      mutate(changed);
      await writeFile(join(root, 'wrong-binding.json'), JSON.stringify(changed));
      await assert.rejects(verifyDeliveryTraceFiles(root, ['wrong-binding.json']), /attribution/u);
    });
  }
  await assert.rejects(verifyDeliveryTraceFiles(root, []), /required/u);
  await assert.rejects(verifyDeliveryTraceFiles(root, ['missing.json']), /ENOENT/u);
  await assert.rejects(verifyDeliveryTraceFiles(root, ['partial.json']), SyntaxError);
  await assert.rejects(verifyDeliveryTraceFiles(root, ['escape.json']), /outside output root/u);
  await writeFile(join(root, 'unfinished.json'), JSON.stringify({ version: 1, complete: false }));
  await assert.rejects(verifyDeliveryTraceFiles(root, ['unfinished.json']), /Incomplete/u);
  await writeFile(join(root, 'missing-provenance.json'), JSON.stringify({ ...record, provenance: {} }));
  await assert.rejects(verifyDeliveryTraceFiles(root, ['missing-provenance.json']), /provenance/u);
  await writeFile(join(root, 'bad-stage.json'), JSON.stringify({ ...record, attributed: Array(8).fill({}) }));
  await assert.rejects(verifyDeliveryTraceFiles(root, ['bad-stage.json']), /attribution/u);
  await writeFile(join(root, 'manifest.json'), '{"changed":true}');
  await assert.rejects(verifyDeliveryTraceFiles(root, ['complete.json']), /Mismatched/u);
});
