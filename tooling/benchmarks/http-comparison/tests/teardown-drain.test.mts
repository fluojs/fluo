import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EvidenceJournal } from '../src/evidence';
import { captureCondition, type CapturePlan } from '../src/profile';
import { object, sha256 } from '../src/profile-report';
import type { EnvironmentSummary } from '../src/provenance';
import type { ScenarioConfig } from '../src/scenarios';
import { startTargets, stopTargets, TARGETS, type TargetConfig, waitForTarget } from '../src/targets';

async function unusedPorts(): Promise<number[]> {
  const servers = [createServer(), createServer()];
  try {
    const ports = [];
    for (const server of servers) {
      const listening = once(server, 'listening');
      server.listen(0, '127.0.0.1');
      await listening;
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      ports.push(address.port);
    }
    return ports;
  } finally {
    await Promise.all(servers.filter((server) => server.listening).map(async (server) => {
      const closed = once(server, 'close');
      server.close();
      await closed;
    }));
  }
}

test('captureCondition: final control shutdown overflows raw limit -> journals failed capture', { timeout: 30_000 }, async () => {
  // Given: sequential real servers, with oversized output only on shutdown three.
  const root = await mkdtemp(join(process.env.TEARDOWN_EVIDENCE_ROOT ?? tmpdir(), 'teardown-capture-'));
  const phaseFile = join(root, 'phase.txt');
  await writeFile(phaseFile, '0');
  const target: TargetConfig = {
    name: 'native-nodejs', platform: 'nodejs', product: 'native', label: 'teardown fixture',
    command: process.execPath, args: ['tests/fixtures/teardown-profile-server.mjs', phaseFile], port: 0,
  };
  // The entry digest follows the existing last-argv contract.
  target.args.push('tests/fixtures/teardown-profile-server.mjs');
  const scenario: ScenarioConfig = {
    appShape: 'read-search-local', name: 'teardown-regression', description: 'diagnostic traffic',
    requests: [{ method: 'GET', path: '/', expectedStatus: 200, expectedBody: '{"ok":true}' }],
  };
  const [httpPort, inspectorPort] = await unusedPorts();
  const plan: CapturePlan = {
    targets: [target], scenarios: [scenario], modes: ['cpu'], configuration: 'equivalent',
    connections: 1, repeats: 1, warmupSeconds: 0.1, durationSeconds: 0.1, controlSeconds: 0.1,
    portBase: httpPort - TARGETS.findIndex((item) => item.name === target.name),
    inspectorPortBase: inspectorPort - TARGETS.findIndex((item) => item.name === target.name),
    outputDirectory: root,
  };
  const environment: EnvironmentSummary = {
    capturedAt: new Date().toISOString(), arch: process.arch, platform: process.platform,
    osRelease: 'fixture', cpuModel: 'fixture', cpuCount: 1, node: process.version,
    nodeExecutable: process.execPath, bun: null, deno: null, pnpm: 'fixture',
    dependencies: {}, adapterFastify: {}, adapterExpress: {}, lockfiles: {},
    git: { sha: 'fixture', dirty: true, status: 'fixture' },
    benchmarkSource: { sha256: sha256('fixture'), files: {} },
  };
  const journal = new EvidenceJournal(join(root, 'journal.json'), () => ({}));
  try {
    // When
    const capture = await captureCondition({
      plan, target, scenario, environment, journal, provenanceSha256: sha256(JSON.stringify(environment)),
      condition: { target: target.name, platform: target.platform, scenario: scenario.name,
        configuration: plan.configuration, connections: 1, repeat: 0, mode: 'cpu' },
    });

    // Then: all traffic and failed raw bytes remain available, not supported.
    assert.equal(await readFile(phaseFile, 'utf8'), '3');
    assert.equal(capture.status, 'failed');
    assert.match(capture.reason ?? '', /67108864.*control-after\.stdout\.log/);
    assert.equal(journal.failures.length, 1);
    assert.deepEqual(capture.runs.map((run) => run.phase), ['control-before', 'capture', 'control-after']);
    const failure = capture.artifacts.find((artifact) => artifact.path.endsWith('/failure.json'));
    assert.ok(failure);
    const diagnostic = object(JSON.parse(await readFile(join(root, failure.path), 'utf8')));
    assert.equal(object(diagnostic.phase).phase, 'control-after');
    assert.ok(capture.artifacts.some((artifact) => artifact.path.endsWith('/control-after.stdout.log') && artifact.bytes > 0));
    const terminal = capture.artifacts.find((artifact) => artifact.path.endsWith('/control-after.stderr.log'));
    assert.ok(terminal);
    assert.match(await readFile(join(root, terminal.path), 'utf8'), /phase-3-shutdown/);
  } finally {
    journal.finish();
    if (!process.env.TEARDOWN_EVIDENCE_ROOT) await rm(root, { recursive: true, force: true });
  }
});

for (const mode of ['shutdown', 'exited', 'escaped'] as const) {
  test(`stopTargets: ${mode} parent with descendant-held pipes -> drains or reports failure`, { timeout: 10_000 }, async () => {
    // Given: the descendant is ready before the parent can exit or be signalled.
    let stdout = '';
    let stderr = '';
    const children = startTargets('read-search-local', [{
      name: 'native-nodejs', platform: 'nodejs', product: 'native', label: 'pipe fixture',
      command: process.execPath, args: ['tests/fixtures/teardown-pipe-owner.mjs', mode], port: 0,
    }], { quiet: true, onOutput: (_target, stream, bytes) => {
      if (stream === 'stdout') stdout += String(bytes); else stderr += String(bytes);
    } });
    const child = children[0];
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(5_000) });
    let descendantPid: number | undefined;
    try {
      await waitForTarget(child);
      const ready = object(JSON.parse(stdout.trim()));
      assert.equal(typeof ready.descendantPid, 'number');
      if (typeof ready.descendantPid === 'number') descendantPid = ready.descendantPid;
      if (mode !== 'shutdown') await exited;

      // When / Then
      if (mode === 'escaped') {
        await assert.rejects(stopTargets(children), /teardown|drain|closed/i);
      } else {
        await stopTargets(children);
        assert.equal(child.stdout?.readableEnded, true);
        assert.equal(child.stderr?.readableEnded, true);
        if (mode === 'shutdown') {
          assert.match(stdout, /stdout-terminal/);
          assert.match(stderr, /stderr-terminal/);
        }
      }
    } finally {
      if (descendantPid !== undefined) {
        try { process.kill(descendantPid, 'SIGKILL'); }
        catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
        }
      }
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      child.stdout?.destroy();
      child.stderr?.destroy();
      await exited;
    }
  });
}
