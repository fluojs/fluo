import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { before, test } from 'node:test';
import { load } from '../src/load';
import { selectProfileTargets } from '../src/profile';
import {
  profileCompleteness, requestSamples, sha256, timingCompleteness, validateCapture,
  type ProfileCapture, type ProfileRun, type StageTimingSample,
} from '../src/profile-report';
import { monitorServer } from '../src/resources';
import { SCENARIOS, STAGE_SCENARIOS } from '../src/scenarios';
import { TARGETS, targetLaunch } from '../src/targets';

let measured: Awaited<ReturnType<typeof monitorServer<Awaited<ReturnType<typeof load>>>>>;
before(async () => {
  const server = createServer((_request, response) => { response.end('{"ok":true}'); });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    measured = await monitorServer(process.pid, () => load({
      url: `http://127.0.0.1:${address.port}`, duration: 1, amount: 3, connections: 1,
      requests: [{ method: 'GET', path: '/', expectedStatus: 200, expectedBody: '{"ok":true}' }],
    }, 'profile-model-fixture'));
  } finally {
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

function fixture() {
  const provenance = '{}';
  const raw = new Map<string, Uint8Array>();
  const profile = {
    nodes: [{ id: 1, callFrame: { functionName: 'readSearchLocal', url: 'shared/workloads.js' }, children: [] }],
    samples: [1], timeDeltas: [1000], startTime: 0, endTime: 1000,
  };
  const artifacts = [
    ['attempt/profile.json', 'profile', JSON.stringify(profile)],
    ['attempt/subject.json', 'identity', JSON.stringify({ pid: 123, runtimePid: 123, isolateId: null, inspectorUrl: 'ws://127.0.0.1:1234' })],
    ['attempt/provenance.json', 'build', provenance],
  ] as const;
  const runs = (['control-before', 'capture', 'control-after'] as const).map((phase): ProfileRun => ({
    ...measured, phase, instrumentation: phase === 'capture' ? 'cpu' : 'none', launcherPid: 123,
    startedMs: 1, endedMs: 2, exit: { code: 0, signal: null },
    launch: { command: 'node', args: ['server.js'], cwd: '/benchmark', env: {} },
  }));
  const capture: ProfileCapture = {
    condition: { target: 'native-nodejs', platform: 'nodejs', scenario: 'read-search-local', configuration: 'equivalent', connections: 64, repeat: 0, mode: 'cpu' },
    status: 'supported', reason: null,
    subject: { kind: 'process', pid: 123, launcherPid: 123, isolateId: null, inspectorUrl: 'ws://127.0.0.1:1234', runtime: { node: '24' } },
    format: 'v8-cpu', profilePath: 'attempt/profile.json', identityPath: 'attempt/subject.json',
    artifacts: artifacts.map(([path, kind, bytes]) => {
      const content = Buffer.from(bytes);
      raw.set(path, content);
      return { path, kind, sha256: sha256(content), bytes: content.byteLength };
    }),
    anchors: [1, 2].map((servingMs) => ({ collectorBeforeMs: servingMs, collectorAfterMs: servingMs + 1, servingMs, servingUptimeMs: servingMs })),
    runs, provenanceSha256: sha256(provenance), limitations: [],
  };
  return { capture, raw, profile };
}

test('target selection supports every target and rejects unknown or duplicate entries', () => {
  // Given / When / Then
  assert.equal(selectProfileTargets().length, 16);
  assert.equal(selectProfileTargets(['nestjs-fastify', 'fluo-workers']).length, 2);
  assert.throws(() => selectProfileTargets(['unknown']));
  assert.throws(() => selectProfileTargets(['native-nodejs', 'native-nodejs']));
});

test('optional inspector launch preserves default args and isolates runtime flags', () => {
  // Given
  for (const target of TARGETS) {
    const ordinary = targetLaunch(target, 'read-search-local');
    // When
    const instrumented = targetLaunch(target, 'read-search-local', { inspectorPort: 35333, gcTrace: true, env: { BENCH_CONFIGURATION: 'equivalent' } });
    // Then
    assert.deepEqual(target.args, TARGETS.find((item) => item.name === target.name)?.args);
    assert.ok(!ordinary.args.some((arg) => arg.startsWith('--inspect=')));
    if (target.platform === 'workers') {
      assert.equal(instrumented.args[instrumented.args.indexOf('--inspector-port') + 1], '35333');
      assert.ok(instrumented.args.includes('BENCH_CONFIGURATION:equivalent'));
      assert.ok(!instrumented.args.includes('--trace-gc'));
    } else {
      assert.ok(instrumented.args.some((arg) => arg.startsWith('--inspect=127.0.0.1:35333')));
      assert.equal(instrumented.args.includes('--trace-gc'), !['bun', 'deno'].includes(target.platform));
    }
  }
});

test('CPU validity rejects startup-only samples and accepts request stack ancestry', () => {
  // Given
  const { profile } = fixture();
  const startup = { ...profile, nodes: [{ id: 1, callFrame: { functionName: '(program)', url: '' }, children: [] }] };
  // When / Then
  assert.equal(requestSamples(startup, 'v8-cpu'), 0);
  assert.equal(requestSamples(profile, 'v8-cpu'), 1);
  assert.throws(() => requestSamples({ ...profile, nodes: [{ ...profile.nodes[0], children: [1] }] }, 'v8-cpu'));
});

function nestRequestStack(callFrame: { readonly functionName: string; readonly url: string }, format: 'v8-cpu' | 'v8-allocation') {
  const leaf = { id: 4, callFrame: { functionName: 'sort', url: '' }, children: [] };
  const handler = { id: 3, callFrame, children: [leaf] };
  const unrelated = { id: 5, callFrame: { functionName: 'main', url: 'unrelated/server.js' }, children: [] };
  const router = { id: 2, callFrame: { functionName: '', url: 'node_modules/@nestjs/core/router/router-execution-context.js' }, children: [handler, unrelated] };
  const head = { id: 1, callFrame: { functionName: '(root)', url: '' }, children: [router] };
  const samples = [1, 2, 3, 4, 4, 5];
  return format === 'v8-cpu'
    ? { nodes: [head, router, handler, leaf, unrelated].map((node) => ({ ...node, children: node.children.map((child) => child.id) })), samples }
    : { head, samples: samples.map((nodeId, index) => ({ nodeId, size: 64, ordinal: index + 1 })) };
}

for (const format of ['v8-cpu', 'v8-allocation'] as const) {
  test(`requestSamples: legitimate Nest handlers in ${format} -> count handler and descendants only`, () => {
    // Given
    const frames = [
      ...['src/nestjs/server.ts', 'file:///benchmark/dist/nestjs/nestjs/server.js'].flatMap((url) =>
        ['search', 'quote', 'project', 'tasks', 'task', 'preview', 'comments'].map((functionName) => ({ functionName, url }))),
      ...['src/shared/nest-stages.ts', '/benchmark/dist/nestjs/shared/nest-stages.js'].flatMap((url) =>
        ['read', 'canActivate', 'transform'].map((functionName) => ({ functionName, url }))),
    ];
    for (const callFrame of frames) {
      const profile = nestRequestStack(callFrame, format);

      // When
      const matched = requestSamples(profile, format);

      // Then
      assert.equal(matched, 3, `${callFrame.url}:${callFrame.functionName}`);
    }
  });

  test(`requestSamples: Nest startup and unrelated frames in ${format} -> reject all samples`, () => {
    // Given
    const frames = [
      ...['src/nestjs/server.ts', '/benchmark/dist/nestjs/nestjs/server.js',
        'src/shared/nest-stages.ts', '/benchmark/dist/nestjs/shared/nest-stages.js'].flatMap((url) =>
        ['main', 'bootstrap', 'create', 'constructor', 'resolveAppModule', 'resolveNestStageModule', 'descriptor', 'unrelated', ''].map((functionName) => ({ functionName, url }))),
      ...['unrelated/server.js', '/benchmark/src/nestjs/server.ts.backup', '/benchmark/dist/nestjs/nestjs/server.js.map',
        '/benchmark/dist/other/nestjs/server.js', 'node_modules/@nestjs/core/nest-factory.js',
        'node_modules/fastify/fastify.js'].flatMap((url) =>
        ['search', 'quote', 'project', 'tasks', 'task', 'preview', 'comments', 'read', 'canActivate', 'transform'].map((functionName) => ({ functionName, url }))),
      { functionName: 'read', url: 'src/nestjs/server.ts' },
      { functionName: 'search', url: 'src/shared/nest-stages.ts' },
      { functionName: 'transform', url: 'unrelated/shared/nest-stages.js' },
    ];
    for (const callFrame of frames) {
      const profile = nestRequestStack(callFrame, format);

      // When
      const matched = requestSamples(profile, format);

      // Then
      assert.equal(matched, 0, `${callFrame.url}:${callFrame.functionName}`);
    }
  });
}

test('JSC stacks and heap snapshots remain separate evidence formats', () => {
  // Given
  const profile = { stackTraces: [{ stackFrames: [{ name: 'readSearchLocal', url: 'workloads.js' }] }] };
  // When / Then
  assert.equal(requestSamples(profile, 'jsc-cpu'), 1);
  assert.equal(requestSamples({ nodes: [1], edges: [1] }, 'jsc-heap'), 1);
  assert.throws(() => requestSamples({ nodes: [1], edges: [1] }, 'v8-allocation'));
});

test('stage-only request frames include anonymous and zero-argument handlers but exclude startup factories', () => {
  // Given
  const frames = [
    { functionName: '', url: 'file:///dist/shared/native-stages.js', lineNumber: 4 },
    { functionName: 'read', url: 'file:///dist/shared/fluo-stages.js', lineNumber: 10 },
    { functionName: 'nativeFetch', url: 'file:///dist/native-deno/server.mjs', lineNumber: 200 },
    { functionName: 'executeFastPath', url: '/packages/http/dist/dispatch/fast-path/fast-path-executor.js', lineNumber: 10 },
  ];
  // When / Then
  for (const callFrame of frames) {
    assert.equal(requestSamples({ nodes: [{ id: 1, callFrame, children: [] }], samples: [1] }, 'v8-cpu'), 1);
    assert.equal(requestSamples({ stackTraces: [{ stackFrames: [{ name: callFrame.functionName, url: callFrame.url, line: callFrame.lineNumber + 1 }] }] }, 'jsc-cpu'), 1);
  }
  assert.equal(requestSamples({ nodes: [{ id: 1, callFrame: { functionName: 'createNativeStage', url: 'shared/native-stages.js', lineNumber: 1 }, children: [] }], samples: [1] }, 'v8-cpu'), 0);
  assert.equal(requestSamples({ nodes: [{ id: 1, callFrame: { functionName: 'createDispatcher', url: '/packages/http/dist/dispatch/dispatcher.js', lineNumber: 5 }, children: [] }], samples: [1] }, 'v8-cpu'), 0);
});

test('capture validity accepts hashed profiles with serving identity and real successful traffic', () => {
  // Given
  const { capture, raw } = fixture();
  // When
  const errors = validateCapture(capture, raw);
  // Then
  assert.deepEqual(errors, []);
});

test('empty CPU samples fail even when raw bytes and hashes agree', () => {
  // Given
  const { capture, raw, profile } = fixture();
  const bytes = Buffer.from(JSON.stringify({ ...profile, samples: [], timeDeltas: [] }));
  raw.set('attempt/profile.json', bytes);
  const changed = { ...capture, artifacts: capture.artifacts.map((artifact) => artifact.kind === 'profile'
    ? { ...artifact, bytes: bytes.byteLength, sha256: sha256(bytes) } : artifact) };
  // When / Then
  assert.ok(validateCapture(changed, raw).includes('empty-or-startup-profile'));
});

for (const defect of ['missing-raw', 'wrong-hash', 'wrong-subject', 'partial-controls', 'wrong-mode', 'missing-provenance', 'failed', 'fake-unsupported', 'abnormal-signal'] as const) {
  test(`capture validity rejects ${defect}`, () => {
    // Given
    const { capture, raw } = fixture();
    let changed = capture;
    switch (defect) {
      case 'missing-raw': raw.delete('attempt/profile.json'); break;
      case 'wrong-hash': raw.set('attempt/profile.json', Buffer.from('{}')); break;
      case 'wrong-subject': changed = { ...capture, subject: capture.subject ? { ...capture.subject, pid: 456 } : null }; break;
      case 'partial-controls': changed = { ...capture, runs: capture.runs.slice(0, 2) }; break;
      case 'wrong-mode': changed = { ...capture, condition: { ...capture.condition, mode: 'allocation' } }; break;
      case 'missing-provenance': changed = { ...capture, artifacts: capture.artifacts.filter((a) => a.kind !== 'build') }; break;
      case 'failed': changed = { ...capture, status: 'failed', reason: 'flush failed' }; break;
      case 'fake-unsupported': changed = { ...capture, status: 'unsupported', reason: 'connection failed' }; break;
      case 'abnormal-signal': changed = { ...capture, runs: capture.runs.map((run) => ({ ...run, exit: { code: null, signal: 'SIGABRT' } })) }; break;
    }
    // When / Then
    assert.notEqual(validateCapture(changed, raw).length, 0);
  });
}

test('profile completeness rejects absent and duplicate expected conditions', () => {
  // Given
  const { capture, raw } = fixture();
  const extra = { ...capture.condition, target: 'fluo-nodejs' };
  // When / Then
  assert.equal(profileCompleteness([capture], [capture.condition], raw).status, 'complete');
  assert.equal(profileCompleteness([capture], [capture.condition, extra], raw).status, 'incomplete');
  assert.equal(profileCompleteness([capture, capture], [capture.condition, extra], raw).status, 'incomplete');
});

test('canonical Next graceful SIGTERM exit 143 preserves flushed profile validity', () => {
  // Given
  const { capture, raw } = fixture();
  const next: ProfileCapture = { ...capture,
    condition: { ...capture.condition, target: 'native-nextjs', platform: 'nextjs' },
    runs: capture.runs.map((run) => ({ ...run, exit: { code: 143, signal: null } })),
  };
  // When / Then
  assert.deepEqual(validateCapture(next, raw), []);
  assert.notEqual(validateCapture({ ...capture, runs: next.runs }, raw).length, 0);
});

function timingSamples(): StageTimingSample[] {
  return TARGETS.flatMap((target) => [...SCENARIOS, ...STAGE_SCENARIOS].flatMap((scenario) =>
    (['default', 'equivalent'] as const).flatMap((configuration) => [1, 64].flatMap((connections) =>
      [0, 1, 2].map((repeat) => ({
        target: target.name, scenario: scenario.name, configuration, connections, repeat,
        mode: 'uninstrumented' as const, source: 'issue3910' as const,
        requests: 100, errors: 0, timeouts: 0, non2xx: 0, bodyMismatches: 0, statusMismatches: 0,
        warmupSeconds: 5, durationSeconds: 15, sourceSha256: sha256('source'),
        buildSourceSha256: sha256('source'), rawSha256: sha256('raw'), provenanceSha256: sha256('fresh'),
      }))))));
}

test('timing completeness accepts exactly 2112 fresh uninstrumented stage and business conditions', () => {
  // Given
  const samples = timingSamples();
  // When / Then
  assert.equal(samples.length, 2112);
  assert.equal(timingCompleteness(samples, sha256('fresh')).status, 'complete');
});

for (const defect of ['historical-576', 'instrumented', 'missing-condition', 'duplicate-condition', 'wrong-provenance', 'zero-traffic', 'status-mismatch', 'timeout', 'wrong-interval', 'wrong-build'] as const) {
  test(`timing completeness rejects ${defect}`, () => {
    // Given
    const samples = timingSamples();
    let changed = samples;
    switch (defect) {
      case 'historical-576': changed = samples.slice(0, 576).map((s) => ({ ...s, source: 'historical' })); break;
      case 'instrumented': changed = samples.map((s) => ({ ...s, mode: 'cpu' })); break;
      case 'missing-condition': changed = samples.slice(1); break;
      case 'duplicate-condition': changed = [...samples.slice(1), samples[1]]; break;
      case 'wrong-provenance': changed = samples.map((s) => ({ ...s, provenanceSha256: sha256('stale') })); break;
      case 'zero-traffic': changed = samples.map((s) => ({ ...s, requests: 0 })); break;
      case 'status-mismatch': changed = samples.map((s) => ({ ...s, statusMismatches: 1 })); break;
      case 'timeout': changed = samples.map((s) => ({ ...s, timeouts: 1 })); break;
      case 'wrong-interval': changed = samples.map((s) => ({ ...s, durationSeconds: 2 })); break;
      case 'wrong-build': changed = samples.map((s) => ({ ...s, buildSourceSha256: sha256('stale') })); break;
    }
    // When / Then
    assert.equal(timingCompleteness(changed, sha256('fresh')).status, 'incomplete');
  });
}
