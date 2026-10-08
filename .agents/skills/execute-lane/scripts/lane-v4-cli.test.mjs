import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { createPreflight } from '../../issue-preflight/scripts/contracts.mjs';
import { localCheckBinding } from './lane-v4.mjs';
import { buildVerificationPlan, digest, readVerificationManifest } from '../../../../tooling/ci/local-verification.mjs';
import { collectIdentity } from '../../../../tooling/ci/verify-local.mjs';

const script = new URL('./lane-v4-cli.mjs', import.meta.url).pathname;
const fixture = (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-lane-v4-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const ghState = join(root, 'gh.json');
  const ghLog = join(root, 'gh.log');
  const state = { issue: { state: 'OPEN', title: 'Document route precedence', body: 'Keep route precedence stable.' }, pr: null };
  const update = () => writeFileSync(ghState, JSON.stringify(state));
  update();
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}\nimport { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.GH_LOG, JSON.stringify(args) + '\\n');
const state = JSON.parse(readFileSync(process.env.GH_STATE));
if (state.unavailable) process.exit(1);
if (args[0] === 'pr' && args[1] === 'view') {
  if (!state.pr) process.exit(1);
  process.stdout.write(JSON.stringify(state.pr));
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
  git(root, 'add', '.');
  git(root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture base');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const cli = (command, args = [], ok = true) => {
    const result = spawnSync(process.execPath, [script, command, '--root', root, ...args], { env, encoding: 'utf8', timeout: 10_000 });
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
      reviews: obs.preflightPolicy.active_axes.map((reviewer) => ({ reviewer, reviewed_head_sha: obs.headSha,
        preflight_sha256: obs.preflightPolicy.sha256, verdict_signal: 'PASS', blockers: [] })) };
  };
  const verify = (ok = true) => {
    const entry = JSON.parse(readFileSync(lanePath, 'utf8')).issues['42'];
    const base = entry.facts.preflight.value.base_sha;
    // This fixture exercises lane receipt admission, not real execution.
    // Docker-backed command execution is covered by verification-runner.docker-test.mjs.
    const identity = collectIdentity(worktree, base);
    const plan = buildVerificationPlan({ changedFiles: identity.changedFiles, identity,
      manifest: readVerificationManifest(join(worktree, 'tooling/ci/local-verification-manifest.json')) });
    const lock = plan.environment.lock;
    const actual = {
      os: 'linux', arch: 'arm64',
      node: Object.fromEntries(Object.entries(lock.node).map(([key, item]) => [key, item.version])),
      bun: Object.fromEntries(Object.entries(lock.bun).map(([key, item]) => [key, item.version])),
      deno: Object.fromEntries(Object.entries(lock.deno).map(([key, item]) => [key, item.version])),
      pnpm: lock.pnpm.version, browser: { channel: lock.browser.channel, version: lock.browser.version, launched: true },
      docker: { reachable: true, version: lock.docker.version, cliVersion: lock.docker.version },
      redis: { ping: 'PONG', image: lock.redis.image }, watch: { linuxVolume: true, event: 'rename' },
    };
    const planDigest = plan.semanticDigest;
    const evidenceRoot = join(worktree, '.omo/verification/lane-test');
    const resultRoot = join(evidenceRoot, 'results');
    mkdirSync(resultRoot, { recursive: true });
    const taskResults = plan.tasks.map((task) => ({
      version: 2, taskId: task.id, status: ok ? 'passed' : 'failed',
      headSha: identity.headSha, treeSha: identity.treeSha, planDigest,
      imageKey: plan.environment.imageKey, imageId: `sha256:${'1'.repeat(64)}`,
      environment: actual, artifacts: [],
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
    const archivePath = join(evidenceRoot, 'artifacts/archive.tar');
    mkdirSync(dirname(archivePath), { recursive: true });
    writeFileSync(archivePath, 'artifact');
    const receipt = {
      version: 2, status: ok ? 'passed' : 'failed', profile: 'pr', identity,
      source: plan.source, environment: { lock, imageKey: plan.environment.imageKey },
      imageIdentity: { key: plan.environment.imageKey, id: `sha256:${'1'.repeat(64)}` },
      environmentLockDigest: plan.environment.lockDigest,
      manifestDigest: plan.manifestDigest, planDigest, hostChecks, taskResults,
      capabilityTasks: plan.capabilityTasks, logs,
      artifacts: [{ path: relative(worktree, archivePath), digest: digest('artifact') }],
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
  return { root, worktree, state, update, git, cli, plan, set, preflight, implement, commit, review, verify, lanePath, common, ghLog };
};

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
  assert.equal(f.plan().decision.action, 'verify-local');

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
    assert.equal(result.decision.action, 'verify-local');
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
  assert.equal(f.plan().decision.action, 'verify-local');
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
  assert.equal(f.plan().decision.action, 'verify-local');
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
  assert.equal(result.decision.action, 'verify-local');
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
  assert.equal(f.plan().decision.action, 'preflight');
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
  // A same-head review replacement requires local CI again and rejects replay.
  f.set('review', review, review.head_sha);
  assert.equal(JSON.parse(readFileSync(f.lanePath)).issues['42'].facts['local-checks'], undefined);
  assert.equal(f.plan().decision.action, 'verify-local');
  setAcceptedAt('2100-01-01T00:00:00.000Z');
  assert.match(f.set('local-checks', currentReceipt, review.head_sha, false).stderr, /must start after/u);
  // Replacing the accepted contract clears both review and local CI at the
  // same head. Even a manually restored old local fact cannot advance it.
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
  assert.equal(result.decision.action, 'verify-local');
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
