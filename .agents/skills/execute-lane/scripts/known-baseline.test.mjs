import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { observeKnownBaseline, validateKnownBaseline } from './known-baseline.mjs';

const fixture = (t) => {
  const parent = new URL('../../../../.omo/verification/retro-followups-3977-3978-20261013/issue-3978/unit-fixtures/', import.meta.url).pathname;
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'baseline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'fixture', GIT_COMMITTER_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_EMAIL: 'fixture@example.test' };
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', timeout: 10_000 }).trim();
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const ref = path => ({ path, sha256: hash(readFileSync(join(root, path))) });
  const commit = (path, bytes) => {
    writeFileSync(join(root, path), bytes);
    git('add', path);
    git('-c', 'commit.gpgsign=false', 'commit', '-m', `fixture ${path}`);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-b', 'main');
  writeFileSync(join(root, '.gitignore'), 'proof/\n');
  writeFileSync(join(root, 'condition.json'), '{"runtime":"node"}\n');
  writeFileSync(join(root, 'test.mjs'), `import { readFileSync } from 'node:fs';
const fixed = readFileSync('source.txt', 'utf8') === 'fixed\\n';
process.stdout.write(fixed ? 'passed\\n' : 'baseline failed\\n'); process.exitCode = fixed ? 0 : 1;
`);
  writeFileSync(join(root, 'source.txt'), 'broken\n');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture failure');
  mkdirSync(join(root, 'proof'));
  const proof = label => {
    const head = git('rev-parse', 'HEAD');
    const sources = [ref('source.txt')], conditions = [ref('condition.json')], test_source = ref('test.mjs');
    const result = spawnSync(process.execPath, ['test.mjs'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.error, undefined);
    const log = `proof/${label}.log`, receipt = `proof/${label}.json`;
    writeFileSync(join(root, log), `${result.stdout}${result.stderr}`);
    const command = 'node test.mjs';
    writeFileSync(join(root, receipt), JSON.stringify({
      version: 1, head, command, completed: true, signal: result.signal,
      status: result.status === 0 ? 'passed' : 'failed', exit_code: result.status,
      log_sha256: ref(log).sha256, source_sha256: hash(JSON.stringify({ sources, conditions, test_source })),
    }));
    return { head, command, sources, conditions, test_source, log: ref(log), receipt: ref(receipt) };
  };
  const failure = proof('failure');
  commit('source.txt', 'fixed\n');
  const companion = proof('companion');
  const record = { version: 1, id: 'baseline', issues: [42], failure, companion,
    adjudication: { authority: 'lead', cause: 'confirmed-common-baseline',
      failure_head: failure.head, companion_head: companion.head, reason: 'Exact check reproduced; source-only companion passed.' } };
  const observe = (head, value = record) => observeKnownBaseline(root, value, { issue: 42, head, members: [42, 43] });
  return { root, git, hash, ref, commit, record, observe };
};

test('known baseline: authenticated failure and companion -> distinct byte applicability', t => {
  const f = fixture(t);

  assert.deepEqual(validateKnownBaseline(f.root, f.record, [42]), f.record);
  assert.equal(f.observe(f.record.failure.head).status, 'still-failing');
  assert.equal(f.observe(f.record.companion.head).status, 'fixed');
  const other = f.commit('source.txt', 'different\n');
  assert.equal(f.observe(other).status, 'different-source-or-conditions');
  f.commit('source.txt', 'fixed\n');
  const conditions = f.commit('condition.json', '{"runtime":"other"}\n');
  assert.equal(f.observe(conditions).status, 'different-source-or-conditions');
  f.commit('condition.json', '{"runtime":"node"}\n');
  const changedTest = f.commit('test.mjs', 'process.stdout.write("different test");\n');
  assert.equal(f.observe(changedTest).status, 'different-source-or-conditions');
  const missing = f.git('rm', 'source.txt');
  assert.equal(typeof missing, 'string');
  f.git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture missing source');
  assert.equal(f.observe(f.git('rev-parse', 'HEAD')).status, 'insufficient-evidence');
});

test('known baseline admission: tampered identities and adjudication -> reject without inferred PASS', t => {
  const f = fixture(t);
  const patches = [
    r => { r.adjudication.authority = 'reviewer'; },
    r => { r.adjudication.cause = 'UNKNOWN'; },
    r => { r.adjudication.failure_head = r.companion.head; },
    r => { r.adjudication.companion_head = r.failure.head; },
    r => { r.failure.head = '0'.repeat(40); },
    r => { r.companion.command = 'node different-test.mjs'; },
    r => { r.failure.sources[0].sha256 = '0'.repeat(64); },
    r => { r.failure.conditions[0].sha256 = '0'.repeat(64); },
    r => { r.failure.test_source.sha256 = '0'.repeat(64); },
    r => { r.issues = [99]; },
    r => { r.issues = [42, 42]; },
    r => { r.failure.log.path = '../outside.log'; },
    r => { r.failure.receipt.sha256 = '0'.repeat(64); },
  ];
  for (const patch of patches) {
    const changed = structuredClone(f.record);
    patch(changed);

    assert.throws(() => validateKnownBaseline(f.root, changed, [42]));
    assert.equal(f.observe(f.record.failure.head, changed).status, 'insufficient-evidence');
  }
});

test('known baseline evidence: altered completed receipt or missing log -> fail closed on re-observation', t => {
  const f = fixture(t);
  const path = join(f.root, f.record.failure.receipt.path);
  const original = readFileSync(path, 'utf8');
  for (const patch of [
    { completed: false }, { signal: 'SIGTERM' }, { status: 'timeout' }, { exit_code: 0 },
    { head: f.record.companion.head }, { command: 'other' }, { source_sha256: '0'.repeat(64) },
    { log_sha256: '0'.repeat(64) },
  ]) {
    writeFileSync(path, JSON.stringify({ ...JSON.parse(original), ...patch }));
    const changed = structuredClone(f.record);
    changed.failure.receipt = f.ref(changed.failure.receipt.path);

    assert.throws(() => validateKnownBaseline(f.root, changed, [42]));
    assert.equal(f.observe(f.record.failure.head, changed).status, 'insufficient-evidence');
  }
  writeFileSync(path, original);
  writeFileSync(join(f.root, f.record.companion.log.path), 'altered\n');
  assert.equal(f.observe(f.record.companion.head).status, 'insufficient-evidence');
  rmSync(join(f.root, f.record.failure.log.path));
  assert.equal(f.observe(f.record.failure.head).status, 'insufficient-evidence');
});
