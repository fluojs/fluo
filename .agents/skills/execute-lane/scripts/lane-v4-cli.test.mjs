import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { createPreflight } from '../../issue-preflight/scripts/contracts.mjs';
import { localCheckBinding } from './lane-v4.mjs';

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
  // Only package commands are stubbed; the real verifier executes them and
  // emits its own identity-bound receipts/logs. git and lane CLI remain real.
  writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}\nimport { readFileSync } from 'node:fs';\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\nif (JSON.parse(readFileSync(process.env.GH_STATE)).localFailure) process.exit(1);\n`);
  chmodSync(join(bin, 'pnpm'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_STATE: ghState, GH_LOG: ghLog,
    GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }).trim();
  git(root, 'init', '-b', 'main');
  writeFileSync(join(root, '.gitignore'), 'bin/\ngh.json\ngh.log\n.omo/\n.worktrees/\n');
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs/guide.md'), 'base\n');
  for (const file of ['tooling/ci/verify-local.mjs', 'tooling/ci/local-verification.mjs', 'tooling/ci/local-verification-receipt.schema.json', '.agents/workflow-contracts/schema-validator.mjs']) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(new URL(`../../../../${file}`, import.meta.url), join(root, file));
  }
  writeFileSync(join(root, 'tooling/ci/local-verification-manifest.json'), JSON.stringify({ version: 1, rules: [], companions: [], scope: { fullPaths: [], fullPrefixes: [] } }));
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
    const result = spawnSync(process.execPath, [join(worktree, 'tooling/ci/verify-local.mjs')], { cwd: worktree, env, encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, ok ? 0 : 1, result.stderr + result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, ok ? 'passed' : 'failed');
    const bytes = readFileSync(output.path);
    return { status: output.status, valid: ok, receiptPath: relative(worktree, output.path), receiptSha256: createHash('sha256').update(bytes).digest('hex') };
  };
  return { root, worktree, state, update, git, cli, plan, set, preflight, implement, commit, review, verify, lanePath, common, ghLog };
};

test('CLI: durable preflight, selected review, then canonical local CI across fresh processes', (t) => {
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
  assert.equal(result.decision.action, 'verify-local');
  assert.equal(result.obs.review.verdict, 'pass');
  const stored = JSON.parse(readFileSync(f.lanePath, 'utf8'));
  assert.equal(Object.hasOwn(stored.issues['42'].facts.preflight, 'head'), false);
  assert.equal(stored.issues['42'].facts.review.value.preflight_sha256, review.preflight_sha256);
  f.cli('record', [...f.common, '--phase', 'preflight', '--result-json', '{"ok":false}']);
  assert.equal(JSON.parse(readFileSync(f.lanePath)).issues['42'].attempts.preflight, 1);
  assert.equal(JSON.parse(f.cli('plan-all', ['--lane', f.lanePath]).stdout)[0].decision.action, 'verify-local');
  assert.match(f.cli('watch', ['--lane', f.lanePath, '--once']).stdout, /-> verify-local/u);
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
  assert.equal(f.plan().decision.action, 'verify-local');
});

test('CLI: failed local receipt fixes back, new head requires review before local CI again', (t) => {
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
  assert.equal(f.plan().decision.action, 'verify-local');
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
  assert.equal(f.plan().decision.action, 'verify-local');
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
  assert.equal(f.plan().decision.reason, 'stale-preflight-binding');
  f.state.unavailable = true;
  f.update();
  assert.equal(f.plan().decision.action, 'preflight');
});

test('CLI: canonical receipts bind to passing review, execution order and current policy', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
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
  f.set('preflight', f.preflight({ acceptance: ['Revised acceptance'] }));
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
