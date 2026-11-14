import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { buildVerificationPlan, digest, readVerificationManifest } from '../../../../tooling/ci/local-verification.mjs';
import { collectIdentity } from '../../../../tooling/ci/verify-local.mjs';
import { generatedHintDigest } from '../../../workflow-contracts/contracts.mjs';
import { createPreflight } from '../../issue-preflight/scripts/contracts.mjs';
import { readRetroEvents } from '../../retrospective-lane/scripts/retro.mjs';
import { summarizeIntegrationMeasurements } from './generated-integration.mjs';
import { localCheckBinding } from './lane-v4.mjs';

const script = new URL('./lane-v4-cli.mjs', import.meta.url).pathname;

test('#4091 set-fact review: wrong or absent identity -> byte-identical lane', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  const input = f.review();
  for (const agent of [undefined, 'fluo-code-reviewer', 'unregistered', 'deep-high']) {
    const invalid = structuredClone(input);
    if (agent === undefined) delete invalid.reviews[0].agent;
    else invalid.reviews[0].agent = agent;
    const before = readFileSync(f.lanePath);

    f.set('review', invalid, input.head_sha, false);

    assert.deepEqual(readFileSync(f.lanePath), before);
  }
});

test('#4091 record: new successful child stages require assigned identities before lane write', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  const review = f.review();
  const record = (phase, result, ok = true) => f.cli('record', [...f.common,
    '--phase', phase, '--result-json', JSON.stringify(result)], ok);
  for (const [phase, agent] of [
    ['preflight', 'fluo-issue-preflight'], ['implement', 'fluo-issue-implementer'],
    ['fix-back', 'fluo-issue-implementer'],
  ]) {
    for (const substitute of [undefined, 'unregistered', 'deep-high', 'fluo-code-reviewer']) {
      const before = readFileSync(f.lanePath);

      record(phase, { ok: true, ...(substitute ? { agent: substitute } : {}) }, false);

      assert.deepEqual(readFileSync(f.lanePath), before);
    }
    const beforeCategory = readFileSync(f.lanePath);
    record(phase, { ok: true, agent, category: 'deep-high' }, false);
    assert.deepEqual(readFileSync(f.lanePath), beforeCategory);
    record(phase, { ok: true, agent });
    assert.equal(JSON.parse(readFileSync(f.lanePath)).issues['42'].attempts[phase], 0);
  }
  const before = readFileSync(f.lanePath);
  record('review', { ok: true }, false);
  assert.deepEqual(readFileSync(f.lanePath), before);
  record('review', { ok: true, ...review });
  const invalid = structuredClone(review);
  invalid.reviews[0].agent = 'fluo-code-reviewer';
  const reviewed = readFileSync(f.lanePath);
  record('review', { ok: true, ...invalid }, false);
  assert.deepEqual(readFileSync(f.lanePath), reviewed);
});

test('#4091 record: unavailable assigned target -> input-preparation block without implementation retry', (t) => {
  const f = fixture(t);
  const result = { ok: false, error: { kind: 'input-preparation', code: 'dispatch-target-unavailable',
    subagent_type: 'fluo-issue-preflight', fix_back_eligible: false } };

  f.cli('record', [...f.common, '--phase', 'preflight', '--result-json', JSON.stringify(result)]);

  const stored = JSON.parse(readFileSync(f.lanePath)).issues['42'];
  assert.equal(stored.blocker.type, 'input-preparation');
  assert.equal(stored.blocker.fix_back_eligible, false);
  assert.equal(stored.blocker.phase, 'preflight');
  assert.deepEqual(stored.attempts, {});
  assert.equal(f.plan().decision.reason, 'input-preparation');
});

test('#4091 record: removed registration -> typed preparation rejection and unchanged lane', (t) => {
  const f = fixture(t);
  const configPath = join(f.root, '.omo/omo.jsonc');
  const config = JSON.parse(readFileSync(configPath));
  delete config.agents['fluo-issue-preflight'];
  writeFileSync(configPath, JSON.stringify(config));
  const before = readFileSync(f.lanePath);

  const result = f.cli('record', [...f.common, '--phase', 'preflight', '--result-json',
    JSON.stringify({ ok: true, agent: 'fluo-issue-preflight' })], false);

  const error = JSON.parse(result.stderr);
  assert.equal(error.kind, 'input-preparation');
  assert.equal(error.code, 'dispatch-target-unavailable');
  assert.equal(error.fix_back_eligible, false);
  assert.deepEqual(readFileSync(f.lanePath), before);
});

test('#4091 registration JSONC: comments, trailing commas and URL strings -> record and review admission', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  const input = f.review();
  const path = join(f.root, '.omo/omo.jsonc');
  const { agents } = JSON.parse(readFileSync(path));
  writeFileSync(path, `// registered stage agents
{ /* operator note */
  "routes": ["https://example.test//model/*prompt*/",],
  "agents": ${JSON.stringify(agents)},
}`);

  f.cli('record', [...f.common, '--phase', 'preflight', '--result-json',
    JSON.stringify({ ok: true, agent: 'fluo-issue-preflight' })]);
  f.set('review', input, input.head_sha);

  const stored = JSON.parse(readFileSync(f.lanePath)).issues['42'];
  assert.equal(stored.attempts.preflight, 0);
  assert.equal(stored.facts.review.value.verdict, 'pass');
});

for (const defect of ['missing', 'broken']) {
  test(`#4091 registration unreadable: ${defect} config -> typed block and unchanged lane bytes`, (t) => {
    const f = fixture(t);
    f.set('preflight', f.preflight());
    f.implement();
    const input = f.review();
    const path = join(f.root, '.omo/omo.jsonc');
    if (defect === 'missing') rmSync(path);
    else writeFileSync(path, '{"agents":');
    const before = readFileSync(f.lanePath);
    const commands = [
      ['record', [...f.common, '--phase', 'preflight', '--result-json',
        JSON.stringify({ ok: true, agent: 'fluo-issue-preflight' })]],
      ['set-fact', [...f.common, '--kind', 'review', '--head', input.head_sha, '--value', JSON.stringify(input)]],
    ];

    for (const [command, args] of commands) {
      const result = f.cli(command, args, false);

      const block = JSON.parse(result.stderr);
      assert.equal(block.kind, 'input-preparation');
      assert.equal(block.code, 'dispatch-registration-unreadable');
      assert.equal(block.fix_back_eligible, false);
      assert.deepEqual(readFileSync(f.lanePath), before);
    }
  });
}

for (const [defect, content, code] of [
  ['missing', null, 'dispatch-registration-unreadable'],
  ['broken', '{"agents":', 'dispatch-registration-unreadable'],
  ['invalid-shape', '[]', 'dispatch-registration-unreadable'],
  ['unregistered', '{"agents":{}}', 'dispatch-target-unavailable'],
]) {
  test(`#4091 terminal observation: ${defect} registration -> typed block for retrospective outputs`, (t) => {
    const f = fixture(t);
    f.state.issue.state = 'CLOSED';
    f.update();
    const path = join(f.root, '.omo/omo.jsonc');
    if (content === null) rmSync(path);
    else writeFileSync(path, content);
    const before = readFileSync(f.lanePath);
    const commands = [
      ['watch', ['--once']], ['plan-all', ['--with-retro']], ['retro-plan', []], ['retro-evidence', []],
    ];

    for (const [command, extra] of commands) {
      const result = f.cli(command, [...f.common, ...extra], false);

      const block = JSON.parse(result.stderr);
      assert.equal(result.status, 1);
      assert.equal(block.status, 'blocked');
      assert.equal(block.kind, 'input-preparation');
      assert.equal(block.code, code);
      assert.equal(block.fix_back_eligible, false);
      assert.deepEqual(readFileSync(f.lanePath), before);
    }
  });
}

test('#4091 observations: unreadable registration during active work -> plan, plan-all and watch remain usable', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, '.omo/omo.jsonc'), '{"agents":');
  const before = readFileSync(f.lanePath);

  const planned = f.plan();
  const all = JSON.parse(f.cli('plan-all', ['--lane', f.lanePath]).stdout);
  const watched = f.cli('watch', ['--lane', f.lanePath, '--once']);

  assert.equal(planned.decision.action, 'preflight');
  assert.deepEqual(planned.decision.dispatch, { subagent_type: 'fluo-issue-preflight' });
  assert.deepEqual(all, [{ issue: 42, decision: planned.decision }]);
  assert.equal(watched.status, 0);
  assert.equal(watched.stderr, '');
  assert.deepEqual(readFileSync(f.lanePath), before);
});

test('gh pager: readiness and actual observation close -> final run attempt collection without key input', async (t) => {
  const value = fixture(t);
  value.implement();
  const head = value.git(value.worktree, 'rev-parse', 'HEAD');
  const run = { id: 101, run_attempt: 2, head_sha: head, path: '.github/workflows/ci.yml',
    status: 'completed', conclusion: 'success', created_at: '2026-10-13T01:00:00Z',
    run_started_at: '2026-10-13T01:02:00Z', html_url: 'https://github.com/fluojs/fluo/actions/runs/101' };
  const closePath = join(value.root, 'gh-close.log');
  const bin = join(value.root, 'bin/gh');
  writeFileSync(bin, `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
const args = process.argv.slice(2), kind = args[0] + ':' + (args[1] ?? '');
const log = ${JSON.stringify(closePath)};
process.on('exit', () => appendFileSync(log, kind + '\\n'));
const run = ${JSON.stringify(run)};
let output;
if (args[0] === 'pr') output = { number: 77, state: 'MERGED', headRefOid: run.head_sha,
  mergeCommit: { oid: run.head_sha }, mergedAt: '2026-10-13T01:05:00Z', mergeable: 'MERGEABLE', statusCheckRollup: [] };
else if (args[0] === 'issue') output = { state: 'CLOSED', title: 'fixture', body: '' };
else if (args.at(-1).includes('/actions/runs?')) {
  if (!existsSync(log) || !readFileSync(log, 'utf8').includes('pr:view')) process.exit(8);
  output = [{ total_count: 1, workflow_runs: [run] }];
} else if (args.at(-1).endsWith('/attempts/1')) output = { ...run, run_attempt: 1, conclusion: 'failure' };
else {
  const attempt = args.at(-1).includes('/attempts/1/') ? 1 : 2;
  output = [{ total_count: 1, jobs: [{ id: 200 + attempt, run_id: run.id, run_attempt: attempt,
    name: 'Verify', status: 'completed', conclusion: attempt === 1 ? 'failure' : 'success',
    started_at: '2026-10-13T01:02:00Z', completed_at: '2026-10-13T01:04:00Z' }] }];
}
const socket = connect(Number(process.env.GH_READY_PORT), '127.0.0.1');
socket.on('connect', () => socket.write(JSON.stringify({ kind, pager: process.env.GH_PAGER }) + '\\n'));
socket.on('data', () => {
  if (process.env.GH_PAGER !== 'cat') { socket.end(() => process.exit(9)); return; }
  socket.end(() => { process.stdout.write(JSON.stringify(output)); });
});
`);
  const ready = [];
  const sockets = [];
  const closures = [];
  const timeout = AbortSignal.timeout(10_000);
  const server = createServer((socket) => {
    sockets.push(socket);
    closures.push(once(socket, 'close', { signal: timeout }));
    let pending = '';
    socket.on('data', (chunk) => {
      pending += chunk;
      if (!pending.endsWith('\n')) return;
      ready.push(JSON.parse(pending));
      socket.write('release\n');
    });
  });
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  const listening = once(server, 'listening', { signal: timeout });
  server.listen(0, '127.0.0.1');
  await listening;
  const driver = `
    const { execFileSync } = require('node:child_process');
    const common = ${JSON.stringify(['--root', value.root, '--lane', value.lanePath, '--issue', '42'])};
    execFileSync(process.execPath, [${JSON.stringify(script)}, 'plan', ...common]);
    execFileSync(process.execPath, [${JSON.stringify(script)}, 'retro-ci', ...common]);
  `;
  const child = spawn(process.execPath, ['-e', driver], {
    env: { ...value.env, GH_PAGER: 'less', GH_READY_PORT: String(server.address().port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGKILL'));
  const closed = once(child, 'close', { signal: timeout });
  let stderr = '';
  child.stdout.resume();
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const [exit, signal] = await closed;
  await Promise.all(closures);

  assert.equal(exit, 0, stderr);
  assert.equal(signal, null);
  assert.ok(ready.length >= 5);
  assert.ok(ready.every((event) => event.pager === 'cat'));
  const closes = readFileSync(closePath, 'utf8').trim().split('\n');
  assert.equal(closes[0], 'pr:view');
  assert.ok(closes.includes('api:--paginate'));
  const events = readRetroEvents(value.root, 'fixture');
  assert.ok(events.some((event) => event.data.run?.head === head
    && event.data.run.attempt === 2 && event.data.complete === true && event.data.conclusion === 'success'));
  assert.ok(events.some((event) => event.data.job?.conclusion === 'failure'));
});
const fixture = (t, isolatedOrchestrator = false, parent = process.env.FLUO_PRODUCT_TEST_EVIDENCE ?? tmpdir()) => {
  mkdirSync(parent, { recursive: true });
  const root = realpathSync(mkdtempSync(join(parent, 'fluo-lane-v4-')));
  if (!process.env.FLUO_PRODUCT_TEST_EVIDENCE) t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  mkdirSync(join(root, '.omo'));
  cpSync(new URL('../../../../.omo/omo.jsonc', import.meta.url), join(root, '.omo/omo.jsonc'));
  const ghState = join(root, 'gh.json');
  const ghLog = join(root, 'gh.log');
  const state = { issue: { state: 'OPEN', title: 'Document route precedence', body: 'Keep route precedence stable.' }, pr: null };
  const update = () => writeFileSync(ghState, JSON.stringify(state));
  update();
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}\nimport { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.GH_LOG, JSON.stringify(args) + '\\n');
const state = JSON.parse(readFileSync(process.env.GH_STATE));
const subject = args[0] === 'issue' && args[2] !== '42' ? args[2] : args[0];
if (state.unavailable || state.fail === subject) process.exit(1);
if (state.malformed === subject) { process.stdout.write('{}'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'view') {
  const pr = Object.hasOwn(state.prs ?? {}, args[2]) ? state.prs[args[2]] : state.pr;
  if (!pr) { process.stderr.write('no pull requests found for branch "' + args[2] + '"'); process.exit(1); }
  process.stdout.write(JSON.stringify(pr));
} else if (args[0] === 'issue' && args[1] === 'view') {
  process.stdout.write(args.includes('--jq') ? state.issue.state : JSON.stringify(state.issue));
} else { process.stderr.write('unexpected gh invocation'); process.exit(2); }
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_STATE: ghState, GH_LOG: ghLog,
    GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }).trim();
  git(root, 'init', '-b', 'main');
  writeFileSync(join(root, '.gitignore'), 'bin/\ngh.json\ngh.log\n.omo/\n.worktrees/\n');
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs/guide.md'), 'base\n');
  for (const file of ['tooling/ci/verify-local.mjs', 'tooling/ci/local-verification.mjs',
    'tooling/ci/verification-runner.mjs', 'tooling/ci/verification-environment.mjs',
    'tooling/ci/environment.lock.json', 'tooling/ci/Dockerfile',
    'tooling/ci/local-verification-receipt.schema.json', '.agents/workflow-contracts/schema-validator.mjs']) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(new URL(`../../../../${file}`, import.meta.url), join(root, file));
  }
  cpSync(new URL('../../../../tooling/ci/local-verification-manifest.json', import.meta.url),
    join(root, 'tooling/ci/local-verification-manifest.json'));
  if (isolatedOrchestrator) {
    cpSync(new URL('../../../', import.meta.url), join(root, '.agents'), { recursive: true });
    cpSync(new URL('../../../../tooling/ci/', import.meta.url), join(root, 'tooling/ci'), { recursive: true });
  }
  git(root, 'add', '.');
  git(root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture base');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const cli = (command, args = [], ok = true) => {
    const result = spawnSync(process.execPath, [isolatedOrchestrator
      ? join(root, '.agents/skills/execute-lane/scripts/lane-v4-cli.mjs') : script,
    command, '--root', root, ...args], { env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.error, undefined);
    if (ok) assert.equal(result.status, 0, result.stderr);
    else assert.notEqual(result.status, 0, result.stdout);
    return result;
  };
  const lanePath = cli('init', ['--lane-id', 'fixture', '--issue', '42']).stdout.trim();
  const common = ['--lane', lanePath, '--issue', '42'];
  const plan = () => JSON.parse(cli('plan', common).stdout);
  const set = (kind, value, head, ok = true) => cli('set-fact', [...common, '--kind', kind, '--value', JSON.stringify(value), ...(head ? ['--head', head] : [])], ok);
  const preflight = (patch = {}) => {
    const { obs } = plan();
    return createPreflight({ issue: 42, issue_sha256: obs.issueSha256, base_sha: obs.baseSha,
      scope: ['docs/', 'src/', 'tests/'], non_scope: ['docs/private/'],
      acceptance: ['Retain route precedence'], validation: ['node --test'], predicted_files: ['docs/guide.md'], ...patch });
  };
  const worktree = join(root, '.worktrees/issue-42');
  const implement = () => {
    git(root, 'worktree', 'add', '-b', 'issue-42', worktree, 'main');
    commit('docs/guide.md', 'implemented\n');
  };
  const commit = (file, bytes) => {
    mkdirSync(dirname(join(worktree, file)), { recursive: true });
    writeFileSync(join(worktree, file), bytes);
    git(worktree, 'add', '-A');
    git(worktree, '-c', 'commit.gpgsign=false', 'commit', '-m', `fixture ${file}`);
  };
  const review = () => {
    const { obs } = plan();
    return { head_sha: obs.headSha, preflight_sha256: obs.preflightPolicy.sha256, active_axes: obs.preflightPolicy.active_axes,
      reviews: obs.preflightPolicy.active_axes.map((reviewer) => ({ reviewer, agent: `fluo-${reviewer}-reviewer`, reviewed_head_sha: obs.headSha,
        preflight_sha256: obs.preflightPolicy.sha256, verdict_signal: 'PASS', blockers: [] })) };
  };
  const verify = (ok = true, forceFull = false) => {
    const entry = JSON.parse(readFileSync(lanePath, 'utf8')).issues['42'];
    const base = entry.facts.preflight.value.base_sha;
    // This fixture exercises lane receipt admission, not real execution.
    // Docker-backed command execution is covered by verification-runner.docker-test.mjs.
    const identity = collectIdentity(worktree, base);
    const plan = buildVerificationPlan({ changedFiles: identity.changedFiles, identity, forceFull, root: worktree,
      manifest: readVerificationManifest(join(worktree, 'tooling/ci/local-verification-manifest.json')) });
    const lock = plan.environment.lock;
    const actual = {
      os: 'linux', arch: 'arm64',
      node: Object.fromEntries(Object.entries(lock.node).map(([key, item]) => [key, item.version])),
      bun: Object.fromEntries(Object.entries(lock.bun).map(([key, item]) => [key, item.version])),
      pnpm: lock.pnpm.version, browser: { channel: lock.browser.channel, version: lock.browser.version, launched: true },
      docker: { reachable: true, version: lock.docker.version, cliVersion: lock.docker.version },
      redis: { ping: 'PONG', image: lock.redis.image }, watch: { linuxVolume: true, event: 'rename' },
    };
    const planDigest = plan.semanticDigest;
    const evidenceRoot = join(worktree, '.omo/verification/lane-test');
    const resultRoot = join(evidenceRoot, 'results');
    mkdirSync(resultRoot, { recursive: true });
    const artifactRoot = join(evidenceRoot, 'artifacts');
    mkdirSync(artifactRoot, { recursive: true });
    const taskResults = plan.tasks.map((task) => ({
      version: 2, taskId: task.id, status: ok ? 'passed' : 'failed',
      headSha: identity.headSha, treeSha: identity.treeSha, planDigest,
      imageKey: plan.environment.imageKey, imageId: `sha256:${'1'.repeat(64)}`,
      environment: actual, artifacts: task.outputs.map((name) => {
        const path = name === 'docs-site' ? `${name}/server.js` : name;
        const bytes = `${task.id}:${name}`;
        mkdirSync(dirname(join(artifactRoot, path)), { recursive: true });
        writeFileSync(join(artifactRoot, path), bytes);
        return { path, digest: digest(bytes), size: Buffer.byteLength(bytes) };
      }),
      logs: task.commands.map((_, index) => ({ commandIndex: index,
        path: `${task.id}-${index}.log`, digest: digest(`${task.id}-${index}`) })),
      commands: task.commands.map((command) => ({ command,
        exitCode: ok ? 0 : 1, signal: null, spawnError: null,
        identityBefore: { headSha: identity.headSha, treeSha: identity.treeSha, statusDigest: digest('') },
        identityAfter: { headSha: identity.headSha, treeSha: identity.treeSha, statusDigest: digest('') } })),
    }));
    const logs = [];
    for (const result of taskResults) {
      for (const log of result.logs) {
        const path = join(resultRoot, log.path);
        writeFileSync(path, `${result.taskId}-${log.commandIndex}`);
        logs.push({ path: relative(worktree, path), digest: log.digest });
      }
      const path = join(resultRoot, `${result.taskId}.json`);
      writeFileSync(path, `${JSON.stringify(result)}\n`);
      logs.push({ path: relative(worktree, path), digest: digest(readFileSync(path)) });
    }
    const hostChecks = {
      status: ok ? 'passed' : 'failed', planDigest, headSha: identity.headSha, treeSha: identity.treeSha,
      commands: plan.hostChecks.map((command) => ({ command, exitCode: ok ? 0 : 1, signal: null, spawnError: null })),
      logs: plan.hostChecks.map((_, index) => ({ path: `host-check-${index}.log`, digest: digest('host integration') })),
    };
    for (const log of hostChecks.logs) {
      const path = join(resultRoot, log.path);
      writeFileSync(path, 'host integration');
      logs.push({ path: relative(worktree, path), digest: log.digest });
    }
    const hostResultPath = join(resultRoot, 'host-checks.json');
    writeFileSync(hostResultPath, `${JSON.stringify(hostChecks)}\n`);
    logs.push({ path: relative(worktree, hostResultPath), digest: digest(readFileSync(hostResultPath)) });
    const receipt = {
      version: 2, status: ok ? 'passed' : 'failed', profile: 'pr', forceFull, identity,
      source: plan.source, environment: { lock, imageKey: plan.environment.imageKey },
      imageIdentity: { key: plan.environment.imageKey, id: `sha256:${'1'.repeat(64)}` },
      environmentLockDigest: plan.environment.lockDigest,
      manifestDigest: plan.manifestDigest, planDigest, hostChecks, taskResults,
      capabilityTasks: plan.capabilityTasks, logs,
      artifacts: taskResults.flatMap((result) => result.artifacts.map((file) => ({
        path: relative(worktree, join(artifactRoot, file.path)), digest: file.digest,
      }))),
      startedAt: entry.facts.review?.accepted_at
        ? new Date(Date.parse(entry.facts.review.accepted_at) + 1000).toISOString()
        : new Date().toISOString(),
      completedAt: entry.facts.review?.accepted_at
        ? new Date(Date.parse(entry.facts.review.accepted_at) + 2000).toISOString()
        : new Date().toISOString(),
    };
    const path = join(worktree, '.omo/verification/receipt.json');
    writeFileSync(path, `${JSON.stringify(receipt)}\n`);
    const bytes = readFileSync(path);
    return { status: receipt.status, valid: ok, receiptPath: relative(worktree, path),
      receiptSha256: createHash('sha256').update(bytes).digest('hex') };
  };
  return { root, worktree, state, update, git, cli, plan, set, preflight, implement, commit, review, verify, lanePath, common, ghLog, env };
};

const importedAdaptive = {
  retry_count_is_terminal: false, max_same_failure_repeats: null,
  max_wall_clock_minutes: null, stop_on_child_contract_error: true,
};

for (const phase of ['resolve-conflict', 'verify-local']) {
  test(`record policy: ${phase} child contract error -> persisted blocker and retro before stage admission`, (t) => {
    const f = fixture(t);
    f.set('preflight', f.preflight());
    f.implement();
    const lane = JSON.parse(readFileSync(f.lanePath));
    lane.retry_policy = importedAdaptive;
    writeFileSync(f.lanePath, JSON.stringify(lane));
    const before = readFileSync(f.lanePath);
    const ordinary = { ok: phase === 'resolve-conflict' };
    const record = (result, ok = true) => f.cli('record', [...f.common,
      '--phase', phase, '--result-json', JSON.stringify(result)], ok);
    record(ordinary, false);
    assert.deepEqual(readFileSync(f.lanePath), before);
    const result = { ...ordinary, error: { type: 'child-contract-error' } };

    record(result);

    const entry = JSON.parse(readFileSync(f.lanePath)).issues['42'];
    const blocker = { type: 'child-contract-error', phase };
    assert.equal(entry.attempts[phase], 1);
    assert.deepEqual(entry.blocker, blocker);
    assert.deepEqual(entry.facts, lane.issues['42'].facts);
    assert.deepEqual(f.plan().decision, { action: 'blocked', reason: blocker.type, blocker });
    const events = readRetroEvents(f.root, 'fixture').filter(event => event.kind === 'stage');
    assert.equal(events.length, 1);
    assert.equal(events[0].data.phase, phase);
    assert.deepEqual(events[0].data.result, result);
    const blockedBytes = readFileSync(f.lanePath);
    record(ordinary, false);
    assert.deepEqual(readFileSync(f.lanePath), blockedBytes);
    assert.equal(readRetroEvents(f.root, 'fixture').filter(event => event.kind === 'stage').length, 1);
  });
}

test('record policy: stored null -> legacy failure count and blocker at three without migration', (t) => {
  const f = fixture(t);
  const lane = JSON.parse(readFileSync(f.lanePath));
  lane.retry_policy = null;
  writeFileSync(f.lanePath, JSON.stringify(lane));

  for (let attempt = 1; attempt <= 3; attempt++) {
    f.cli('record', [...f.common, '--phase', 'implement', '--result-json', '{"ok":false}']);
    const stored = JSON.parse(readFileSync(f.lanePath));
    assert.equal(stored.retry_policy, null);
    assert.equal(stored.issues['42'].attempts.implement, attempt);
    assert.deepEqual(stored.issues['42'].blocker,
      attempt === 3 ? { type: 'attempts-exhausted', phase: 'implement' } : null);
  }

  assert.equal(f.plan().decision.action, 'blocked');
});

test('observation: null PR rollup entry -> typed failure for plan, plan-all and watch', (t) => {
  const f = fixture(t);
  f.state.pr = { number: 77, state: 'OPEN', headRefOid: 'a'.repeat(40),
    mergeable: 'MERGEABLE', statusCheckRollup: [null] };
  f.update();
  const before = readFileSync(f.lanePath);

  const single = f.plan().decision;
  const all = JSON.parse(f.cli('plan-all', ['--lane', f.lanePath]).stdout)[0].decision;
  const watch = f.cli('watch', ['--lane', f.lanePath, '--once']).stdout;

  assert.deepEqual(single, { action: 'observation-failed',
    failures: [{ source: 'pr', subject: 'issue-42', code: 'invalid-response' }] });
  assert.deepEqual(all, single);
  assert.match(watch, /-> observation-failed/u);
  assert.deepEqual(readFileSync(f.lanePath), before);
});

for (const [name, retry_policy] of Object.entries({
  'missing limits': { retry_count_is_terminal: true, stop_on_child_contract_error: true },
  'unknown key': { ...importedAdaptive, bogus: 1 },
  'tampered stop': { ...importedAdaptive, stop_on_child_contract_error: false },
  'nonboolean terminal': { ...importedAdaptive, retry_count_is_terminal: 'false' },
  'zero limit': { ...importedAdaptive, max_same_failure_repeats: 0, max_wall_clock_minutes: 1 },
  'fractional limit': { ...importedAdaptive, max_same_failure_repeats: 1, max_wall_clock_minutes: 1.5 },
  'mixed limits': { ...importedAdaptive, max_same_failure_repeats: 2 },
  'terminal null limits': { ...importedAdaptive, retry_count_is_terminal: true },
})) {
  test(`retry policy import: ${name} -> TypeError and no execution lane created`, (t) => {
    const f = fixture(t);
    const before = readFileSync(f.lanePath);
    const ledger = join(f.root, 'retry-policy.json');
    writeFileSync(ledger, JSON.stringify({
      version: 2, lane_id: 'retry-policy', confirmed_issues: [42], retry_policy,
    }));

    const result = f.cli('init', ['--from-lane-v2', ledger], false);

    assert.match(result.stderr, /TypeError: retry_policy/u);
    assert.equal(existsSync(join(f.root, '.omo/lanes-v4/retry-policy.json')), false);
    assert.deepEqual(readFileSync(f.lanePath), before);
  });
}

for (const [name, retry_policy] of Object.entries({
  adaptive: importedAdaptive,
  'adaptive numeric': { ...importedAdaptive, max_same_failure_repeats: 2, max_wall_clock_minutes: 60 },
  bounded: { ...importedAdaptive, retry_count_is_terminal: true, max_same_failure_repeats: 2, max_wall_clock_minutes: 60 },
})) {
  test(`retry policy import: valid ${name} -> preserved policy and correct second-failure decision`, (t) => {
    const f = fixture(t);
    const ledger = join(f.root, 'retry-policy.json');
    writeFileSync(ledger, JSON.stringify({
      version: 2, lane_id: 'retry-policy', confirmed_issues: [42], retry_policy,
    }));

    const lanePath = f.cli('init', ['--from-lane-v2', ledger]).stdout.trim();
    const record = () => f.cli('record', ['--lane', lanePath, '--issue', '42',
      '--phase', 'implement', '--result-json', '{"ok":false,"error":"same"}']);
    record();
    assert.equal(JSON.parse(readFileSync(lanePath)).issues['42'].blocker, null);
    record();

    const lane = JSON.parse(readFileSync(lanePath));
    assert.deepEqual(lane.retry_policy, retry_policy);
    assert.equal(Object.hasOwn(lane, 'preflight_overlap'), false, 'legacy v2 imports stay legacy after saves');
    assert.equal(lane.issues['42'].attempts.implement, 2);
    assert.deepEqual(lane.issues['42'].blocker, retry_policy.retry_count_is_terminal
      ? { type: 'attempts-exhausted', phase: 'implement' } : null);
  });
}

const heldWriter = async (t) => {
  const f = fixture(t);
  const signal = AbortSignal.timeout(20_000);
  const sockets = [];
  const server = createServer(socket => {
    sockets.push(socket);
    socket.once('data', data => server.emit('holder-ready', socket, data.toString()));
  });
  const ready = once(server, 'holder-ready', { signal });
  const listening = once(server, 'listening', { signal });
  server.listen(0, '127.0.0.1');
  await listening;
  writeFileSync(join(f.root, 'bin/gh'), `#!${process.execPath}
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'pr') {
  const socket = connect(Number(process.env.HOLDER_PORT), '127.0.0.1');
  socket.on('connect', () => socket.write('locked\\n'));
  socket.on('data', () => {
    process.stderr.write('no pull requests found for branch "' + args[2] + '"');
    process.exitCode = 1;
    socket.end();
  });
  socket.on('close', () => process.exit(process.exitCode ?? 0));
} else process.stdout.write(JSON.stringify(JSON.parse(readFileSync(process.env.GH_STATE)).issue));
`);
  const child = spawn(process.execPath, [script, 'record', '--root', f.root, ...f.common,
    '--phase', 'implement', '--result-json', '{"ok":false}'], {
    env: { ...f.env, HOLDER_PORT: String(server.address().port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stdout.resume();
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = once(child, 'close', { signal });
  t.after(() => {
    child.kill('SIGKILL');
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  const [socket, message] = await ready;
  assert.equal(message, 'locked\n');
  return { f, child, closed, socket, stderr: () => stderr };
};

test('lock: SIGKILL after acquisition -> later separate process recovers and commits state', async (t) => {
  const holder = await heldWriter(t);
  holder.child.kill('SIGKILL');
  holder.socket.destroy();
  const [code, signal] = await holder.closed;
  assert.equal(code, null);
  assert.equal(signal, 'SIGKILL');

  holder.f.cli('approve-merge', holder.f.common);

  assert.equal(JSON.parse(readFileSync(holder.f.lanePath)).issues['42'].approvals.merge, true);
});

test('lock: live separate holder -> contender cannot replace it or mutate state', async (t) => {
  const holder = await heldWriter(t);
  const before = readFileSync(holder.f.lanePath);

  const contender = spawnSync(process.execPath,
    [script, 'approve-merge', '--root', holder.f.root, ...holder.f.common],
    { env: holder.f.env, encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL' });

  assert.equal(contender.error?.code, 'ETIMEDOUT');
  assert.equal(contender.signal, 'SIGKILL');
  assert.deepEqual(readFileSync(holder.f.lanePath), before);
  assert.equal(holder.child.exitCode, null);
  assert.equal(holder.child.signalCode, null);
  holder.socket.write('release\n');
  const [code, signal] = await holder.closed;
  assert.equal(code, 0, holder.stderr());
  assert.equal(signal, null);
  holder.f.cli('approve-merge', holder.f.common);
  assert.equal(JSON.parse(readFileSync(holder.f.lanePath)).issues['42'].approvals.merge, true);
});

test('clear-blocker: repeated exhaustion and reset -> each clear remains a distinct retro event', (t) => {
  const f = fixture(t);
  for (let cycle = 0; cycle < 2; cycle++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      f.cli('record', [...f.common, '--phase', 'implement', '--result-json', '{"ok":false}']);
    }
    assert.deepEqual(JSON.parse(readFileSync(f.lanePath)).issues['42'].blocker,
      { type: 'attempts-exhausted', phase: 'implement' });
    f.cli('clear-blocker', [...f.common, '--phase', 'implement']);
  }

  const events = readRetroEvents(f.root, 'fixture').filter(event => event.data?.action === 'clear-blocker');

  assert.equal(events.length, 2);
  assert.notEqual(events[0].eventId, events[1].eventId);
  assert.notEqual(events[0].data.operation_id, events[1].data.operation_id);
  for (const event of events) {
    assert.equal(typeof event.data.operation_id, 'string');
    assert.equal(event.data.phase, 'implement');
    assert.deepEqual(event.data.blocker, { type: 'attempts-exhausted', phase: 'implement' });
  }
  assert.equal(JSON.parse(readFileSync(f.lanePath)).issues['42'].attempts.implement, 0);
});

test('init: existing manual or imported lane -> reject and preserve all bytes', (t) => {
  const f = fixture(t);
  const lane = JSON.parse(readFileSync(f.lanePath));
  Object.assign(lane.issues['42'], { facts: { sentinel: { value: 1 } },
    attempts: { review: 2 }, approvals: { merge: true }, blocker: { type: 'policy', phase: 'review' } });
  writeFileSync(f.lanePath, JSON.stringify(lane));
  const original = readFileSync(f.lanePath);
  const ledger = join(f.root, 'ledger.json');
  writeFileSync(ledger, JSON.stringify({ version: 2, lane_id: 'fixture', confirmed_issues: [42] }));

  for (const args of [['--lane-id', 'fixture', '--issue', '42'], ['--from-lane-v2', ledger]]) {
    const result = f.cli('init', args, false);
    assert.equal(result.status, 1);
    assert.deepEqual(readFileSync(f.lanePath), original);
  }
});

for (const source of ['pr', 'issue', '43']) {
  for (const defect of ['fail', 'malformed']) {
    test(`observation: ${defect} ${source} -> plan, plan-all and watch fail closed`, (t) => {
      const f = fixture(t);
      f.set('preflight', f.preflight());
      f.implement();
      const review = f.review();
      f.set('review', review, review.head_sha);
      const lane = JSON.parse(readFileSync(f.lanePath));
      lane.issues['42'].depends_on = [43];
      writeFileSync(f.lanePath, JSON.stringify(lane));
      const original = readFileSync(f.lanePath);
      f.state[defect] = source;
      f.update();

      const single = f.plan().decision;
      const all = JSON.parse(f.cli('plan-all', ['--lane', f.lanePath]).stdout)[0].decision;
      const watch = f.cli('watch', ['--lane', f.lanePath, '--once']).stdout;

      assert.equal(single.action, 'observation-failed');
      assert.deepEqual(single, all);
      assert.deepEqual(single.failures, [{ source: source === '43' ? 'dependency' : source,
        subject: source === 'pr' ? 'issue-42' : Number(source === 'issue' ? 42 : source),
        code: defect === 'fail' ? 'command-failed' : 'invalid-response' }]);
      assert.match(watch, /-> observation-failed/u);
      assert.deepEqual(readFileSync(f.lanePath), original);
    });
  }
}

test('clear-blocker: matching phase -> reset only target and retain observable retro incident', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  const lane = JSON.parse(readFileSync(f.lanePath));
  lane.issues['43'] = { ...structuredClone(lane.issues['42']), issue: 43, branch: 'issue-43' };
  Object.assign(lane.issues['42'], {
    blocker: { type: 'attempts-exhausted', phase: 'implement' },
    attempts: { implement: 3, review: 2 },
    retry_telemetry: { implement: { elapsed_ms: 123 }, review: { elapsed_ms: 456 } },
  });
  writeFileSync(f.lanePath, JSON.stringify(lane));
  const original = readFileSync(f.lanePath);
  f.cli('clear-blocker', [...f.common, '--phase', 'review'], false);
  assert.deepEqual(readFileSync(f.lanePath), original);

  f.cli('clear-blocker', [...f.common, '--phase', 'implement']);

  const after = JSON.parse(readFileSync(f.lanePath));
  const expected = structuredClone(lane);
  expected.issues['42'].blocker = null;
  expected.issues['42'].attempts.implement = 0;
  delete expected.issues['42'].retry_telemetry.implement;
  assert.deepEqual(after, expected);
  assert.equal(f.plan().decision.action, 'implement');
  const events = readRetroEvents(f.root, 'fixture').filter(event => event.data?.action === 'clear-blocker');
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'incident');
  assert.deepEqual(events[0].data.blocker, lane.issues['42'].blocker);
  assert.equal(events[0].data.phase, 'implement');
});

test('concurrent CLI: separate record and set-fact writers -> complete JSON and no lost updates', async (t) => {
  const f = fixture(t);
  const preflight = f.preflight();
  const lane = JSON.parse(readFileSync(f.lanePath));
  lane.retry_policy = { retry_count_is_terminal: false, max_same_failure_repeats: null,
    max_wall_clock_minutes: null, stop_on_child_contract_error: true };
  lane.issues['43'] = { ...structuredClone(lane.issues['42']), issue: 43, branch: 'issue-43' };
  lane.issues['42'].facts.padding = { value: 'x'.repeat(1_000_000) };
  writeFileSync(f.lanePath, JSON.stringify(lane));
  const preflight43 = createPreflight({ ...preflight, issue: 43 });
  const commands = [
    ['set-fact', '--issue', '42', '--kind', 'preflight', '--value', JSON.stringify(preflight)],
    ['set-fact', '--issue', '43', '--kind', 'preflight', '--value', JSON.stringify(preflight43)],
    ...Array.from({ length: 6 }, (_, i) => ['record', '--issue', i % 2 ? '43' : '42',
      '--phase', 'implement', '--result-json', '{"ok":false,"error":"fixture"}']),
  ];
  const signal = AbortSignal.timeout(20_000);
  const reader = spawn(process.execPath, ['--input-type=module', '-e', `
    import { watch, readFileSync } from 'node:fs';
    import { dirname } from 'node:path';
    const path = ${JSON.stringify(f.lanePath)};
    let reads = 0;
    const watcher = watch(dirname(path), () => {
      try { JSON.parse(readFileSync(path)); reads++; }
      catch (error) { process.send({ error: error.message }); }
    });
    process.on('message', () => { watcher.close(); process.send({ reads }); process.disconnect(); });
    process.send({ ready: true });
  `], { env: f.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => reader.kill('SIGKILL'));
  const readerClosed = once(reader, 'close', { signal });
  assert.deepEqual((await once(reader, 'message', { signal }))[0], { ready: true });
  const readerMessages = [];
  reader.on('message', message => readerMessages.push(message));
  const workers = commands.map(args => {
    const worker = spawn(process.execPath, ['-e', `
      const { execFileSync } = require('node:child_process');
      process.on('message', () => {
        try { execFileSync(process.execPath, ${JSON.stringify([script, ...args, '--root', f.root, '--lane', f.lanePath])},
          { stdio: ['ignore', 'pipe', 'pipe'] }); process.disconnect(); }
        catch(error) { process.stderr.write(String(error.stderr)); process.exit(1); }
      });
      process.send('ready');
    `], { env: f.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(() => worker.kill('SIGKILL'));
    let stderr = '';
    worker.stderr.on('data', chunk => { stderr += chunk; });
    const ready = once(worker, 'message', { signal });
    const closed = once(worker, 'close', { signal }).then(([code]) => ({ code, stderr }));
    return { worker, ready, closed };
  });
  await Promise.all(workers.map(worker => worker.ready));

  for (const { worker } of workers) worker.send('go');
  const outcomes = await Promise.all(workers.map(worker => worker.closed));
  reader.send('stop');
  await readerClosed;

  for (const outcome of outcomes) assert.equal(outcome.code, 0, outcome.stderr);
  assert.deepEqual(readerMessages.filter(message => message.error), []);
  assert.ok(readerMessages.some(message => message.reads > 0));
  const after = JSON.parse(readFileSync(f.lanePath));
  for (const issue of ['42', '43']) {
    assert.equal(after.issues[issue].attempts.implement, 3);
    assert.equal(after.issues[issue].blocker, null);
    assert.equal(after.issues[issue].facts.preflight.value.issue, Number(issue));
  }
  assert.deepEqual(after.issues['42'].facts.padding, lane.issues['42'].facts.padding);
});

const baselineFixture = (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  f.commit('tests/baseline.mjs', `import { readFileSync } from 'node:fs';
if (readFileSync('docs/guide.md', 'utf8') !== 'fixed\\n') {
  process.stderr.write('confirmed docs baseline mismatch\\n'); process.exitCode = 1;
} else process.stdout.write('baseline passed\\n');
`);
  f.commit('tests/conditions.json', '{"runtime":"node"}\n');
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const snapshot = (cwd, path) => ({ path, sha256: hash(readFileSync(join(cwd, path))) });
  const failureHead = f.git(f.worktree, 'rev-parse', 'HEAD');
  const companion = join(f.root, '.omo/companion');
  f.git(f.root, 'worktree', 'add', '-b', 'companion', companion, failureHead);
  writeFileSync(join(companion, 'docs/guide.md'), 'fixed\n');
  f.git(companion, 'add', 'docs/guide.md');
  f.git(companion, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture companion');
  const proof = (cwd, label) => {
    const head = f.git(cwd, 'rev-parse', 'HEAD');
    const command = 'node tests/baseline.mjs';
    const sources = [snapshot(cwd, 'docs/guide.md')];
    const conditions = [snapshot(cwd, 'tests/conditions.json')];
    const test_source = snapshot(cwd, 'tests/baseline.mjs');
    const check = spawnSync(process.execPath, ['tests/baseline.mjs'], { cwd, encoding: 'utf8', timeout: 10_000 });
    assert.equal(check.error, undefined);
    const log = `${check.stdout}${check.stderr}`;
    const logPath = `.omo/${label}.log`;
    writeFileSync(join(f.root, logPath), log);
    const receipt = { version: 1, head, command, completed: true, signal: check.signal,
      status: check.status === 0 ? 'passed' : 'failed', exit_code: check.status,
      log_sha256: hash(log), source_sha256: hash(JSON.stringify({ sources, conditions, test_source })) };
    const receiptPath = `.omo/${label}.json`;
    writeFileSync(join(f.root, receiptPath), JSON.stringify(receipt));
    return { head, command, sources, conditions, test_source,
      log: snapshot(f.root, logPath), receipt: snapshot(f.root, receiptPath) };
  };
  const failure = proof(f.worktree, 'failure');
  const fixed = proof(companion, 'companion');
  const record = { version: 1, id: 'docs-baseline', issues: [42], failure, companion: fixed,
    adjudication: { authority: 'lead', cause: 'confirmed-common-baseline',
      failure_head: failure.head, companion_head: fixed.head, reason: 'Reproduced same assertion; companion preserves the test and conditions.' } };
  return { ...f, record, companion, hash };
};

test('CLI publication: admitted same baseline source -> fix-back before create-pr', (t) => {
  const f = baselineFixture(t);
  const review = f.review();
  f.set('review', review, review.head_sha);
  f.set('known-baseline', f.record);

  const { decision } = f.plan();

  assert.equal(decision.action, 'fix-back');
  assert.equal(decision.reason, 'known-baseline-still-failing');
});

test('CLI baseline admission: invalid proof -> persisted lane bytes unchanged', (t) => {
  const f = baselineFixture(t);
  const before = readFileSync(f.lanePath, 'utf8');
  for (const patch of [
    record => { record.adjudication.cause = 'UNKNOWN'; },
    record => { record.failure.log.sha256 = '0'.repeat(64); },
    record => { record.companion.head = record.failure.head; },
    record => { record.issues = [42, 99]; },
  ]) {
    const record = structuredClone(f.record);
    patch(record);

    f.set('known-baseline', record, undefined, false);

    assert.equal(readFileSync(f.lanePath, 'utf8'), before);
  }
});

test('CLI publication: fixed source and unrelated main without record -> normal create-pr', (t) => {
  const f = baselineFixture(t);
  const pinnedBase = f.plan().obs.baseSha;
  writeFileSync(join(f.root, 'unrelated.txt'), 'independent upstream change\n');
  f.git(f.root, 'add', 'unrelated.txt');
  f.git(f.root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture unrelated upstream');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  let review = f.review();
  f.set('review', review, review.head_sha);

  assert.equal(f.plan().decision.action, 'create-pr');
  assert.equal(f.plan().obs.baseSha, pinnedBase);
  assert.deepEqual(f.plan().obs.knownBaselines, []);
  f.set('known-baseline', f.record);
  f.git(f.worktree, '-c', 'commit.gpgsign=false', 'merge', '--no-ff', 'companion', '-m', 'fixture fixed source');
  review = f.review();
  f.set('review', review, review.head_sha);
  assert.equal(f.plan().obs.knownBaselines[0].status, 'fixed');
  assert.equal(f.plan().decision.action, 'create-pr');
});

test('CLI publication: companion integration -> pinned scope, fresh review, same PR and fresh CI', (t) => {
  const f = baselineFixture(t);
  f.set('known-baseline', f.record);
  const oldReview = f.review();
  f.set('review', oldReview, oldReview.head_sha);
  f.set('local-checks', f.verify(), oldReview.head_sha);
  assert.equal(f.plan().obs.localChecks.status, 'passed');
  f.state.pr = { number: 71, state: 'OPEN', headRefOid: '0'.repeat(40),
    mergeable: 'MERGEABLE', statusCheckRollup: [{ conclusion: 'SUCCESS' }] };
  f.update();
  assert.equal(f.plan().decision.reason, 'known-baseline-still-failing');
  const pinnedBase = f.plan().obs.baseSha;
  // A real Git integration changes HEAD while preserving issue identity.
  f.git(f.worktree, '-c', 'commit.gpgsign=false', 'merge', '--no-ff', 'companion', '-m', 'fixture companion integration');

  const integrated = f.plan();

  assert.equal(integrated.obs.baseSha, pinnedBase);
  assert.deepEqual(integrated.obs.changedFiles, ['docs/guide.md', 'tests/baseline.mjs', 'tests/conditions.json']);
  assert.equal(integrated.obs.review, null);
  assert.equal(integrated.obs.localChecks, null);
  assert.equal(integrated.obs.knownBaselines[0].status, 'fixed');
  assert.equal(integrated.decision.action, 'review');
  const check = spawnSync(process.execPath, ['tests/baseline.mjs'], { cwd: f.worktree, encoding: 'utf8', timeout: 10_000 });
  assert.equal(check.status, 0, check.stderr);
  const review = f.review();
  f.set('review', review, review.head_sha);
  assert.equal(f.plan().decision.action, 'push');
  assert.equal(f.plan().decision.pr, 71);
  f.state.pr.headRefOid = review.head_sha;
  f.state.pr.statusCheckRollup = [{ status: 'IN_PROGRESS' }];
  f.update();
  assert.equal(f.plan().decision.action, 'wait-ci');
  f.state.pr.statusCheckRollup = [{ conclusion: 'FAILURE' }];
  f.update();
  assert.equal(f.plan().decision.reason, 'ci-failing');
  f.state.pr.statusCheckRollup = [{ conclusion: 'SUCCESS' }];
  f.update();
  assert.equal(f.plan().decision.action, 'request-merge-approval');
  f.cli('approve-merge', f.common);
  assert.equal(f.plan().decision.action, 'merge');
});

test('CLI publication: unrelated main, unconfirmed sibling and changed conditions -> preserve narrow decisions', (t) => {
  const f = baselineFixture(t);
  const review = f.review();
  f.set('review', review, review.head_sha);
  assert.equal(f.plan().decision.action, 'create-pr');
  const lane = JSON.parse(readFileSync(f.lanePath, 'utf8'));
  lane.issues['43'] = { ...structuredClone(lane.issues['42']), issue: 43, branch: 'issue-43', facts: {} };
  writeFileSync(f.lanePath, JSON.stringify(lane));
  f.set('known-baseline', f.record);
  assert.equal(JSON.parse(readFileSync(f.lanePath)).issues['43'].facts['known-baseline'], undefined);
  writeFileSync(join(f.root, 'unrelated.txt'), 'main advance\n');
  f.git(f.root, 'add', 'unrelated.txt');
  f.git(f.root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture unrelated main');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.equal(f.plan().decision.reason, 'known-baseline-still-failing');
  f.commit('tests/conditions.json', '{"runtime":"different"}\n');
  const newReview = f.review();
  f.set('review', newReview, newReview.head_sha);

  const changed = f.plan();

  assert.equal(changed.obs.knownBaselines[0].status, 'different-source-or-conditions');
  assert.equal(changed.decision.action, 'blocked');
  rmSync(join(f.root, f.record.failure.log.path));
  const missing = f.plan();
  assert.equal(missing.obs.knownBaselines[0].status, 'insufficient-evidence');
  assert.equal(missing.decision.action, 'blocked');
});

for (const file of ['docs/guide.md', '.github/workflows/ci.yml']) {
  test(`CLI: forced full receipt admission and revalidation for ${file}`, (t) => {
    const f = fixture(t);
    f.set('preflight', f.preflight({
      scope: ['docs/', '.github/workflows/'], predicted_files: [...new Set([file, 'docs/guide.md'])],
    }));
    f.implement();
    f.commit(file, 'fixture full verification\n');
    const review = f.review();
    f.set('review', review, review.head_sha);
    const receipt = f.verify(true, true);
    f.set('local-checks', receipt, review.head_sha);
    assert.equal(f.plan().obs.localChecks.status, 'passed');

    const path = join(f.worktree, receipt.receiptPath);
    const original = readFileSync(path, 'utf8');
    for (const intent of [false, undefined]) {
      const changed = JSON.parse(original);
      if (intent === undefined) delete changed.forceFull;
      else changed.forceFull = intent;
      writeFileSync(path, JSON.stringify(changed));
      f.set('local-checks', {
        ...receipt, receiptSha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      }, review.head_sha, false);
    }
    writeFileSync(path, original);
    assert.equal(f.plan().obs.localChecks.status, 'passed');
  });
}

test('CLI: scoped receipt uses issue worktree graph after orchestrator manifest changes', (t) => {
  const f = fixture(t, true);
  mkdirSync(join(f.root, 'packages/sample/src'), { recursive: true });
  writeFileSync(join(f.root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  const manifestPath = join(f.root, 'packages/sample/package.json');
  writeFileSync(manifestPath, JSON.stringify({
    name: '@fixture/scoped-receipt', version: '1.0.0', private: true,
    scripts: { build: 'build-sample', typecheck: 'typecheck-sample' },
  }));
  writeFileSync(join(f.root, 'packages/sample/src/index.ts'), 'export const value = 1;\n');
  f.git(f.root, 'add', '.');
  f.git(f.root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture workspace base');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  f.set('preflight', f.preflight({
    scope: ['docs/', 'packages/sample/src/'], predicted_files: ['packages/sample/src/index.ts'],
  }));
  f.implement();
  f.commit('packages/sample/src/index.ts', 'export const value = 2;\n');
  const review = f.review();
  f.set('review', review, review.head_sha);
  const receipt = f.verify();
  f.set('local-checks', receipt, review.head_sha);
  assert.equal(f.plan().obs.localChecks.status, 'passed');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = '1.0.1';
  writeFileSync(manifestPath, JSON.stringify(manifest));
  f.git(f.root, 'add', 'packages/sample/package.json');
  f.git(f.root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'unrelated orchestrator version');
  assert.equal(f.plan().obs.headSha, review.head_sha);
  assert.equal(f.plan().obs.localChecks.status, 'passed');
  f.set('local-checks', receipt, review.head_sha);
});

const waiverFixture = (t) => {
  const f = fixture(t);
  const preflight = f.preflight({
    scope: ['docs/', '.github/workflows/'], predicted_files: ['docs/guide.md', '.github/workflows/ci.yml'],
  });
  f.set('preflight', preflight);
  f.implement();
  f.commit('.github/workflows/ci.yml', 'name: fixture CI\n');
  const review = f.review();
  f.set('review', review, review.head_sha);
  const lane = JSON.parse(readFileSync(f.lanePath));
  lane.issues['42'].facts.review.accepted_at = '2026-01-01T00:00:00.000Z';
  writeFileSync(f.lanePath, JSON.stringify(lane));
  const waiver = () => {
    const { obs } = f.plan();
    return { laneId: 'fixture', issue: 42, status: 'waived', scope: 'full-local-ci',
      ...localCheckBinding(obs.review, obs.reviewAcceptedAt), authority: 'explicit-operator-instruction',
      evidence: { kind: 'accepted-preflight', contractSha256: obs.preflight.sha256, criteria: ['A12', 'V12', 'SE-V05'] } };
  };
  return { ...f, acceptedPreflight: preflight, acceptedReview: review, waiver };
};

test('CLI local-ci-waiver: explicit registration -> separate audit fact without local-check success', (t) => {
  const f = waiverFixture(t);
  const head = f.acceptedReview.head_sha;
  const value = f.waiver();
  assert.equal(f.plan().decision.action, 'create-pr');

  f.set('local-ci-waiver', value, head);

  const result = f.plan();
  const facts = JSON.parse(readFileSync(f.lanePath)).issues['42'].facts;
  assert.equal(result.decision.action, 'create-pr');
  assert.equal(result.obs.laneId, 'fixture');
  assert.equal(result.obs.issue, 42);
  assert.equal(result.obs.localChecks, null);
  assert.equal(facts['local-checks'], undefined);
  assert.deepEqual(facts['local-ci-waiver'].value, value);
  assert.equal(facts['local-ci-waiver'].head, head);
  assert.equal(new Date(facts['local-ci-waiver'].accepted_at).toISOString(), facts['local-ci-waiver'].accepted_at);
  assert.deepEqual(result.obs.localCiWaiver, facts['local-ci-waiver']);
  assert.notEqual(value.preflightSha256, value.evidence.contractSha256);
  const calls = readFileSync(f.ghLog, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.every((args) => ['issue', 'pr'].includes(args[0]) && args[1] === 'view'));
});

test('CLI local-ci-waiver: bad or stale payloads -> rejection without lane byte mutation', (t) => {
  const f = waiverFixture(t);
  const value = f.waiver();
  const head = f.acceptedReview.head_sha;
  const bytes = readFileSync(f.lanePath, 'utf8');
  for (const bad of [
    null, [], { status: 'waived' },
    { ...value, laneId: 'other' }, { ...value, issue: 43 }, { ...value, issue: '42' },
    { ...value, preflightSha256: value.evidence.contractSha256 },
    { ...value, reviewSha256: 'f'.repeat(64) },
    { ...value, reviewAcceptedAt: '2026-01-02T00:00:00.000Z' },
    { ...value, evidence: { ...value.evidence, contractSha256: value.preflightSha256 } },
    { ...value, status: 'passed' }, { ...value, scope: 'remote-ci' },
    { ...value, authority: 'inferred' }, { ...value, valid: true },
    { ...value, receiptPath: '.omo/verification/missing.json' },
    { ...value, startedAt: '2026-01-01T00:00:01.000Z' },
    { ...value, evidence: { ...value.evidence, path: 'invented.json' } },
    { ...value, evidence: { ...value.evidence, criteria: [] } },
    { ...value, evidence: { ...value.evidence, criteria: ['A12', 'A12'] } },
  ]) {
    f.set('local-ci-waiver', bad, head, false);
    assert.equal(readFileSync(f.lanePath, 'utf8'), bytes);
  }
  f.set('local-ci-waiver', value, 'f'.repeat(40), false);
  assert.equal(readFileSync(f.lanePath, 'utf8'), bytes);

  f.set('local-ci-waiver', value, head);
  assert.equal(f.plan().decision.action, 'create-pr');
});

test('CLI local-ci-waiver: malformed persisted wrappers -> ignored without exceptions', (t) => {
  const f = waiverFixture(t);
  const head = f.acceptedReview.head_sha;
  const value = f.waiver();
  const lane = JSON.parse(readFileSync(f.lanePath));
  const fact = { head, value, accepted_at: '2026-01-01T00:00:01.000Z' };
  for (const bad of [
    null, [], { ...fact, head: 'f'.repeat(40) }, { head, value },
    { ...fact, accepted_at: 'invalid' }, { ...fact, receiptSha256: 'a'.repeat(64) },
    { ...fact, value: { ...value, valid: true } },
    { ...fact, value: { ...value, laneId: 'other' } },
    { ...fact, value: { ...value, issue: 43 } },
    { ...fact, value: { ...value, reviewSha256: 'f'.repeat(64) } },
  ]) {
    lane.issues['42'].facts['local-ci-waiver'] = bad;
    writeFileSync(f.lanePath, JSON.stringify(lane));

    const result = f.plan();
    assert.equal(result.decision.action, 'create-pr');
    assert.equal(result.obs.localCiWaiver, null);
  }
});

test('CLI local-ci-waiver: applicable failure and invalid receipt -> fix-back with evidence retained', (t) => {
  const f = waiverFixture(t);
  const head = f.acceptedReview.head_sha;
  const value = f.waiver();
  f.set('local-ci-waiver', value, head);
  f.set('local-checks', f.verify(), head);
  rmSync(join(f.worktree, '.omo/verification/receipt.json'));
  let bytes = readFileSync(f.lanePath, 'utf8');

  f.set('local-ci-waiver', value, head, false);

  assert.equal(readFileSync(f.lanePath, 'utf8'), bytes);
  assert.equal(f.plan().decision.reason, 'local-checks-failed');
  f.cli('record', [...f.common, '--phase', 'verify-local', '--result-json', JSON.stringify({
    ok: false, head_sha: head, evidence: '.omo/verification/failed.log',
  })]);
  bytes = readFileSync(f.lanePath, 'utf8');
  f.set('local-ci-waiver', value, head, false);
  assert.equal(readFileSync(f.lanePath, 'utf8'), bytes);
  assert.equal(f.plan().decision.reason, 'local-checks-failed');
  const lane = JSON.parse(bytes);
  assert.equal(lane.issues['42'].attempts['verify-local'], 1);
  lane.issues['42'].blocker = { type: 'attempts-exhausted', phase: 'verify-local' };
  writeFileSync(f.lanePath, JSON.stringify(lane));
  bytes = readFileSync(f.lanePath, 'utf8');
  f.set('local-ci-waiver', value, head, false);
  assert.equal(readFileSync(f.lanePath, 'utf8'), bytes);
  assert.equal(f.plan().decision.action, 'blocked');
});

test('CLI local-ci-waiver: successful admission -> unrelated failure history and blockers preserved', (t) => {
  const f = waiverFixture(t);
  const value = f.waiver();
  const lane = JSON.parse(readFileSync(f.lanePath));
  const entry = lane.issues['42'];
  entry.attempts['verify-local'] = 3;
  entry.blocker = { type: 'attempts-exhausted', phase: 'verify-local' };
  entry.facts['local-checks'] = { head: 'f'.repeat(40), value: { status: 'failed', evidence: 'old-failure.log' } };
  writeFileSync(f.lanePath, JSON.stringify(lane));

  f.set('local-ci-waiver', value, f.acceptedReview.head_sha);

  const after = JSON.parse(readFileSync(f.lanePath)).issues['42'];
  assert.deepEqual(after.attempts, entry.attempts);
  assert.deepEqual(after.blocker, entry.blocker);
  assert.deepEqual(after.facts['local-checks'], entry.facts['local-checks']);
  assert.equal(f.plan().decision.action, 'blocked');
});

test('CLI local-ci-waiver: same preflight and unrelated main advance -> binding preserved', (t) => {
  const f = waiverFixture(t);
  f.set('local-ci-waiver', f.waiver(), f.acceptedReview.head_sha);
  const facts = JSON.parse(readFileSync(f.lanePath)).issues['42'].facts;
  f.set('preflight', f.acceptedPreflight);
  assert.deepEqual(JSON.parse(readFileSync(f.lanePath)).issues['42'].facts, facts);
  writeFileSync(join(f.root, 'unrelated.md'), 'unrelated main change\n');
  f.git(f.root, 'add', 'unrelated.md');
  f.git(f.root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture unrelated main');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

  const result = f.plan();

  assert.equal(result.obs.baseSha, f.acceptedPreflight.base_sha);
  assert.equal(result.decision.action, 'create-pr');
  assert.deepEqual(result.obs.localCiWaiver, facts['local-ci-waiver']);
});

test('CLI local-ci-waiver: review or preflight replacement -> cleared waiver and rejected stale replay', (t) => {
  const f = waiverFixture(t);
  const head = f.acceptedReview.head_sha;
  const value = f.waiver();
  f.set('local-ci-waiver', value, head);
  f.set('review', f.acceptedReview, head);
  assert.equal(JSON.parse(readFileSync(f.lanePath)).issues['42'].facts['local-ci-waiver'], undefined);
  const lane = JSON.parse(readFileSync(f.lanePath));
  lane.issues['42'].facts.review.accepted_at = '2026-02-01T00:00:00.000Z';
  writeFileSync(f.lanePath, JSON.stringify(lane));
  let bytes = readFileSync(f.lanePath, 'utf8');
  f.set('local-ci-waiver', value, head, false);
  assert.equal(readFileSync(f.lanePath, 'utf8'), bytes);
  assert.equal(f.plan().decision.action, 'create-pr');
  const renewed = f.waiver();
  f.set('local-ci-waiver', renewed, head);

  f.set('preflight', f.preflight({
    scope: ['docs/', '.github/workflows/'], predicted_files: ['.github/workflows/ci.yml'],
    acceptance: ['Updated acceptance'],
  }));

  const facts = JSON.parse(readFileSync(f.lanePath)).issues['42'].facts;
  assert.equal(facts.review, undefined);
  assert.equal(facts['local-ci-waiver'], undefined);
  bytes = readFileSync(f.lanePath, 'utf8');
  f.set('local-ci-waiver', renewed, head, false);
  assert.equal(readFileSync(f.lanePath, 'utf8'), bytes);
  const review = f.review();
  f.set('review', review, head);
  bytes = readFileSync(f.lanePath, 'utf8');
  f.set('local-ci-waiver', renewed, head, false);
  assert.equal(readFileSync(f.lanePath, 'utf8'), bytes);
  assert.equal(f.plan().decision.action, 'create-pr');
});

test('CLI local-ci-waiver: new head or invalid preflight/review -> no carried authority', (t) => {
  const f = waiverFixture(t);
  const head = f.acceptedReview.head_sha;
  const value = f.waiver();
  f.set('local-ci-waiver', value, head);
  f.commit('docs/guide.md', 'new implementation head\n');
  let result = f.plan();
  assert.equal(result.decision.action, 'review');
  assert.equal(result.obs.localCiWaiver, null);
  let bytes = readFileSync(f.lanePath, 'utf8');
  f.set('local-ci-waiver', value, result.obs.headSha, false);
  assert.equal(readFileSync(f.lanePath, 'utf8'), bytes);
  const review = f.review();
  f.set('review', review, review.head_sha);
  result = f.plan();
  assert.equal(result.decision.action, 'create-pr');
  bytes = readFileSync(f.lanePath, 'utf8');
  f.set('local-ci-waiver', value, review.head_sha, false);
  assert.equal(readFileSync(f.lanePath, 'utf8'), bytes);
  const fresh = f.waiver();
  f.set('local-ci-waiver', fresh, review.head_sha);
  assert.equal(f.plan().decision.action, 'create-pr');
  f.state.issue.body = 'changed contract';
  f.update();
  bytes = readFileSync(f.lanePath, 'utf8');

  f.set('local-ci-waiver', fresh, review.head_sha, false);

  assert.equal(readFileSync(f.lanePath, 'utf8'), bytes);
  assert.equal(f.plan().decision.action, 'preflight');
  assert.equal(f.plan().obs.localCiWaiver, null);
});

for (const file of ['.github/workflows/ci.yml', 'package.json', 'pnpm-lock.yaml',
  'tooling/ci/package.json', 'vitest.config.ts', 'tooling/ci/verify-local.mjs']) {
  test(`CLI: reviewed ${file} -> publication without local receipt or waiver`, (t) => {
    const f = fixture(t);
    f.set('preflight', f.preflight({
      scope: ['docs/', file], predicted_files: [file],
    }));
    f.implement();
    f.commit(file, file.endsWith('package.json') ? '{"private":true}\n' : 'fixture change\n');
    assert.equal(f.plan().decision.action, 'review');
    const review = f.review();
    f.set('review', review, review.head_sha);

    const result = f.plan();

    assert.equal(result.decision.action, 'create-pr');
    assert.equal(result.obs.localChecks, null);
    assert.equal(result.obs.localCiWaiver, null);
    const facts = JSON.parse(readFileSync(f.lanePath)).issues['42'].facts;
    assert.equal(facts['local-checks'], undefined);
    assert.equal(facts['local-ci-waiver'], undefined);
    f.state.pr = {
      number: 42, state: 'OPEN', headRefOid: 'f'.repeat(40),
      mergeable: 'MERGEABLE', statusCheckRollup: [{ conclusion: 'SUCCESS' }],
    };
    f.update();
    assert.equal(f.plan().decision.action, 'push');
    f.state.pr.headRefOid = review.head_sha;
    for (const [checks, mergeable, action] of [
      [[], 'MERGEABLE', 'wait-ci'],
      [[{ conclusion: 'FAILURE' }], 'MERGEABLE', 'fix-back'],
      [[{ conclusion: 'SUCCESS' }], 'CONFLICTING', 'resolve-conflict'],
      [[{ conclusion: 'SUCCESS' }], 'UNKNOWN', 'wait-mergeability'],
      [[{ conclusion: 'SUCCESS' }], 'MERGEABLE', 'request-merge-approval'],
    ]) {
      f.state.pr.statusCheckRollup = checks;
      f.state.pr.mergeable = mergeable;
      f.update();
      assert.equal(f.plan().decision.action, action);
    }
  });
}

test('CLI: durable preflight and selected review publish ordinary docs without full local CI', (t) => {
  const f = fixture(t);
  assert.equal(f.plan().decision.action, 'preflight');
  const preflight = f.preflight();
  f.set('preflight', preflight);
  assert.equal(f.plan().decision.action, 'implement');
  f.implement();
  let result = f.plan();
  assert.equal(result.decision.action, 'review');
  assert.deepEqual(result.obs.changedFiles, ['docs/guide.md']);
  assert.deepEqual(result.obs.preflightPolicy.active_axes, ['contract']);
  assert.equal(result.obs.preflight.sha256, preflight.sha256);
  const review = f.review();
  f.set('review', review, review.head_sha);
  result = f.plan();
  assert.equal(result.decision.action, 'create-pr');
  assert.equal(result.obs.review.verdict, 'pass');
  const stored = JSON.parse(readFileSync(f.lanePath, 'utf8'));
  assert.equal(Object.hasOwn(stored.issues['42'].facts.preflight, 'head'), false);
  assert.equal(stored.issues['42'].facts.review.value.preflight_sha256, review.preflight_sha256);
  f.cli('record', [...f.common, '--phase', 'preflight', '--result-json', '{"ok":false}']);
  assert.equal(JSON.parse(readFileSync(f.lanePath)).issues['42'].attempts.preflight, 1);
  assert.equal(JSON.parse(f.cli('plan-all', ['--lane', f.lanePath]).stdout)[0].decision.action, 'create-pr');
  assert.match(f.cli('watch', ['--lane', f.lanePath, '--once']).stdout, /-> create-pr/u);
  f.state.pr = {
    number: 42, state: 'OPEN', headRefOid: 'f'.repeat(40),
    mergeable: 'MERGEABLE', statusCheckRollup: [{ conclusion: 'SUCCESS' }],
  };
  f.update();
  assert.equal(f.plan().decision.action, 'push');
  f.state.pr.headRefOid = review.head_sha;
  f.state.pr.statusCheckRollup = [{ state: 'PENDING' }];
  f.update();
  assert.equal(f.plan().decision.action, 'wait-ci');
  f.state.pr.statusCheckRollup = [{ conclusion: 'FAILURE' }];
  f.update();
  assert.equal(f.plan().decision.reason, 'ci-failing');
  f.state.pr.mergeable = 'CONFLICTING';
  f.update();
  assert.equal(f.plan().decision.action, 'resolve-conflict');
  f.state.pr.mergeable = 'UNKNOWN';
  f.state.pr.statusCheckRollup = [{ conclusion: 'SUCCESS' }];
  f.update();
  assert.equal(f.plan().decision.action, 'wait-mergeability');
  f.state.pr.mergeable = 'MERGEABLE';
  f.update();
  assert.equal(f.plan().decision.action, 'request-merge-approval');
  const calls = readFileSync(f.ghLog, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.every((args) => ['issue', 'pr'].includes(args[0]) && args[1] === 'view'));
});

test('CLI: recording an actual local CI failure enters fix-back without forging a passed receipt', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  const review = f.review();
  f.set('review', review, review.head_sha);
  f.state.localFailure = true;
  f.update();
  const failed = f.verify(false);
  f.cli('record', [...f.common, '--phase', 'verify-local', '--result-json', JSON.stringify({
    ok: false, head_sha: review.head_sha, evidence: failed.receiptPath,
  })]);
  assert.equal(f.plan().decision.reason, 'local-checks-failed');
  f.commit('docs/guide.md', 'repair local CI\n');
  assert.equal(f.plan().decision.action, 'review');
  const snapshot = readFileSync(f.lanePath, 'utf8');
  f.cli('record', [...f.common, '--phase', 'verify-local', '--result-json', JSON.stringify({
    ok: false, head_sha: review.head_sha, evidence: failed.receiptPath,
  })], false);
  assert.equal(readFileSync(f.lanePath, 'utf8'), snapshot);
  const fresh = f.review();
  f.set('review', fresh, fresh.head_sha);
  assert.equal(f.plan().decision.action, 'create-pr');
});

test('CLI: failed local receipt fixes back and new ordinary head requires review', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  const review = f.review();
  f.set('review', review, review.head_sha);
  const lane = JSON.parse(readFileSync(f.lanePath));
  const accepted = lane.issues['42'].facts.review;
  lane.issues['42'].facts['local-checks'] = { head: review.head_sha, value: {
    ...localCheckBinding(accepted.value, accepted.accepted_at),
    receiptStartedAt: new Date(Date.parse(accepted.accepted_at) + 1000).toISOString(),
    status: 'passed', valid: true, receiptPath: '.omo/verification/missing.json', receiptSha256: 'a'.repeat(64),
  } };
  writeFileSync(f.lanePath, JSON.stringify(lane));
  assert.equal(f.plan().decision.reason, 'local-checks-failed');
  f.commit('docs/guide.md', 'fix-back\n');
  assert.equal(f.plan().decision.action, 'review');
  const fresh = f.review();
  f.set('review', fresh, fresh.head_sha);
  assert.equal(f.plan().decision.action, 'create-pr');
});

test('CLI: malformed, missing, duplicate, narrowed and stale reviews never persist', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  const review = f.review();
  const bytes = readFileSync(f.lanePath, 'utf8');
  for (const value of [
    { verdict: 'merge' }, { ...review, reviews: [] }, { ...review, reviews: [...review.reviews, ...review.reviews] },
    { ...review, active_axes: [] }, { ...review, preflight_sha256: 'f'.repeat(64) },
    { ...review, reviews: [{ ...review.reviews[0], verdict_signal: 'merge' }] },
  ]) {
    f.set('review', value, review.head_sha, false);
    assert.equal(readFileSync(f.lanePath, 'utf8'), bytes);
  }
  f.set('review', review, 'f'.repeat(40), false);
  f.set('local-checks', { status: 'passed' }, review.head_sha, false);
  assert.equal(f.plan().decision.action, 'review');
  const lane = JSON.parse(bytes);
  lane.issues['42'].facts.review = { head: review.head_sha, value: { verdict: 'merge' } };
  writeFileSync(f.lanePath, JSON.stringify(lane));
  assert.equal(f.plan().decision.action, 'review');
});

test('CLI: actual diff expands axes and rejects implementer narrowing', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  const old = f.review();
  f.set('review', old, old.head_sha);
  f.commit('src/runtime.ts', 'export const runtime = true;\n');
  const result = f.plan();
  assert.equal(result.decision.action, 'review');
  assert.deepEqual(result.obs.preflightPolicy.active_axes, ['contract', 'code', 'verification']);
  assert.notEqual(result.obs.preflightPolicy.sha256, old.preflight_sha256);
  const full = f.review();
  f.set('review', { ...full, active_axes: ['contract'], reviews: [full.reviews[0]] }, full.head_sha, false);
  f.set('preflight', f.preflight(), undefined, false);
  f.set('preflight', f.preflight({ active_axes: ['contract', 'code', 'verification'], omitted_axes: {} }));
  const current = f.review();
  f.set('review', current, current.head_sha);
  assert.equal(f.plan().decision.action, 'create-pr');
});

test('CLI: accepted expanded axes cannot shrink when implementation later removes runtime files', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  f.commit('src/runtime.ts', 'export const runtime = true;\n');
  const full = f.review();
  f.set('review', full, full.head_sha);
  f.git(f.worktree, 'rm', 'src/runtime.ts');
  f.git(f.worktree, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture remove runtime');
  const result = f.plan();
  assert.equal(result.decision.action, 'review');
  assert.deepEqual(result.obs.changedFiles, ['docs/guide.md']);
  assert.deepEqual(result.obs.preflightPolicy.active_axes, ['contract', 'code', 'verification']);
});

test('CLI: outside approved scope returns preflight and supports explicit scope renewal', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  f.commit('outside.md', 'scope expansion\n');
  assert.equal(f.plan().decision.reason, 'scope-expansion');
  f.set('preflight', f.preflight(), undefined, false);
  f.set('preflight', f.preflight({ scope: ['docs/', 'outside.md'], predicted_files: ['outside.md'] }));
  assert.equal(f.plan().decision.action, 'review');
});

test('CLI: title/body, base and accepted contract edits invalidate old evidence', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  const review = f.review();
  f.set('review', review, review.head_sha);
  f.set('preflight', f.preflight({ acceptance: ['Additional acceptance'] }));
  assert.equal(f.plan().decision.action, 'review');
  f.state.issue.body = 'Changed issue contract';
  f.update();
  assert.equal(f.plan().decision.reason, 'stale-preflight-binding');
  f.set('preflight', f.preflight());
  assert.equal(f.plan().decision.action, 'review');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', review.head_sha);
  // The changed contract still cannot use old approval. Once main contains
  // the whole branch, there is no issue-local implementation delta to review.
  assert.deepEqual(f.plan().obs.changedFiles, []);
  assert.equal(f.plan().decision.action, 'implement');
  f.state.unavailable = true;
  f.update();
  assert.equal(f.plan().decision.action, 'observation-failed');
});

test('CLI: unrelated main advancement preserves preflight, review and canonical receipt', (t) => {
  const f = fixture(t);
  const preflight = f.preflight();
  f.set('preflight', preflight);
  f.implement();
  const review = f.review();
  f.set('review', review, review.head_sha);
  const lane = JSON.parse(readFileSync(f.lanePath, 'utf8'));
  lane.issues['42'].facts.review.accepted_at = '2000-01-01T00:00:00.000Z';
  writeFileSync(f.lanePath, JSON.stringify(lane));
  const receipt = f.verify();
  f.set('local-checks', receipt, review.head_sha);
  const accepted = f.plan();
  assert.equal(accepted.decision.action, 'create-pr');
  const receiptBody = JSON.parse(readFileSync(join(f.worktree, receipt.receiptPath), 'utf8'));
  assert.equal(receiptBody.identity.baseRef, preflight.base_sha);
  assert.equal(receiptBody.identity.baseSha, preflight.base_sha);
  const original = JSON.parse(readFileSync(f.lanePath, 'utf8')).issues['42'].facts;

  writeFileSync(join(f.root, 'unrelated.md'), 'merged unrelated work\n');
  f.git(f.root, 'add', 'unrelated.md');
  f.git(f.root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture unrelated merge');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const after = f.plan();
  assert.notEqual(f.git(f.root, 'rev-parse', 'origin/main'), preflight.base_sha);
  assert.equal(after.obs.baseSha, preflight.base_sha);
  assert.deepEqual(after.obs.changedFiles, ['docs/guide.md']);
  assert.equal(after.decision.action, 'create-pr');
  assert.equal(after.obs.localChecks.valid, true);

  f.set('preflight', preflight);
  assert.deepEqual(JSON.parse(readFileSync(f.lanePath, 'utf8')).issues['42'].facts, original);
  assert.equal(f.plan().decision.action, 'create-pr');
  f.set('preflight', f.preflight({ base_sha: f.git(f.root, 'rev-parse', 'origin/main') }), undefined, false);
  assert.deepEqual(JSON.parse(readFileSync(f.lanePath, 'utf8')).issues['42'].facts, original);
});

test('CLI: missing, unrelated or disconnected base anchors fail closed', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight({ base_sha: 'f'.repeat(40) }), undefined, false);
  const preflight = f.preflight();
  f.set('preflight', preflight);
  f.implement();
  const other = f.git(f.root, 'commit-tree', 'HEAD^{tree}', '-m', 'unrelated root');
  f.set('preflight', f.preflight({ base_sha: other }), undefined, false);
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', other);
  assert.equal(f.plan().decision.action, 'preflight');
  assert.equal(f.plan().decision.reason, 'stale-preflight-binding');
  f.set('preflight', preflight, undefined, false);
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', preflight.base_sha);
  f.git(f.root, 'update-ref', 'refs/heads/issue-42', other);
  assert.equal(f.plan().decision.reason, 'stale-preflight-binding');
  f.git(f.root, 'update-ref', '-d', 'refs/remotes/origin/main');
  assert.equal(f.plan().decision.reason, 'stale-preflight-binding');
});

test('CLI: a new branch at advanced main still needs implementation with a pinned base', (t) => {
  const f = fixture(t);
  const preflight = f.preflight();
  f.set('preflight', preflight);
  writeFileSync(join(f.root, 'docs/guide.md'), 'upstream change\n');
  f.git(f.root, 'add', 'docs/guide.md');
  f.git(f.root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture advanced main');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  f.git(f.root, 'worktree', 'add', '-b', 'issue-42', f.worktree, 'main');

  const { obs, decision } = f.plan();
  assert.equal(obs.baseSha, preflight.base_sha);
  assert.deepEqual(obs.changedFiles, []);
  assert.equal(obs.hasNewCommits, false);
  assert.equal(decision.action, 'implement');
});

test('CLI: integrating main keeps upstream files outside issue scope and requires new-head evidence', (t) => {
  const f = fixture(t);
  const preflight = f.preflight();
  f.set('preflight', preflight);
  f.implement();
  const review = f.review();
  f.set('review', review, review.head_sha);
  mkdirSync(join(f.root, '.github/workflows'), { recursive: true });
  writeFileSync(join(f.root, '.github/workflows/ci.yml'), 'name: upstream\n');
  f.git(f.root, 'add', '.github/workflows/ci.yml');
  f.git(f.root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture upstream change');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  f.git(f.worktree, '-c', 'commit.gpgsign=false', 'merge', '--no-edit', 'origin/main');

  const result = f.plan();
  assert.equal(result.decision.action, 'review');
  assert.deepEqual(result.obs.changedFiles, ['docs/guide.md']);
  assert.equal(result.obs.preflight.sha256, preflight.sha256);
  assert.equal(result.obs.baseSha, preflight.base_sha);
  assert.notEqual(result.obs.headSha, review.head_sha);
  assert.equal(result.obs.review, null);
  assert.equal(result.obs.localChecks, null);
  const freshReview = f.review();
  f.set('review', freshReview, freshReview.head_sha);
  assert.equal(f.plan().decision.action, 'create-pr');
  const lane = JSON.parse(readFileSync(f.lanePath, 'utf8'));
  lane.issues['42'].facts.review.accepted_at = '2000-01-01T00:00:00.000Z';
  writeFileSync(f.lanePath, JSON.stringify(lane));
  f.set('local-checks', f.verify(), freshReview.head_sha);
  assert.equal(f.plan().decision.action, 'create-pr');
  f.commit('outside.md', 'actual out-of-scope issue change\n');
  assert.equal(f.plan().decision.reason, 'scope-expansion');
});

test('CLI: canonical receipts bind to passing review, execution order and current policy', (t) => {
  const f = fixture(t);
  const ciScope = {
    scope: ['docs/', '.github/workflows/'],
    predicted_files: ['docs/guide.md', '.github/workflows/ci.yml'],
  };
  f.set('preflight', f.preflight(ciScope));
  f.implement();
  f.commit('.github/workflows/ci.yml', 'name: issue CI\n');
  assert.equal(f.plan().decision.action, 'review');
  const oldReceipt = f.verify();
  const review = f.review();
  // A real passed receipt before review cannot register, even on the same head.
  f.set('local-checks', oldReceipt, review.head_sha, false);
  f.set('review', review, review.head_sha);
  const setAcceptedAt = (timestamp) => {
    const lane = JSON.parse(readFileSync(f.lanePath));
    lane.issues['42'].facts.review.accepted_at = timestamp;
    writeFileSync(f.lanePath, JSON.stringify(lane));
  };
  // Time is the behavior under test. Fixed clock boundaries make rejection
  // deterministic without sleeping or depending on process scheduling.
  setAcceptedAt('2100-01-01T00:00:00.000Z');
  assert.match(f.set('local-checks', oldReceipt, review.head_sha, false).stderr, /must start after/u);
  setAcceptedAt('2000-01-01T00:00:00.000Z');
  const currentReceipt = f.verify();
  const currentPath = join(f.worktree, currentReceipt.receiptPath);
  const currentBytes = readFileSync(currentPath);
  const historical = { ...JSON.parse(currentBytes), version: 1 };
  writeFileSync(currentPath, `${JSON.stringify(historical)}\n`);
  const v1Ref = { ...currentReceipt,
    receiptSha256: createHash('sha256').update(readFileSync(currentPath)).digest('hex') };
  assert.match(f.set('local-checks', v1Ref, review.head_sha, false).stderr, /receipt/u);
  writeFileSync(currentPath, currentBytes);
  f.set('local-checks', currentReceipt, review.head_sha);
  let result = f.plan();
  assert.equal(result.decision.action, 'create-pr');
  assert.equal(result.obs.localChecks.preflightSha256, result.obs.preflightPolicy.sha256);
  assert.equal(result.obs.localChecks.reviewSha256, localCheckBinding(result.obs.review, result.obs.reviewAcceptedAt).reviewSha256);
  const staleLocalFact = JSON.parse(readFileSync(f.lanePath)).issues['42'].facts['local-checks'];
  // A same-head review replacement clears optional local evidence and rejects replay.
  f.set('review', review, review.head_sha);
  assert.equal(JSON.parse(readFileSync(f.lanePath)).issues['42'].facts['local-checks'], undefined);
  assert.equal(f.plan().decision.action, 'create-pr');
  setAcceptedAt('2100-01-01T00:00:00.000Z');
  assert.match(f.set('local-checks', currentReceipt, review.head_sha, false).stderr, /must start after/u);
  // Replacing the accepted contract clears both review and local CI at the
  // same head. A manually restored old local fact cannot prove current execution.
  f.set('preflight', f.preflight({ ...ciScope, acceptance: ['Revised acceptance'] }));
  let lane = JSON.parse(readFileSync(f.lanePath));
  assert.equal(lane.issues['42'].facts.review, undefined);
  assert.equal(lane.issues['42'].facts['local-checks'], undefined);
  const freshReview = f.review();
  f.set('review', freshReview, freshReview.head_sha);
  lane = JSON.parse(readFileSync(f.lanePath));
  lane.issues['42'].facts['local-checks'] = staleLocalFact;
  writeFileSync(f.lanePath, JSON.stringify(lane));
  result = f.plan();
  assert.equal(result.decision.action, 'create-pr');
  assert.equal(result.obs.localChecks, null);
});

test('CLI: rename observes both old and new paths, including excluded source', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight({ scope: ['docs/'] }));
  f.implement();
  f.git(f.worktree, 'mv', 'docs/guide.md', 'moved.md');
  f.git(f.worktree, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture rename');
  const result = f.plan();
  assert.deepEqual(result.obs.changedFiles, ['docs/guide.md', 'moved.md']);
  assert.equal(result.decision.reason, 'scope-expansion');
});

const generatedFixture = (t) => {
  const f = fixture(t);
  const legacy = JSON.parse(readFileSync(f.lanePath));
  delete legacy.preflight_overlap;
  writeFileSync(f.lanePath, JSON.stringify(legacy));
  f.set('preflight', f.preflight({ scope: ['docs/', 'src/'], non_scope: [] }));
  f.implement();
  const ready = (issue) => {
    const lane = JSON.parse(readFileSync(f.lanePath, 'utf8'));
    if (issue !== 42) {
      lane.issues[String(issue)] = { issue, branch: `issue-${issue}`, depends_on: [],
        approvals: { merge: true }, attempts: {}, blocker: null, facts: {} };
      writeFileSync(f.lanePath, JSON.stringify(lane));
      const worktree = join(f.root, `.worktrees/issue-${issue}`);
      f.git(f.root, 'worktree', 'add', '-b', `issue-${issue}`, worktree, 'main');
      writeFileSync(join(worktree, `docs/sibling-${issue}.md`), 'sibling\n');
      f.git(worktree, 'add', '.');
      f.git(worktree, '-c', 'commit.gpgsign=false', 'commit', '-m', `sibling ${issue}`);
    }
    const args = ['--lane', f.lanePath, '--issue', String(issue)];
    const obs = JSON.parse(f.cli('plan', args).stdout).obs;
    const preflight = createPreflight({ issue, issue_sha256: obs.issueSha256, base_sha: obs.baseSha,
      scope: ['docs/', 'src/'], non_scope: [], acceptance: ['Retain generated consumer'],
      validation: ['node --test'], predicted_files: ['src/generated.ts'] });
    f.cli('set-fact', [...args, '--kind', 'preflight', '--value', JSON.stringify(preflight)]);
    const current = JSON.parse(f.cli('plan', args).stdout).obs;
    const review = { head_sha: current.headSha, preflight_sha256: current.preflightPolicy.sha256,
      active_axes: current.preflightPolicy.active_axes,
      reviews: current.preflightPolicy.active_axes.map((reviewer) => ({ reviewer, agent: `fluo-${reviewer}-reviewer`,
        reviewed_head_sha: current.headSha, preflight_sha256: current.preflightPolicy.sha256,
        verdict_signal: 'PASS', blockers: [] })) };
    f.cli('set-fact', [...args, '--kind', 'review', '--head', current.headSha, '--value', JSON.stringify(review)]);
    const pr = { number: issue + 100, state: 'OPEN', headRefOid: current.headSha,
      mergeable: 'MERGEABLE', statusCheckRollup: [{ conclusion: 'SUCCESS' }] };
    if (issue === 42) f.state.pr = pr;
    else { f.state.prs ??= {}; f.state.prs[`issue-${issue}`] = pr; }
    f.update();
    f.cli('approve-merge', args);
    return pr;
  };
  ready(42);
  ready(43);
  ready(44);
  const hint = { surface: 'src/generated.ts', issues: [42, 43, 44],
    generated: { command: `${process.execPath} generator.mjs --check`,
      inputs: [{ path: 'docs/guide.md', sha256: 'a'.repeat(64) }],
      issue_evidence: [42, 43, 44].map((issue) => ({ issue, title: 'Generated consumer', body: 'docs/guide.md', paths: ['docs/guide.md'] })), sha256: '' } };
  hint.generated.sha256 = generatedHintDigest(hint);
  const lane = JSON.parse(readFileSync(f.lanePath, 'utf8'));
  lane.predicted_conflicts = [hint];
  writeFileSync(f.lanePath, JSON.stringify(lane));
  f.state.pr.mergeable = 'CONFLICTING';
  f.update();
  return { ...f, hint, ready };
};

const overlapFixture = (t, enabled = true) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  const lane = JSON.parse(readFileSync(f.lanePath));
  if (enabled) lane.preflight_overlap = 1;
  lane.issues['43'] = { issue: 43, branch: 'issue-43', depends_on: [], approvals: { merge: true },
    attempts: {}, blocker: null, facts: {} };
  writeFileSync(f.lanePath, JSON.stringify(lane));
  const sibling = join(f.root, '.worktrees/issue-43');
  f.git(f.root, 'worktree', 'add', '-b', 'issue-43', sibling, 'main');
  writeFileSync(join(sibling, 'docs/sibling.md'), 'sibling\n');
  f.git(sibling, 'add', '.');
  f.git(sibling, '-c', 'commit.gpgsign=false', 'commit', '-m', 'overlapping sibling');
  const args = ['--lane', f.lanePath, '--issue', '43'];
  const obs = JSON.parse(f.cli('plan', args).stdout).obs;
  const accepted = createPreflight({ issue: 43, issue_sha256: obs.issueSha256, base_sha: obs.baseSha,
    scope: ['docs/'], non_scope: [], acceptance: ['Retain docs'], validation: ['node --test'],
    predicted_files: ['docs/guide.md'] });
  f.cli('set-fact', [...args, '--kind', 'preflight', '--value', JSON.stringify(accepted)]);
  const siblingHead = f.git(sibling, 'rev-parse', 'HEAD');
  f.state.prs = { 'issue-43': { number: 143, state: 'OPEN', headRefOid: siblingHead,
    mergeable: 'MERGEABLE', statusCheckRollup: [{ state: 'PENDING' }] } };
  f.update();
  return { ...f, siblingHead };
};

test('CLI overlap: plan, plan-all and watch -> identical sibling/file targets before review', (t) => {
  const f = overlapFixture(t);

  const decision = f.plan().decision;
  assert.equal(decision.action, 'wait-preflight-overlap');
  assert.deepEqual(decision.siblings.map(s => s.issue), [43]);
  assert.deepEqual(decision.files, ['docs/guide.md']);
  assert.deepEqual(JSON.parse(f.cli('plan-all', ['--lane', f.lanePath]).stdout)[0].decision, decision);
  const watched = f.cli('watch', ['--lane', f.lanePath, '--once']).stdout;
  assert.match(watched, /wait-preflight-overlap.*43.*docs\/guide\.md/u);
  const legacy = JSON.parse(readFileSync(f.lanePath));
  delete legacy.preflight_overlap;
  writeFileSync(f.lanePath, JSON.stringify(legacy));
  assert.equal(f.plan().decision.action, 'review');
  f.cli('approve-merge', f.common);
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(f.lanePath)), 'preflight_overlap'), false);
});

test('CLI overlap: wait then sibling merge -> real base integration, focused check and fresh review before publication', (t) => {
  const f = overlapFixture(t);
  assert.equal(f.plan().decision.action, 'wait-preflight-overlap');
  const stale = f.review();
  f.state.prs['issue-43'].state = 'MERGED';
  f.state.prs['issue-43'].mergeCommit = { oid: f.siblingHead };
  f.update();
  assert.equal(f.plan().decision.action, 'observation-failed', 'merge not yet visible in origin/base');
  f.git(f.root, 'merge', '--ff-only', 'issue-43');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

  const integration = f.plan().decision;
  assert.equal(integration.action, 'resolve-conflict');
  assert.equal(integration.reason, 'preflight-overlap-base-integration');
  assert.equal(integration.base, f.siblingHead);
  assert.equal(Object.hasOwn(integration, 'pr'), false);
  f.git(f.worktree, 'merge', '--no-edit', integration.base);
  const newHead = f.git(f.worktree, 'rev-parse', 'HEAD');
  assert.notEqual(newHead, stale.head_sha);
  const check = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; assert.equal(readFileSync('docs/sibling.md','utf8'),'sibling\\n'); assert.equal(readFileSync('docs/guide.md','utf8'),'implemented\\n');"],
    { cwd: f.worktree, env: f.env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(check.status, 0, check.stderr);
  f.cli('record', [...f.common, '--phase', 'resolve-conflict', '--result-json',
    JSON.stringify({ ok: true, head_sha: newHead })]);
  f.set('review', stale, newHead, false);
  assert.equal(f.plan().decision.action, 'review');
  const review = f.review();
  f.set('review', review, newHead);
  assert.equal(f.plan().decision.action, 'create-pr');
  f.state.pr = { number: 142, state: 'OPEN', headRefOid: stale.head_sha,
    mergeable: 'MERGEABLE', statusCheckRollup: [{ conclusion: 'SUCCESS' }] };
  f.update();
  assert.equal(f.plan().decision.action, 'push', 'old-head remote CI cannot validate integrated head');
  f.state.pr.headRefOid = newHead;
  f.state.pr.statusCheckRollup = [{ state: 'PENDING' }];
  f.update();
  assert.equal(f.plan().decision.action, 'wait-ci');
});

test('CLI overlap: unreadable merge commit and unrelated base movement -> fail closed only for actual integration targets', (t) => {
  const f = overlapFixture(t);
  f.state.prs['issue-43'].state = 'MERGED';

  for (const mergeCommit of [undefined, null, { oid: 'f'.repeat(40) }]) {
    if (mergeCommit === undefined) delete f.state.prs['issue-43'].mergeCommit;
    else f.state.prs['issue-43'].mergeCommit = mergeCommit;
    f.update();

    assert.equal(f.plan().decision.action, 'observation-failed');
  }
  f.state.prs['issue-43'].state = 'CLOSED';
  f.update();
  writeFileSync(join(f.root, 'docs/unrelated.md'), 'unrelated\n');
  f.git(f.root, 'add', 'docs/unrelated.md');
  f.git(f.root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'unrelated base advance');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.equal(f.plan().decision.action, 'review');
});

test('CLI overlap marker: default direct init -> legacy decisions and byte preservation on conflicting opt-in', (t) => {
  const f = overlapFixture(t, false);
  const bytes = readFileSync(f.lanePath);

  assert.equal(Object.hasOwn(JSON.parse(bytes), 'preflight_overlap'), false);
  assert.equal(f.plan().decision.action, 'review');
  f.cli('init', ['--lane-id', 'fixture', '--issue', '42', '--preflight-overlap'], false);
  assert.deepEqual(readFileSync(f.lanePath), bytes);
  f.cli('approve-merge', f.common);
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(f.lanePath)), 'preflight_overlap'), false);
  f.state.prs['issue-43'].state = 'MERGED';
  f.update();
  assert.equal(f.plan().decision.action, 'review', 'legacy recovery never requires new merge ancestry evidence');
});

test('CLI overlap marker: explicit flag -> opt-in; invalid v4 values reject without mutation', (t) => {
  const f = fixture(t);
  const path = f.cli('init', ['--lane-id', 'opt-in', '--issue', '42', '--preflight-overlap']).stdout.trim();
  const lane = JSON.parse(readFileSync(path));
  assert.equal(lane.preflight_overlap, 1);
  assert.equal(lane.issues['42'].approvals.merge, false);
  for (const marker of [null, true, '1', 0, 2]) {
    writeFileSync(f.lanePath, JSON.stringify({ ...lane, preflight_overlap: marker }));
    const bytes = readFileSync(f.lanePath);

    f.cli('plan', f.common, false);
    f.cli('approve-merge', f.common, false);
    assert.deepEqual(readFileSync(f.lanePath), bytes);
  }
});

test('CLI overlap marker: explicit flag with v2 import -> reject without creating a lane or changing the source', (t) => {
  const f = fixture(t);
  const ledger = join(f.root, 'overlap-v2-flag.json');
  for (const marker of [undefined, 1]) {
    const value = { version: 2, lane_id: `flag-${String(marker)}`, confirmed_issues: [42],
      ...(marker === undefined ? {} : { preflight_overlap: marker }) };
    writeFileSync(ledger, JSON.stringify(value));
    const bytes = readFileSync(ledger);

    const result = f.cli('init', ['--from-lane-v2', ledger, '--preflight-overlap'], false);

    assert.match(result.stderr, /--preflight-overlap.*--from-lane-v2/u);
    assert.deepEqual(readFileSync(ledger), bytes);
    assert.equal(existsSync(join(f.root, `.omo/lanes-v4/${value.lane_id}.json`)), false);
  }
});

test('CLI overlap marker: v2 import -> exact presence preserved and invalid markers rejected', (t) => {
  const f = fixture(t);
  const ledger = join(f.root, 'overlap-v2.json');
  for (const marker of [undefined, 1, null, true, '1', 0, 2]) {
    const value = { version: 2, lane_id: `overlap-${String(marker)}`, confirmed_issues: [42],
      ...(marker === undefined ? {} : { preflight_overlap: marker }) };
    writeFileSync(ledger, JSON.stringify(value));

    const valid = marker === undefined || marker === 1;
    const result = f.cli('init', ['--from-lane-v2', ledger], valid);
    if (valid) {
      const path = result.stdout.trim();
      assert.equal(Object.hasOwn(JSON.parse(readFileSync(path)), 'preflight_overlap'), marker === 1);
      f.cli('approve-merge', ['--lane', path, '--issue', '42']);
      const saved = JSON.parse(readFileSync(path));
      assert.equal(Object.hasOwn(saved, 'preflight_overlap'), marker === 1);
      if (marker === 1) assert.equal(saved.preflight_overlap, 1);
    } else {
      assert.match(result.stderr, /preflight_overlap/u);
    }
  }
});

test('CLI generated coordination: successive ready merges -> one wait then release on fresh loss/restart', (t) => {
  const f = generatedFixture(t);
  const before = f.plan();
  assert.equal(before.decision.action, 'wait-generated-integration');
  assert.deepEqual(before.decision.siblings.map((item) => item.issue), [43, 44]);
  assert.equal(JSON.parse(f.cli('plan-all', ['--lane', f.lanePath]).stdout)[0].decision.action, 'wait-generated-integration');
  assert.match(f.cli('watch', ['--lane', f.lanePath, '--once']).stdout, /-> wait-generated-integration/u);
  f.state.prs['issue-43'].state = 'MERGED';
  f.update();
  assert.deepEqual(f.plan().decision.siblings.map((item) => item.issue), [44]);
  f.state.prs['issue-44'].statusCheckRollup = [{ state: 'PENDING' }];
  f.update();
  assert.equal(f.plan().decision.action, 'resolve-conflict');
  assert.match(f.cli('watch', ['--lane', f.lanePath, '--once']).stdout, /-> resolve-conflict/u);
  f.state.prs['issue-44'].statusCheckRollup = [{ conclusion: 'FAILURE' }];
  f.update();
  assert.equal(f.plan().decision.action, 'resolve-conflict');
});

test('CLI generated coordination: stale head, unknown mergeability and absent authority -> sibling is not ready', (t) => {
  const f = generatedFixture(t);
  f.state.prs['issue-43'].headRefOid = 'f'.repeat(40);
  f.state.prs['issue-44'].mergeable = 'UNKNOWN';
  f.update();
  assert.equal(f.plan().decision.action, 'resolve-conflict');
  f.state.prs['issue-43'].headRefOid = f.git(f.root, 'rev-parse', 'issue-43');
  const lane = JSON.parse(readFileSync(f.lanePath, 'utf8'));
  lane.issues['43'].approvals.merge = false;
  writeFileSync(f.lanePath, JSON.stringify(lane));
  f.update();
  assert.equal(f.plan().decision.action, 'resolve-conflict');
  lane.issues['43'].facts.review.head = 'f'.repeat(40);
  writeFileSync(f.lanePath, JSON.stringify(lane));
  assert.equal(f.plan().decision.action, 'resolve-conflict');
});

test('CLI generated coordination: hints, pending CI and unrelated main movement -> no forced integration', (t) => {
  const f = generatedFixture(t);
  f.state.pr.mergeable = 'MERGEABLE';
  f.state.pr.statusCheckRollup = [{ state: 'PENDING' }];
  f.update();
  assert.equal(f.plan().decision.action, 'wait-ci');
  writeFileSync(join(f.root, 'unrelated.md'), 'upstream\n');
  f.git(f.root, 'add', 'unrelated.md');
  f.git(f.root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'unrelated main');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.equal(f.plan().decision.action, 'wait-ci');
  f.state.pr.statusCheckRollup = [{ conclusion: 'SUCCESS' }];
  f.update();
  assert.equal(f.plan().decision.action, 'merge');
  const lane = JSON.parse(readFileSync(f.lanePath, 'utf8'));
  delete lane.predicted_conflicts;
  writeFileSync(f.lanePath, JSON.stringify(lane));
  f.state.pr.mergeable = 'CONFLICTING';
  f.update();
  assert.equal(f.plan().decision.action, 'resolve-conflict');
});

test('CLI measurements: actual record and fresh observations -> retrospective consumes scoped clock identity', (t) => {
  const f = generatedFixture(t);
  const head = f.plan().obs.headSha;
  const measurement = { runId: 'fixture-run', attempt: 1, stage: 'focused', head,
    clock: 'simulation', elapsedMs: 12, scope: 'stage-execution' };
  const args = [...f.common, '--phase', 'review', '--result-json', JSON.stringify({ ok: true, ...f.review(), measurements: [measurement] })];
  f.cli('record', args);
  f.cli('record', args);
  const events = readRetroEvents(f.root, 'fixture');
  const report = summarizeIntegrationMeasurements(events, { 42: head });
  assert.equal(report.counts.focused, 1);
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.simulation, true);
  assert.equal(report.totalElapsedMs, null);
  assert.ok(events.some((event) => event.kind === 'observation' && event.data.action === 'wait-generated-integration'));
  f.cli('record', [...f.common, '--phase', 'review', '--result-json',
    JSON.stringify({ ok: true, ...f.review(), measurements: [{ ...measurement, head: 'f'.repeat(40) }] })], false);
});

test('CLI generated integration: real conflict and authoritative fixture generation -> new-head focused/browser/review/CI guards', (t) => {
  const f = generatedFixture(t);
  f.commit('src/generated.ts', 'old artifact\n');
  const reviewed = f.review();
  f.set('review', reviewed, reviewed.head_sha);
  f.state.pr.headRefOid = reviewed.head_sha;
  f.state.prs['issue-43'].state = 'MERGED';
  f.state.prs['issue-44'].state = 'MERGED';
  const lane = JSON.parse(readFileSync(f.lanePath, 'utf8'));
  lane.predicted_conflicts[0].generated.command = `${process.execPath} src/generator.mjs --check`;
  lane.predicted_conflicts[0].generated.sha256 = generatedHintDigest(lane.predicted_conflicts[0]);
  writeFileSync(f.lanePath, JSON.stringify(lane));
  f.update();
  mkdirSync(join(f.root, 'src'));
  writeFileSync(join(f.root, 'src/generator.mjs'), `import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const source=readFileSync('docs/guide.md','utf8');
const output=JSON.stringify({sourceFingerprint:createHash('sha256').update(source).digest('hex'),source})+'\\n';
if(process.argv.includes('--check')) {
  if(readFileSync('src/generated.ts','utf8')!==output) process.exit(1);
  process.stdout.write('UNCHANGED fixture generated consumer\\n');
} else process.stdout.write(output);
`);
  writeFileSync(join(f.root, 'docs/guide.md'), 'upstream source\n');
  writeFileSync(join(f.root, 'src/generated.ts'), 'upstream artifact\n');
  f.git(f.root, 'add', 'src', 'docs/guide.md');
  f.git(f.root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture generated upstream');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.equal(f.plan().decision.action, 'resolve-conflict');
  assert.throws(() => f.git(f.worktree, '-c', 'commit.gpgsign=false', 'merge', '--no-edit', 'origin/main'));
  writeFileSync(join(f.worktree, 'docs/guide.md'), 'combined source\n');
  const bytes = execFileSync(process.execPath, ['src/generator.mjs', '--stdout'], { cwd: f.worktree, encoding: 'utf8' });
  writeFileSync(join(f.worktree, 'src/generated.ts'), bytes);
  f.git(f.worktree, 'add', '.');
  f.git(f.worktree, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture resolved generation');
  const integrated = f.plan();
  assert.equal(integrated.obs.baseSha, lane.issues['42'].facts.preflight.value.base_sha);
  assert.equal(integrated.decision.reason, 'generated-integration-evidence-missing');
  assert.equal(integrated.obs.review, null);
  const directory = join(f.worktree, '.omo/generated-integration');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'expected.ts'), bytes);
  const log = 'Synthetic workflow fixture checks; not real browser or remote CI acceptance.\n';
  writeFileSync(join(directory, 'check.log'), log);
  const hash = (text) => createHash('sha256').update(text).digest('hex');
  const receipt = { head: integrated.obs.headSha,
    outputs: [{ surface: 'src/generated.ts', expectedPath: '.omo/generated-integration/expected.ts',
      expectedSha256: hash(bytes), artifactSha256: hash(bytes),
      command: lane.predicted_conflicts[0].generated.command, exitCode: 0, normalizeSourceFingerprint: false }],
    checks: ['focused', 'browser'].map((kind) => ({ kind, head: integrated.obs.headSha,
      command: `synthetic ${kind}`, exitCode: 0, logPath: '.omo/generated-integration/check.log', logSha256: hash(log) })) };
  const record = (value, ok = true) => f.cli('record', [...f.common, '--phase', 'resolve-conflict',
    '--result-json', JSON.stringify({ ok: true, head_sha: integrated.obs.headSha, generated_integration: value })], ok);
  const incomplete = structuredClone(receipt);
  incomplete.checks.pop();
  record(incomplete, false);
  assert.equal(f.plan().decision.reason, 'generated-integration-evidence-missing');
  record(receipt);
  assert.equal(f.plan().decision.action, 'review');
  f.set('review', reviewed, reviewed.head_sha, false);
  const freshReview = f.review();
  f.set('review', freshReview, freshReview.head_sha);
  assert.equal(f.plan().decision.action, 'push');
  f.state.pr.headRefOid = integrated.obs.headSha;
  f.state.pr.mergeable = 'MERGEABLE';
  f.state.pr.statusCheckRollup = [{ state: 'PENDING' }];
  f.update();
  assert.equal(f.plan().decision.action, 'wait-ci');
  f.state.pr.statusCheckRollup = [{ conclusion: 'FAILURE' }];
  f.update();
  assert.equal(f.plan().decision.reason, 'ci-failing');
  f.state.pr.statusCheckRollup = [{ conclusion: 'SUCCESS' }];
  f.update();
  assert.equal(f.plan().decision.action, 'merge');
  f.commit('docs/guide.md', 'another source revision\n');
  assert.equal(f.plan().decision.reason, 'generated-integration-evidence-missing');
});
