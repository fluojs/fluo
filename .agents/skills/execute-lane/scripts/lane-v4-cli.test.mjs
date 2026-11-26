// allow: SIZE_OK — #4153 requires the original single-file CLI suite and forbids splitting its tests into another file.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { aborted } from 'node:util';
import { enforcePackageProductionInputs, productionInputClassifier } from '../../../../tooling/governance/package-production-inputs.mjs';
import { buildVerificationPlan, digest, readVerificationManifest } from '../../../../tooling/ci/local-verification.mjs';
import { collectIdentity } from '../../../../tooling/ci/verify-local.mjs';
import { generatedHintDigest } from '../../../workflow-contracts/contracts.mjs';
import { createPreflight, evaluatePreflight } from '../../issue-preflight/scripts/contracts.mjs';
import { readRetroEvents } from '../../retrospective-lane/scripts/retro.mjs';
import { summarizeIntegrationMeasurements } from './generated-integration.mjs';
import { localCheckBinding } from './lane-v4.mjs';
import { isConsumerVisibleFile } from './lane-v4-cli.mjs';

const script = new URL('./lane-v4-cli.mjs', import.meta.url).pathname;

function writeProductionDeclaration(root, packages, producers = [], manifests = []) {
  const manifestKeys = ['name', 'private', 'scripts', 'type', 'files', 'main', 'module', 'types', 'typings', 'exports', 'bin', 'imports'];
  const declaration = {
    version: 1, owner: 'fixture-maintainer',
    packages: packages.map(entry => ({ owner: 'fixture-maintainer', ...entry })),
    producers: producers.map(({ definitions = [], ...entry }) => ({
      owner: 'fixture-maintainer', ...entry,
      definitions: Object.fromEntries(definitions.map(path => [path,
        createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])),
    })),
    manifests: Object.fromEntries(manifests.map(path => {
      const manifest = JSON.parse(readFileSync(join(root, path), 'utf8'));
      const projection = Object.fromEntries(manifestKeys.map(key => [key, manifest[key] ?? null]));
      return [path, createHash('sha256').update(JSON.stringify(projection)).digest('hex')];
    })),
    nonProduction: [],
  };
  mkdirSync(join(root, 'tooling/governance'), { recursive: true });
  writeFileSync(join(root, 'tooling/governance/package-production-inputs.json'), JSON.stringify(declaration));
}

function sqliteWarningFixture(t, { otherWarnings = false, fail = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fluo-sqlite-4136-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const preload = join(root, 'warnings.mjs');
  writeFileSync(preload, `
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const original = process.emitWarning;
const message = 'SQLite is an experimental feature and might change at any time';
registerHooks({
  load(url, context, nextLoad) {
    if (url === 'node:sqlite') {
      process.emitWarning(message, 'ExperimentalWarning', 'SQLITE_LOAD_STRING');
      process.emitWarning(message, { type: 'ExperimentalWarning', code: 'SQLITE_LOAD_OPTIONS' });
      process.emitWarning(Object.assign(new Error(message), { name: 'ExperimentalWarning', code: 'SQLITE_LOAD_ERROR' }));
      if (${otherWarnings}) {
        process.emitWarning('Other experimental feature', 'ExperimentalWarning', 'OTHER_EXPERIMENTAL');
        process.emitWarning(message, { type: 'Warning', code: 'OTHER_TYPE' });
        process.emitWarning(Object.assign(new Error(message), { name: 'CustomWarning', code: 'OTHER_ERROR_TYPE' }));
        process.emitWarning('Ordinary load warning', { code: 'ORDINARY_WARNING', detail: 'Keep warning details' });
      }
      if (${fail}) throw new Error('SQLite load fixture failed');
    }
    return nextLoad(url, context);
  },
});
process.once('beforeExit', () => {
  assert.equal(process.emitWarning, original, 'SQLite load must restore emitWarning');
  if (${otherWarnings}) {
    process.emitWarning(message, 'ExperimentalWarning', 'AFTER_SQLITE_LOAD');
    process.emitWarning('Warning after load', { code: 'AFTER_OTHER_WARNING' });
  }
});
`);
  const env = { ...process.env, NODE_OPTIONS: '' };
  delete env.NODE_NO_WARNINGS;
  return {
    root, preload, env,
    run: (args) => spawnSync(process.execPath, ['--import', preload, ...args],
      { cwd: root, env, encoding: 'utf8', timeout: 10_000 }),
  };
}

test('#4136 CLI: forced SQLite warnings -> successful init keeps stdout and empty stderr', (t) => {
  const f = sqliteWarningFixture(t);
  const lanePath = join(f.root, '.omo/lanes-v4/warnings.json');

  const result = f.run([script, 'init', '--root', f.root, '--lane-id', 'warnings', '--issue', '42']);

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${lanePath}\n`);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(readFileSync(lanePath)).version, 4);
});

test('#4136 CLI: forced SQLite warnings -> structured dispatch failure remains whole stderr JSON', (t) => {
  const f = fixture(t);
  const warnings = sqliteWarningFixture(t);
  f.env.NODE_OPTIONS = `--import ${warnings.preload}`;
  delete f.env.NODE_NO_WARNINGS;
  rmSync(join(f.root, '.omo/omo.jsonc'));

  const result = f.cli('record', [...f.common, '--phase', 'preflight', '--result-json',
    JSON.stringify({ ok: true, agent: 'fluo-issue-preflight' })], false);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(error.status, 'blocked');
  assert.equal(error.kind, 'input-preparation');
  assert.equal(error.code, 'dispatch-registration-unreadable');
  assert.equal(error.fix_back_eligible, false);
  assert.doesNotMatch(result.stderr, /ExperimentalWarning/u);
});

test('#4136 preparation CLI: forced SQLite warnings -> input failure remains whole stderr JSON', (t) => {
  const f = sqliteWarningFixture(t);
  const preparation = new URL('./workflow-preparation.mjs', import.meta.url).pathname;

  const result = f.run([preparation]);

  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(error.status, 'blocked');
  assert.equal(error.kind, 'input-preparation');
  assert.equal(error.fix_back_eligible, false);
  assert.match(error.error, /Usage: node workflow-preparation.mjs/u);
  assert.doesNotMatch(result.stderr, /ExperimentalWarning/u);
});

for (const fail of [false, true]) {
  test(`#4136 helper import: SQLite load ${fail ? 'fails' : 'succeeds'} -> preserves other warnings, restoration and errors`, (t) => {
    const f = sqliteWarningFixture(t, { otherWarnings: true, fail });
    const driver = `
try {
  await import(${JSON.stringify(new URL('./lane-v4-cli.mjs', import.meta.url).href)});
  process.stdout.write('loaded\\n');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}`;

    const result = f.run(['--input-type=module', '-e', driver]);

    assert.equal(result.error, undefined);
    assert.equal(result.status, fail ? 1 : 0, result.stderr);
    assert.equal(result.stdout, fail ? '' : 'loaded\n');
    assert.doesNotMatch(result.stderr, /SQLITE_LOAD_(STRING|OPTIONS|ERROR)/u);
    assert.match(result.stderr, /\[OTHER_EXPERIMENTAL\] ExperimentalWarning: Other experimental feature/u);
    assert.match(result.stderr, /\[OTHER_TYPE\] Warning: SQLite is an experimental feature/u);
    assert.match(result.stderr, /\[OTHER_ERROR_TYPE\] CustomWarning: SQLite is an experimental feature/u);
    assert.match(result.stderr, /\[ORDINARY_WARNING\] Warning: Ordinary load warning/u);
    assert.match(result.stderr, /Keep warning details/u);
    assert.match(result.stderr, /\[AFTER_SQLITE_LOAD\] ExperimentalWarning: SQLite is an experimental feature/u);
    assert.match(result.stderr, /\[AFTER_OTHER_WARNING\] Warning: Warning after load/u);
    if (fail) assert.match(result.stderr, /Error: SQLite load fixture failed/u);
  });
}

test('#4128 CLI review admission: missing or empty PASS evidence -> both writers preserve lane bytes', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  const valid = f.review();
  for (const patch of [{ evidence: [] }, { observations: [''] }, { evidence: undefined, observations: undefined }]) {
    const invalid = structuredClone(valid);
    Object.assign(invalid.reviews[0], patch);
    const before = readFileSync(f.lanePath);

    f.set('review', invalid, valid.head_sha, false);
    f.cli('record', [...f.common, '--phase', 'review',
      '--result-json', JSON.stringify({ ok: true, ...invalid })], false);

    assert.deepEqual(readFileSync(f.lanePath), before);
  }
  valid.reviews[0].observations = ['Optional baseline observation'];
  f.cli('record', [...f.common, '--phase', 'review', '--result-json', JSON.stringify({ ok: true, ...valid })]);
  f.set('review', valid, valid.head_sha);
  const stored = JSON.parse(readFileSync(f.lanePath)).issues['42'].facts.review.value;
  assert.equal(stored.verdict, 'pass');
  assert.deepEqual(stored.reviews, valid.reviews);
});

function retentionFixture(t) {
  const f = fixture(t);
  f.set('preflight', f.preflight({ active_axes: ['contract', 'code', 'verification'] }));
  f.implement();
  f.commit('src/router.ts', 'export const value = 1;\n');
  f.commit('docs/guides/routing.md', '# Routing\n');
  const input = f.review();
  f.set('review', input, input.head_sha);
  const previous = JSON.parse(readFileSync(f.lanePath)).issues['42'].facts.review;
  return { ...f, previous };
}

test('#4099 CLI: disjoint upstream merge plus prose -> contract dispatch, retained bytes and new-head CI', (t) => {
  const f = retentionFixture(t);
  mkdirSync(join(f.root, 'src'), { recursive: true });
  writeFileSync(join(f.root, 'src/upstream.ts'), 'export const upstream = true;\n');
  f.git(f.root, 'add', 'src/upstream.ts');
  f.git(f.root, 'commit', '-m', 'upstream only');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  f.git(f.worktree, 'merge', '--no-edit', 'main');
  f.commit('docs/guides/routing.md', '# Routing\n\nNew explanation.\n');
  const row = f.plan();
  const head = row.obs.headSha;
  const proof = row.obs.reviewRetention;

  assert.deepEqual(Object.keys(row.decision.dispatch), ['contract']);
  assert.deepEqual(row.decision.policy.active_axes, ['contract', 'code', 'verification']);
  assert.deepEqual(proof.changed_files, ['docs/guides/routing.md']);
  assert.deepEqual(proof.previous_review, f.previous.value);
  assert.equal(proof.previous_accepted_at, f.previous.accepted_at);
  assert.notEqual(proof.previous_merge_base_sha, proof.new_merge_base_sha);
  assert.deepEqual(proof.compared_files.map((file) => file.path), ['docs/guide.md', 'src/router.ts']);
  assert.equal(row.obs.localChecks, null);
  f.cli('record', [...f.common, '--phase', 'resolve-conflict', '--result-json', JSON.stringify({ ok: true, head_sha: head })]);
  const fresh = { head_sha: head, preflight_sha256: row.decision.policy.sha256,
    active_axes: row.decision.policy.active_axes, reviews: [{ ...f.previous.value.reviews[0], reviewed_head_sha: head }] };
  f.cli('record', [...f.common, '--phase', 'review', '--result-json', JSON.stringify({ ok: true, ...fresh })]);
  f.set('review', fresh, head);
  const stored = JSON.parse(readFileSync(f.lanePath)).issues['42'].facts.review;
  assert.deepEqual(stored.value.retention, proof);
  assert.equal(stored.value.reviews.length, 1);
  assert.equal(f.plan().decision.action, 'create-pr');
  f.state.pr = { number: 77, state: 'OPEN', headRefOid: head, mergeable: 'MERGEABLE', statusCheckRollup: [] };
  f.update();
  assert.equal(f.plan().decision.action, 'wait-ci');
  f.commit('docs/guides/routing.md', '# Routing\n\nThird explanation.\n');
  const next = f.plan();
  assert.deepEqual(Object.keys(next.decision.dispatch), ['contract']);
  assert.deepEqual(next.obs.reviewRetention.previous_review, stored.value);
  assert.equal(next.obs.localChecks, null);
  const third = { ...fresh, head_sha: next.obs.headSha,
    reviews: [{ ...fresh.reviews[0], reviewed_head_sha: next.obs.headSha }] };
  f.set('review', third, next.obs.headSha);
  assert.equal(f.plan().decision.action, 'push');
});

test('#4099 fix-back CLI: only uppercase governance authored delta -> full policy dispatch without retention', (t) => {
  const f = retentionFixture(t);
  f.commit('docs/guides/GOVERNANCE.md', '# Review requirements\n');

  const row = f.plan();

  assert.deepEqual(row.obs.changedFiles, ['docs/guide.md', 'docs/guides/GOVERNANCE.md', 'docs/guides/routing.md', 'src/router.ts']);
  assert.deepEqual(f.git(f.worktree, 'diff', '--name-only', '--no-renames', f.previous.head, row.obs.headSha),
    'docs/guides/GOVERNANCE.md');
  assert.deepEqual(row.decision.policy.active_axes, ['contract', 'code', 'verification']);
  assert.deepEqual(Object.keys(row.decision.dispatch), ['contract', 'code', 'verification']);
  assert.equal(row.obs.reviewRetention, undefined);
});

for (const [role, path, bytes] of [
  ['runtime', 'src/router.ts', 'export const value = 2;\n'],
  ['test', 'tests/router.test.ts', 'test input\n'],
  ['fixture Markdown', 'docs/guides/fixtures/input.md', '# Fixture\n'],
  ['generated Markdown', 'docs/guides/generated/routes.md', '# Routes\n'],
  ['manifest', 'src/package.json', '{}\n'],
  ['instruction', 'docs/guides/AGENTS.md', '# Instructions\n'],
  ['context', 'docs/guides/CONTEXT.md', '# Context\n'],
  ['skill', 'docs/guides/SKILL.md', '# Skill\n'],
  ['governance', 'docs/guides/governance.md', '# Governance\n'],
  ['MDX', 'docs/guides/routes.mdx', '# Routes\n'],
  ['unknown', 'docs/unknown.md', '# Unknown\n'],
  ['machine sentinel', 'docs/guides/routing.md', '<!-- machine:routes -->\n'],
  ['generated header', 'docs/guides/routing.md', '<!-- auto-generated; do not edit -->\n'],
]) {
  test(`#4099 CLI: ${role} delta -> full review`, (t) => {
    const f = retentionFixture(t);
    f.commit(path, bytes);

    const row = f.plan();

    assert.deepEqual(Object.keys(row.decision.dispatch), ['contract', 'code', 'verification']);
    assert.equal(row.obs.reviewRetention, undefined);
  });
}

for (const mutation of ['delete', 'rename', 'mode', 'symlink', 'dirty', 'moved-checkout', 'missing-object', 'source-consumer']) {
  test(`#4099 CLI: ${mutation} observation -> no retention`, (t) => {
    const f = retentionFixture(t);
    f.commit('docs/guides/routing.md', '# New routing\n');
    if (mutation === 'dirty') writeFileSync(join(f.worktree, 'src/router.ts'), 'dirty\n');
    else if (mutation === 'moved-checkout') f.git(f.worktree, 'checkout', '--detach', f.previous.head);
    else if (mutation === 'missing-object') {
      const lane = JSON.parse(readFileSync(f.lanePath));
      const old = lane.issues['42'].facts.review;
      old.head = 'f'.repeat(40);
      old.value.head = old.head;
      old.value.head_sha = old.head;
      for (const review of old.value.reviews) review.reviewed_head_sha = old.head;
      writeFileSync(f.lanePath, JSON.stringify(lane));
    } else {
      if (mutation === 'delete') rmSync(join(f.worktree, 'src/router.ts'));
      if (mutation === 'rename') f.git(f.worktree, 'mv', 'src/router.ts', 'src/moved.ts');
      if (mutation === 'mode') chmodSync(join(f.worktree, 'src/router.ts'), 0o755);
      if (mutation === 'symlink') {
        rmSync(join(f.worktree, 'src/router.ts'));
        symlinkSync('other.ts', join(f.worktree, 'src/router.ts'));
      }
      if (mutation === 'source-consumer') writeFileSync(join(f.worktree, 'src/read.mjs'), "readFileSync('docs/guides/routing.md');\n");
      f.git(f.worktree, 'add', '-A');
      f.git(f.worktree, 'commit', '-m', mutation);
    }

    const row = f.plan();

    assert.deepEqual(Object.keys(row.decision.dispatch), ['contract', 'code', 'verification']);
    assert.equal(row.obs.reviewRetention, undefined);
  });
}

test('#4099 CLI: source consumer already reviewed -> prose update still requires full axes', (t) => {
  const f = retentionFixture(t);
  f.commit('src/read.mjs', "readFileSync('docs/guides/routing.md');\n");
  const input = f.review();
  f.set('review', input, input.head_sha);
  f.commit('docs/guides/routing.md', '# Changed machine input\n');

  assert.deepEqual(Object.keys(f.plan().decision.dispatch), ['contract', 'code', 'verification']);
});

for (const mutation of ['missing-PASS', 'BLOCK', 'NEEDS-HUMAN-CHECK', 'policy-change', 'contract-change', 'unrelated-history']) {
  test(`#4099 CLI: ${mutation} -> full review without fabricated retained approval`, (t) => {
    const f = retentionFixture(t);
    f.commit('docs/guides/routing.md', '# New routing\n');
    const lane = JSON.parse(readFileSync(f.lanePath));
    const fact = lane.issues['42'].facts.review;
    if (mutation === 'missing-PASS') delete lane.issues['42'].facts.review;
    if (mutation === 'BLOCK') {
      const blocker = { reviewer: 'code', signature: 'route:order', evidence: 'src/router.ts:1',
        fix_back_eligible: true, status: 'unresolved' };
      fact.value.verdict = 'block';
      fact.value.blockers = [blocker];
      fact.value.reviews[1].verdict_signal = 'BLOCK';
      fact.value.reviews[1].blockers = [blocker];
    }
    if (mutation === 'NEEDS-HUMAN-CHECK') {
      fact.value.verdict = 'needs-human-check';
      fact.value.reviews[1].verdict_signal = 'NEEDS-HUMAN-CHECK';
    }
    if (mutation === 'policy-change') fact.value.preflight_sha256 = '0'.repeat(64);
    if (mutation === 'contract-change') {
      const previous = lane.issues['42'].facts.preflight.value;
      lane.issues['42'].facts.preflight.value = createPreflight({ ...previous, acceptance: ['Updated route contract'] });
    }
    if (mutation === 'unrelated-history') {
      const commit = f.git(f.root, 'commit-tree', `${f.previous.head}^{tree}`, '-m', 'unrelated review source');
      fact.head = commit;
      fact.value.head = commit;
      fact.value.head_sha = commit;
      for (const review of fact.value.reviews) review.reviewed_head_sha = commit;
    }
    writeFileSync(f.lanePath, JSON.stringify(lane));

    const row = f.plan();

    assert.deepEqual(Object.keys(row.decision.dispatch), ['contract', 'code', 'verification']);
    assert.equal(row.obs.reviewRetention, undefined);
  });
}

test('#4099 CLI: upstream modifies issue-authored runtime -> comparison cannot exclude it as upstream-only', (t) => {
  const f = retentionFixture(t);
  mkdirSync(join(f.root, 'src'), { recursive: true });
  writeFileSync(join(f.root, 'src/router.ts'), 'export const value = 2;\n');
  f.git(f.root, 'add', 'src/router.ts');
  f.git(f.root, 'commit', '-m', 'upstream runtime');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.throws(() => f.git(f.worktree, 'merge', '--no-edit', 'main'));
  f.commit('src/router.ts', 'export const value = 2;\n');
  f.commit('docs/guides/routing.md', '# New routing\n');

  const row = f.plan();

  assert.deepEqual(Object.keys(row.decision.dispatch), ['contract', 'code', 'verification']);
  assert.equal(row.obs.reviewRetention, undefined);
});

test('#4099 CLI: retained manifest tampering and caller claims -> rejection without lane write', (t) => {
  const f = retentionFixture(t);
  f.commit('docs/guides/routing.md', '# New routing\n');
  const row = f.plan();
  const fresh = { head_sha: row.obs.headSha, preflight_sha256: row.obs.preflightPolicy.sha256,
    active_axes: row.obs.preflightPolicy.active_axes,
    reviews: [{ ...f.previous.value.reviews[0], reviewed_head_sha: row.obs.headSha }] };
  for (const claim of [{ retention: row.obs.reviewRetention }, { changed_files: [] }, { docs_only: true }]) {
    const before = readFileSync(f.lanePath);
    f.set('review', { ...fresh, ...claim }, row.obs.headSha, false);
    f.cli('record', [...f.common, '--phase', 'review', '--result-json', JSON.stringify({ ok: true, ...fresh, ...claim })], false);
    assert.deepEqual(readFileSync(f.lanePath), before);
  }
  f.set('review', fresh, row.obs.headSha);
  const good = JSON.parse(readFileSync(f.lanePath));
  for (const mutate of [
    (proof) => { proof.compared_files = []; },
    (proof) => { proof.compared_files.push(proof.compared_files[0]); },
    (proof) => { proof.compared_files[0].previous_sha256 = '0'.repeat(64); },
    (proof) => { proof.compared_files[0].previous_mode = '100755'; },
    (proof) => { proof.changed_files = ['docs/guides/forged.md']; },
    (proof) => { proof.previous_review.reviews[1].verdict_signal = 'NEEDS-HUMAN-CHECK'; },
  ]) {
    const invalid = structuredClone(good);
    mutate(invalid.issues['42'].facts.review.value.retention);
    writeFileSync(f.lanePath, JSON.stringify(invalid));
    assert.deepEqual(Object.keys(f.plan().decision.dispatch), ['contract', 'code', 'verification']);
  }
});

test('#4099 CLI: head movement after reduced plan -> stale admission rejected', (t) => {
  const f = retentionFixture(t);
  f.commit('docs/guides/routing.md', '# New routing\n');
  const row = f.plan();
  const fresh = { head_sha: row.obs.headSha, preflight_sha256: row.obs.preflightPolicy.sha256,
    active_axes: row.obs.preflightPolicy.active_axes,
    reviews: [{ ...f.previous.value.reviews[0], reviewed_head_sha: row.obs.headSha }] };
  f.commit('src/router.ts', 'export const value = 3;\n');
  const before = readFileSync(f.lanePath);

  f.set('review', fresh, row.obs.headSha, false);
  f.cli('record', [...f.common, '--phase', 'review', '--result-json', JSON.stringify({ ok: true, ...fresh })], false);

  assert.deepEqual(readFileSync(f.lanePath), before);
  assert.deepEqual(Object.keys(f.plan().decision.dispatch), ['contract', 'code', 'verification']);
});

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
const fixture = (t, isolatedOrchestrator = false, parent = process.env.FLUO_PRODUCT_TEST_EVIDENCE ?? tmpdir(), realRepository = false) => {
  mkdirSync(parent, { recursive: true });
  const root = realpathSync(mkdtempSync(join(parent, 'fluo-lane-v4-')));
  if (!process.env.FLUO_PRODUCT_TEST_EVIDENCE) t.after(() => rmSync(root, { recursive: true, force: true }));
  if (realRepository) {
    execFileSync('git', ['clone', '--shared', '--no-checkout', new URL('../../../../', import.meta.url).pathname, root],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['switch', '-c', 'main', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  const bin = join(root, 'bin');
  mkdirSync(bin);
  mkdirSync(join(root, '.omo'), { recursive: true });
  cpSync(new URL('../../../../.omo/omo.jsonc', import.meta.url), join(root, '.omo/omo.jsonc'));
  const ghState = join(root, 'gh.json');
  const ghLog = join(root, 'gh.log');
  const state = { issue: { state: 'OPEN', title: 'Document route precedence', body: 'Keep route precedence stable.' }, pr: null,
    run: { id: 101, run_attempt: 1, path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success' } };
  const update = () => writeFileSync(ghState, JSON.stringify(state));
  update();
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}\nimport { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.GH_LOG, JSON.stringify(args) + '\\n');
const state = JSON.parse(readFileSync(process.env.GH_STATE));
const subject = args[0] === 'issue' && args[2] !== '42' ? args[2] : args[0];
if (state.unavailable || state.fail === subject) process.exit(1);
if (state.malformed === subject) { process.stdout.write('{}'); process.exit(0); }
if (args[0] === 'repo' && args[1] === 'view' && args.includes('nameWithOwner')) {
  process.stdout.write(JSON.stringify(state.externalRepository ?? { nameWithOwner: 'fluojs/fluo' }));
} else if (args[0] === 'api' && args[1] === 'graphql' && args.some(arg => arg.includes('ExternalOverlapPullRequests'))) {
  if (process.env.GH_PAGER !== 'cat') process.exit(3);
  process.stdout.write(JSON.stringify(Object.hasOwn(state, 'externalPrs') ? state.externalPrs : { data: { repository: { pullRequests: {
    totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } } }));
  if (state.externalPrExit) process.exit(state.externalPrExit);
} else if (args[0] === 'api' && args[1] === 'graphql' && args.some(arg => arg.includes('ExternalOverlapIssues'))) {
  if (process.env.GH_PAGER !== 'cat') process.exit(3);
  process.stdout.write(JSON.stringify(state.externalIssues ?? { data: { repository: {} } }));
} else if (args[0] === 'pr' && args[1] === 'view') {
  const pr = Object.hasOwn(state.prs ?? {}, args[2]) ? state.prs[args[2]] : state.pr;
  if (!pr) { process.stderr.write('no pull requests found for branch "' + args[2] + '"'); process.exit(1); }
  process.stdout.write(JSON.stringify(pr));
} else if (args[0] === 'issue' && args[1] === 'view') {
  const issue = state.issues?.[args[2]] ?? state.issue;
  process.stdout.write(args.includes('--jq') ? issue.state : JSON.stringify(issue));
} else if (args[0] === 'api' && args[1] === '--paginate' && args[2] === '--slurp'
  && /^repos\\/\\{owner\\}\\/\\{repo\\}\\/actions\\/runs\\?branch=[^&]+&event=pull_request&per_page=100$/.test(args[3])
  && args.length === 4) {
  if (Object.hasOwn(state, 'actionsRaw')) { process.stdout.write(state.actionsRaw); process.exit(0); }
  const branch = new URLSearchParams(args[3].split('?')[1]).get('branch');
  const pr = Object.hasOwn(state.prs ?? {}, branch) ? state.prs[branch] : state.pr;
  process.stdout.write(JSON.stringify(Object.hasOwn(state, 'actionsPages') ? state.actionsPages : [
    { total_count: 1, workflow_runs: [{ head_sha: pr.headRefOid, ...state.run }] },
  ]));
} else { process.stderr.write('unexpected gh invocation'); process.exit(2); }
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_STATE: ghState, GH_LOG: ghLog,
    GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }).trim();
  if (!realRepository) git(root, 'init', '-b', 'main');
  writeFileSync(join(root, '.gitignore'),
    `${existsSync(join(root, '.gitignore')) ? readFileSync(join(root, '.gitignore'), 'utf8') : ''}\nbin/\ngh.json\ngh.log\n.omo/\n.worktrees/\n`);
  mkdirSync(join(root, 'docs'), { recursive: true });
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
    for (const file of ['tooling/governance/package-production-inputs.mjs', 'tooling/release/release-intents.mjs']) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      cpSync(new URL(`../../../../${file}`, import.meta.url), join(root, file));
    }
  }
  if (realRepository) {
    cpSync(new URL('../../../../tooling/governance/package-production-inputs.json', import.meta.url),
      join(root, 'tooling/governance/package-production-inputs.json'));
  } else writeProductionDeclaration(root, []);
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
    if (result.status === 0 && ['plan', 'plan-all', 'watch'].includes(command)) {
      const saved = JSON.parse(readFileSync(args[args.indexOf('--lane') + 1]));
      if (saved.preflight_overlap === 1) {
        const value = command === 'watch' ? null : JSON.parse(result.stdout);
        const rows = command === 'watch'
          ? [...result.stdout.matchAll(/issue (\d+): [^\n]* -> review(?=\s|$)/gu)]
            .map(match => ({ issue: Number(match[1]), decision: { action: 'review' } }))
          : command === 'plan' ? [value] : Array.isArray(value) ? value : value.issues;
        for (const row of rows.filter(row => row.decision.action === 'review')) {
          const entry = saved.issues[String(row.issue)];
          const accepted = entry.facts.preflight.value;
          const head = git(root, 'rev-parse', entry.branch);
          const policy = row.decision.policy ?? evaluatePreflight(accepted, {
            issue: row.issue, issueSha256: accepted.issue_sha256, baseSha: accepted.base_sha,
            changedFiles: git(root, 'diff', '--name-only', accepted.base_sha, head).split('\n').filter(Boolean),
            reviewAxisFloor: entry.facts.review?.value?.active_axes ?? [],
          }).policy;
          const fact = entry.facts['review-readiness'];
          assert.ok(fact, `returned review ${row.issue} requires a saved grant`);
          assert.equal(fact.head, head);
          assert.equal(fact.value.policy_sha256, policy.sha256);
          assert.equal(fact.value.active, true);
          assert.equal(Number.isSafeInteger(fact.value.sequence) && fact.value.sequence > 0, true);
        }
      }
    }
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
        preflight_sha256: obs.preflightPolicy.sha256, verdict_signal: 'PASS', blockers: [],
        evidence: [{ acceptance: 'Keep public behavior', locations: ['docs/guide.md:1'] }], observations: [] })) };
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

test('#4154 real monorepo: #4151 test-only diff -> review without Changeset', (t) => {
  const f = fixture(t, false, undefined, true);
  const input = 'packages/cli/scripts/local-test-env.test.mjs';
  const rootBuild = JSON.parse(readFileSync(join(f.root, 'package.json'), 'utf8')).scripts.build;
  const cliBuild = JSON.parse(readFileSync(join(f.root, 'packages/cli/package.json'), 'utf8')).scripts.prebuild;
  assert.equal(rootBuild, "pnpm -r --filter './packages/*' --if-present run build");
  assert.match(cliBuild, /generate-published-internal-dependencies\.mjs/u);
  assert.ok(f.git(f.root, 'ls-files', '.github/workflows/ci.yml', 'packages/react/src/index.ts').includes('packages/react/src/index.ts'));
  f.set('preflight', f.preflight({ scope: ['packages/cli/scripts/'], predicted_files: [input] }));
  f.git(f.root, 'worktree', 'add', '-b', 'issue-42', f.worktree, 'main');
  f.commit(input, `${readFileSync(join(f.worktree, input), 'utf8')}\n// test-only change\n`);

  assert.deepEqual(f.git(f.worktree, 'diff', '--name-only', 'origin/main', 'HEAD').split('\n'), [input]);
  const row = f.plan();
  assert.equal(row.obs.publicPackagesTouched, false);
  assert.equal(row.obs.changesetPresent, false);
  assert.equal(row.decision.action, 'review');
});

test('#4154 declared-production-input: stale parent -> repaired head preserves coverage', (t) => {
  const f = fixture(t);
  const declarationPath = 'tooling/governance/package-production-inputs.json';
  const producer = 'tooling/build.mjs';
  const input = 'packages/cli/scripts/check.test.mjs';
  const unconsumed = 'packages/cli/scripts/unconsumed.test.mjs';
  mkdirSync(join(f.root, 'packages/cli/scripts'), { recursive: true });
  writeFileSync(join(f.root, 'packages/cli/package.json'), JSON.stringify({
    name: '@fluojs/cli', type: 'module', files: ['dist'],
    publishConfig: { access: 'public' }, scripts: { build: 'node ../../tooling/build.mjs' },
  }));
  writeFileSync(join(f.root, input), 'export default 1;\n');
  writeFileSync(join(f.root, unconsumed), '// nonshipping\n');
  writeFileSync(join(f.root, producer), '// existing reader\n');
  const declare = () => writeProductionDeclaration(f.root, [{
    name: '@fluojs/cli', inputs: [],
    nonProduction: [{ path: 'packages/cli/', testsOnly: true }],
  }], [{
    id: 'cli-build', consumers: ['@fluojs/cli'],
    inputs: [{ path: input, excludeTests: false }], definitions: [producer],
  }], ['packages/cli/package.json']);
  const commit = message => {
    f.git(f.root, 'add', 'packages', 'tooling');
    f.git(f.root, 'commit', '-m', message);
    return f.git(f.root, 'rev-parse', 'HEAD');
  };
  declare();
  commit('existing declared reader');
  writeFileSync(join(f.root, producer), '// changed reader\n');
  const stale = commit('A changes producer before refreshing declaration');
  assert.throws(() => enforcePackageProductionInputs(f.root), /stale producer definition/u);
  assert.equal(productionInputClassifier(f.root)(unconsumed), true);
  declare();
  const repaired = commit('B refreshes only the producer digest');
  const repairedDeclaration = readFileSync(join(f.root, declarationPath), 'utf8');
  assert.equal(f.git(f.root, 'diff', '--name-only', stale, repaired), declarationPath);

  assert.doesNotThrow(() => enforcePackageProductionInputs(f.root),
    'a fresh current head must be accepted after a stale parent is repaired');
  assert.equal(productionInputClassifier(f.root, repaired, stale)(unconsumed), false);
  assert.equal(productionInputClassifier(f.root, repaired, stale)(input), true);
  assert.throws(() => enforcePackageProductionInputs(f.root, stale), /stale producer definition/u);

  const narrowed = JSON.parse(repairedDeclaration);
  narrowed.producers[0].inputs = [];
  writeFileSync(join(f.root, declarationPath), JSON.stringify(narrowed));
  commit('remove previously covered input');
  assert.throws(() => enforcePackageProductionInputs(f.root), /removed or narrowed production input/u);
  assert.equal(productionInputClassifier(f.root, 'HEAD', repaired)(unconsumed), true);
  assert.equal(productionInputClassifier(f.root, 'HEAD', repaired)(input), true);

  writeFileSync(join(f.root, declarationPath), '{}');
  const unusable = commit('unusable historical declaration');
  writeFileSync(join(f.root, declarationPath), repairedDeclaration);
  commit('restore declaration after unusable history');
  assert.throws(() => enforcePackageProductionInputs(f.root), /invalid declaration fields/u);
  assert.equal(productionInputClassifier(f.root, 'HEAD', unusable)(unconsumed), true);
});

for (const extension of ['mjs', 'cjs', 'js']) {
  test(`#4154 declared-production-input: .${extension} copied by existing producer -> changeset required`, (t) => {
    const f = fixture(t);
    const input = `packages/cli/scripts/check.test.${extension}`;
    const producer = 'packages/cli/scripts/build.mjs';
    mkdirSync(join(f.root, 'packages/cli/scripts'), { recursive: true });
    writeFileSync(join(f.root, 'packages/cli/package.json'), JSON.stringify({
      name: '@fluojs/cli', type: 'module', files: ['dist'],
      publishConfig: { access: 'public' }, scripts: { build: 'node scripts/build.mjs' },
    }));
    writeFileSync(join(f.root, input), "globalThis.fixtureValue = 'base';\n");
    writeFileSync(join(f.root, 'packages/cli/scripts/unconsumed.test.mjs'), '// nonshipping\n');
    writeFileSync(join(f.root, producer),
      "import { cpSync, mkdirSync } from 'node:fs';\nmkdirSync('dist', { recursive: true });\n" +
      `cpSync('scripts/check.test.${extension}', 'dist/index.js');\n`);
    writeProductionDeclaration(f.root, [{
      name: '@fluojs/cli', inputs: [],
      nonProduction: [{ path: 'packages/cli/', testsOnly: true }],
    }], [{
      id: 'cli-build', consumers: ['@fluojs/cli'],
      inputs: [{ path: input, excludeTests: false }], definitions: [producer],
    }], ['packages/cli/package.json']);
    f.git(f.root, 'add', 'packages', 'tooling/governance/package-production-inputs.json');
    f.git(f.root, 'commit', '-m', 'existing declared producer');
    f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    f.set('preflight', f.preflight({ scope: ['packages/', '.changeset/'], predicted_files: [input] }));
    f.git(f.root, 'worktree', 'add', '-b', 'issue-42', f.worktree, 'main');
    const build = () => {
      execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: join(f.worktree, 'packages/cli'), env: f.env });
      const output = readFileSync(join(f.worktree, 'packages/cli/dist/index.js'), 'utf8');
      rmSync(join(f.worktree, 'packages/cli/dist'), { recursive: true });
      return output;
    };
    assert.equal(build(), "globalThis.fixtureValue = 'base';\n");
    f.commit(input, "globalThis.fixtureValue = 'changed';\n");
    assert.deepEqual(f.git(f.worktree, 'diff', '--name-only', 'origin/main', 'HEAD').split('\n'), [input]);
    assert.equal(build(), "globalThis.fixtureValue = 'changed';\n");

    assert.equal(isConsumerVisibleFile(input, { root: f.root, head: f.git(f.worktree, 'rev-parse', 'HEAD') }), true);
    assert.equal(isConsumerVisibleFile('packages/cli/scripts/unconsumed.test.mjs',
      { root: f.root, head: f.git(f.worktree, 'rev-parse', 'HEAD') }), false);
    const row = f.plan();
    assert.equal(row.obs.publicPackagesTouched, true);
    assert.equal(row.obs.changesetPresent, false);
    assert.equal(row.decision.action, 'fix-back');
    assert.equal(row.decision.reason, 'changeset-missing');
    f.commit('.changeset/consumer.md', '---\n"@fluojs/cli": patch\n---\nUpdate generated output.\n');
    assert.equal(f.plan().decision.action, 'review');
  });
}

for (const scenario of [
  { name: 'JavaScript test only', files: ['scripts/local-test-env.test.mjs'], visible: false },
  { name: 'development script only', files: ['scripts/check.mjs'], visible: false, developmentOnly: true },
  { name: 'production source mixed with test', files: ['scripts/check.test.js', 'src/adapter.ts'], visible: true, firstVisible: false },
  { name: 'generation input outside files', files: ['scripts/generate.mjs'], visible: true },
  { name: 'unclassified script', files: ['scripts/unknown.mjs'], visible: true },
  { name: 'template test copied into output', files: ['src/new/templates/app.test.js'], visible: true },
  { name: 'packed Markdown', files: ['dist/guide.md'], visible: true },
  { name: 'packed script test', files: ['bin/check.test.cjs'], visible: true },
  { name: 'missing manifest after deletion', files: ['scripts/check.mjs'], visible: true, metadata: 'deleted' },
  { name: 'invalid manifest', files: ['scripts/check.mjs'], visible: true, metadata: 'invalid' },
  { name: 'unsupported files pattern', files: ['scripts/check.mjs'], visible: true, metadata: 'glob' },
  { name: 'runtime references development entry', files: ['scripts/check.mjs', 'src/runtime.ts'], visible: true },
  { name: 'build helper references development entry', files: ['scripts/check.mjs', 'scripts/build.mjs'], visible: true },
  ...['deleted', 'glob', 'literal'].flatMap(packaging =>
    ['test/helper.ts', 'fixtures/data.json'].map(file => ({
      name: `${packaging} packaging with ${file}`, files: [file],
      visible: packaging !== 'literal', packaging,
    }))),
  { name: 'indirect Markdown copy through build helper', files: ['src/assets/guide.md'], visible: true, buildCopy: true },
  ...['CHANGELOG.md', 'design-rfc.md', 'design-rfc.ko.md'].map(file => ({
    name: `root notes copied through helper ${file}`, files: [file],
    visible: true, buildCopy: true, copyInput: file,
  })),
  { name: 'relative dynamic import reaches development script', files: ['scripts/check.mjs'], visible: true, dynamicBuild: true },
  { name: 'unclassified root Markdown input', files: ['input.md'], visible: true },
  { name: 'nonshipping root documentation', files: ['CHANGELOG.md'], visible: false, developmentOnly: true },
  { name: 'isolated root notes without filename exemption', files: ['notes.md'], visible: false, developmentOnly: true },
  { name: 'nonshipping notes mixed with declared production source', files: ['CHANGELOG.md', 'src/runtime.ts'], visible: true, firstVisible: false, developmentOnly: true },
  { name: 'changed runtime entrypoint invalidates declaration', files: ['CHANGELOG.md'], visible: true, developmentOnly: true, runtimeEntry: true },
  ...['root', 'sibling'].flatMap(externalConsumer =>
    ['CHANGELOG.md', 'scripts/check.mjs'].map(file => ({
      name: `${externalConsumer} computed consumer of ${file}`, files: [file],
      visible: true, developmentOnly: true, externalConsumer,
    }))),
  ...['tooling/ci/unrelated.mjs', '.agents/opaque/build.mjs'].map(externalDefinition => ({
    name: `stale external producer definition ${externalDefinition}`, files: ['CHANGELOG.md'],
    visible: true, developmentOnly: true, externalDefinition,
  })),
]) {
  test(`#4154 CLI: ${scenario.name} -> observed consumer impact and changeset plan`, (t) => {
    const f = fixture(t);
    if (scenario.developmentOnly) {
      // Keep the executable harness on disk, outside this scenario's observed
      // repository. Only explicitly added package/consumer files form its base.
      writeFileSync(join(f.root, '.gitignore'),
        `${readFileSync(join(f.root, '.gitignore'), 'utf8')}.gitignore\n/docs/\n/tooling/\n/.agents/\n`);
      f.git(f.root, 'rm', '-r', '--cached', '.');
    }
    const manifest = { name: '@fluojs/cli', publishConfig: { access: 'public' },
      files: scenario.packaging === 'glob' ? ['test/**', 'fixtures/**'] : ['dist', 'bin'],
      scripts: scenario.buildCopy ? { build: 'node scripts/build.mjs' }
        : scenario.dynamicBuild ? { build: 'node scripts/run.mjs', 'sandbox:check': 'node ./scripts/check.mjs' }
          : scenario.developmentOnly ? { 'sandbox:check': 'node ./scripts/check.mjs' }
            : { 'sandbox:check': 'node ./scripts/check.mjs', prebuild: 'node ./scripts/generate.mjs' },
    };
    mkdirSync(join(f.root, 'packages/cli'), { recursive: true });
    writeFileSync(join(f.root, 'packages/cli/package.json'), JSON.stringify(manifest));
    if (scenario.buildCopy) {
      mkdirSync(join(f.root, 'packages/cli/scripts'), { recursive: true });
      writeFileSync(join(f.root, 'packages/cli/scripts/build.mjs'),
        "import { cpSync, mkdirSync } from 'node:fs';\nmkdirSync('dist', { recursive: true });\n" +
        `cpSync(${JSON.stringify(scenario.copyInput ?? 'src/assets')}, ${JSON.stringify(scenario.copyInput ? 'dist/release-notes.md' : 'dist/assets')}, { recursive: true });\n`);
    }
    if (scenario.dynamicBuild || scenario.developmentOnly) {
      mkdirSync(join(f.root, 'packages/cli/scripts'), { recursive: true });
      writeFileSync(join(f.root, 'packages/cli/scripts/check.mjs'), '// development command\n');
    }
    if (!scenario.developmentOnly && !scenario.buildCopy && !scenario.dynamicBuild) {
      mkdirSync(join(f.root, 'packages/cli/scripts'), { recursive: true });
      writeFileSync(join(f.root, 'packages/cli/scripts/check.mjs'), '// development command\n');
      writeFileSync(join(f.root, 'packages/cli/scripts/generate.mjs'), '// production generator\n');
    }
    if (scenario.dynamicBuild) {
      writeFileSync(join(f.root, 'packages/cli/scripts/run.mjs'),
        "const name='check';\nawait import(`./${name}.mjs`);\n");
    }
    const externalScript = scenario.externalConsumer && scenario.files[0].endsWith('.mjs');
    const externalHelper = scenario.externalConsumer === 'root'
      ? 'tooling/build.mjs' : 'packages/builder/scripts/build.mjs';
    const externalOutput = scenario.externalConsumer === 'root' ? 'packages/cli/dist' : 'packages/builder/dist';
    if (scenario.externalConsumer) {
      writeFileSync(join(f.root, 'packages/cli', scenario.files[0]),
        externalScript ? "export const content = 'base';\n" : '// base\n');
      mkdirSync(dirname(join(f.root, externalHelper)), { recursive: true });
      const prefix = scenario.externalConsumer === 'root' ? '../packages/' : '../../';
      writeFileSync(join(f.root, externalHelper),
        "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';\n" +
        `const input = new URL(${JSON.stringify(prefix)} + ['c', 'li'].join('') + '/' + ` +
        (externalScript ? "'scripts/' + ['ch', 'eck'].join('') + '.mjs'" : "['CHANGE', 'LOG.md'].join('')") +
        ", import.meta.url);\n" +
        `const output = new URL(${JSON.stringify(scenario.externalConsumer === 'root' ? '../packages/cli/dist/' : '../dist/')}, import.meta.url);\n` +
        "mkdirSync(output, { recursive: true });\n" +
        `writeFileSync(new URL('result.txt', output), ${externalScript ? '(await import(input.href)).content' : "readFileSync(input, 'utf8')"});\n`);
      const consumerManifest = scenario.externalConsumer === 'root'
        ? 'package.json' : 'packages/builder/package.json';
      writeFileSync(join(f.root, consumerManifest), JSON.stringify({
        name: '@fluojs/builder', files: ['dist'],
        scripts: { build: scenario.externalConsumer === 'root' ? 'node tooling/build.mjs' : 'node scripts/build.mjs' },
      }));
      f.git(f.root, 'add', '-f', externalHelper, consumerManifest);
      execFileSync(process.execPath, [externalHelper], { cwd: f.root, env: f.env });
      assert.equal(readFileSync(join(f.root, externalOutput, 'result.txt'), 'utf8'),
        externalScript ? 'base' : '// base\n');
      rmSync(join(f.root, externalOutput), { recursive: true });
    }
    if (scenario.externalDefinition) {
      mkdirSync(dirname(join(f.root, scenario.externalDefinition)), { recursive: true });
      writeFileSync(join(f.root, scenario.externalDefinition), 'export {};\n');
      f.git(f.root, 'add', '-f', scenario.externalDefinition);
    }
    const packageInputs = scenario.files.filter(file => file.startsWith('src/')).map(file => ({
      path: `packages/cli/${file}`, excludeTests: false,
    }));
    const nonProduction = [{ path: 'packages/cli/', testsOnly: true }];
    if (scenario.developmentOnly) {
      nonProduction.push({ path: 'packages/cli/scripts/check.mjs', testsOnly: false });
      for (const file of scenario.files.filter(file => file.endsWith('.md'))) {
        if (!existsSync(join(f.root, 'packages/cli', file))) writeFileSync(join(f.root, 'packages/cli', file), '// base\n');
        nonProduction.push({ path: `packages/cli/${file}`, testsOnly: false });
      }
    }
    for (const directory of ['test/', 'fixtures/']) {
      if (scenario.files.some(file => file.startsWith(directory))) {
        mkdirSync(join(f.root, 'packages/cli', directory), { recursive: true });
        writeFileSync(join(f.root, 'packages/cli', directory, 'baseline'), 'base\n');
        nonProduction.push({ path: `packages/cli/${directory}`, testsOnly: false });
      }
    }
    const producerInputs = scenario.externalConsumer || scenario.buildCopy || scenario.dynamicBuild
      ? [{ path: `packages/cli/${scenario.files[0]}`, excludeTests: false }] : [];
    for (const input of [...packageInputs, ...producerInputs]) {
      if (!existsSync(join(f.root, input.path))) {
        mkdirSync(dirname(join(f.root, input.path)), { recursive: true });
        writeFileSync(join(f.root, input.path), '// base\n');
      }
    }
    const definitions = scenario.externalConsumer ? [externalHelper]
      : scenario.buildCopy ? ['packages/cli/scripts/build.mjs']
        : scenario.dynamicBuild ? ['packages/cli/scripts/run.mjs']
          : scenario.developmentOnly ? [] : ['packages/cli/scripts/generate.mjs'];
    if (scenario.externalDefinition) definitions.push(scenario.externalDefinition);
    const manifestPaths = ['packages/cli/package.json',
      ...(scenario.externalConsumer === 'root' ? ['package.json'] : []),
      ...(scenario.externalConsumer === 'sibling' ? ['packages/builder/package.json'] : [])];
    writeProductionDeclaration(f.root, [{ name: '@fluojs/cli', inputs: packageInputs, nonProduction }], [{
      id: 'cli-build', consumers: ['@fluojs/cli'], inputs: producerInputs, definitions,
    }], manifestPaths);
    f.git(f.root, 'add', '-f', 'tooling/governance/package-production-inputs.json');
    f.git(f.root, 'add', 'packages');
    f.git(f.root, 'commit', '-m', 'package metadata');
    if (scenario.packaging === 'deleted') {
      f.git(f.root, 'rm', 'packages/cli/package.json');
      f.git(f.root, 'commit', '-m', 'remove package metadata');
    }
    f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    f.set('preflight', f.preflight({ scope: ['docs/', 'packages/', '.changeset/',
      ...(scenario.externalDefinition ? [scenario.externalDefinition] : [])] }));
    f.git(f.root, 'worktree', 'add', '-b', 'issue-42', f.worktree, 'main');
    // The engine checkout deliberately disagrees with the observed issue head.
    mkdirSync(join(f.root, 'packages/cli'), { recursive: true });
    writeFileSync(join(f.root, 'packages/cli/package.json'), JSON.stringify({ ...manifest, files: ['scripts'] }));
    if (scenario.externalDefinition) {
      writeFileSync(join(f.worktree, scenario.externalDefinition), 'export const changed = true;\n');
    }
    if (scenario.runtimeEntry) {
      writeFileSync(join(f.worktree, 'packages/cli/package.json'), JSON.stringify({ ...manifest, exports: './dist/index.js' }));
    }
    if (scenario.metadata === 'deleted') {
      rmSync(join(f.worktree, 'packages/cli/package.json'));
    } else if (scenario.metadata) {
      writeFileSync(join(f.worktree, 'packages/cli/package.json'),
        scenario.metadata === 'invalid' ? '{' : JSON.stringify({ ...manifest, files: ['dist/**'] }));
    }
    for (const file of scenario.files) {
      const path = `packages/cli/${file}`;
      mkdirSync(dirname(join(f.worktree, path)), { recursive: true });
      writeFileSync(join(f.worktree, path), file === 'src/runtime.ts'
        ? "import '../scripts/check.mjs';\n" : file === 'scripts/build.mjs'
          ? "import './check.mjs';\n" : externalScript ? "export const content = 'changed';\n" : scenario.dynamicBuild
            ? "import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('dist', { recursive: true });\nwriteFileSync('dist/result.txt', 'changed');\n"
            : '// changed\n');
      f.git(f.worktree, 'add', '-f', path);
      f.commit(path, readFileSync(join(f.worktree, path), 'utf8'));
    }

    if (scenario.externalConsumer) {
      assert.deepEqual(f.git(f.worktree, 'diff', '--name-only', 'origin/main', 'HEAD').split('\n'),
        [`packages/cli/${scenario.files[0]}`]);
      execFileSync(process.execPath, [externalHelper], { cwd: f.worktree, env: f.env });
      assert.equal(readFileSync(join(f.worktree, externalOutput, 'result.txt'), 'utf8'),
        externalScript ? 'changed' : '// changed\n');
      rmSync(join(f.worktree, externalOutput), { recursive: true });
    }
    assert.equal(isConsumerVisibleFile(`packages/cli/${scenario.files[0]}`,
      { root: f.root, head: f.git(f.worktree, 'rev-parse', 'HEAD') }), scenario.firstVisible ?? scenario.visible);
    const row = f.plan();

    assert.equal(row.obs.publicPackagesTouched, scenario.visible);
    assert.equal(row.obs.changesetPresent, false);
    assert.equal(row.decision.action, scenario.visible ? 'fix-back' : 'review');
    if (scenario.visible) assert.equal(row.decision.reason, 'changeset-missing');
    f.commit('.changeset/consumer.md', '---\n"@fluojs/cli": patch\n---\nPreserve consumer behavior.\n');
    assert.equal(f.plan().decision.action, 'review');
    if (scenario.buildCopy || scenario.dynamicBuild) {
      execFileSync(process.execPath, [scenario.dynamicBuild ? 'scripts/run.mjs' : 'scripts/build.mjs'],
        { cwd: join(f.worktree, 'packages/cli'), env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
      const output = scenario.dynamicBuild ? 'dist/result.txt'
        : scenario.copyInput ? 'dist/release-notes.md' : 'dist/assets/guide.md';
      assert.equal(readFileSync(join(f.worktree, 'packages/cli', output), 'utf8'),
        scenario.dynamicBuild ? 'changed' : '// changed\n');
    }
  });
}

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
    const privateManifest = { name: 'fixture-ci', private: true, type: 'module' };
    if (file.endsWith('package.json')) {
      mkdirSync(dirname(join(f.root, file)), { recursive: true });
      writeFileSync(join(f.root, file), JSON.stringify(privateManifest));
      writeProductionDeclaration(f.root, [], [], [file]);
      f.git(f.root, 'add', file, 'tooling/governance/package-production-inputs.json');
      f.git(f.root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'private publication fixture');
      f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    }
    f.set('preflight', f.preflight({
      scope: ['docs/', file], predicted_files: [file],
    }));
    f.implement();
    f.commit(file, file.endsWith('package.json')
      ? JSON.stringify({ ...privateManifest, description: 'internal metadata change' }) : 'fixture change\n');
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
  assert.ok(calls.every((args) => (['issue', 'pr'].includes(args[0]) && args[1] === 'view')
    || (args.length === 4 && args[0] === 'api' && args[1] === '--paginate' && args[2] === '--slurp'
      && args[3] === 'repos/{owner}/{repo}/actions/runs?branch=issue-42&event=pull_request&per_page=100')));
});

for (const approved of [false, true]) {
  test(`CLI canonical CI: partial rollup and unfinished run -> wait until success (grant=${approved})`, (t) => {
    const f = fixture(t);
    f.set('preflight', f.preflight());
    f.implement();
    const review = f.review();
    f.set('review', review, review.head_sha);
    if (approved) f.cli('approve-merge', f.common);
    f.state.pr = { number: 42, state: 'OPEN', headRefOid: review.head_sha,
      mergeable: 'MERGEABLE', statusCheckRollup: [{ name: 'Resolve verification plan', conclusion: 'SUCCESS' }] };
    f.state.run = { ...f.state.run, status: 'in_progress', conclusion: null };
    f.update();

    let planned = f.plan();

    assert.equal(planned.decision.action, 'wait-ci');
    assert.equal(planned.obs.pr.ciStatus, 'pending');
    assert.equal(planned.obs.pr.ciRuns, null);
    f.state.pr.statusCheckRollup.push({ name: 'Verify', status: 'IN_PROGRESS', conclusion: null });
    f.update();
    assert.equal(f.plan().decision.action, 'wait-ci');
    f.state.pr.statusCheckRollup[1] = { name: 'Verify', conclusion: 'SUCCESS' };
    f.update();
    assert.equal(f.plan().decision.action, 'wait-ci');
    f.state.run = { ...f.state.run, status: 'completed', conclusion: 'success' };
    f.update();
    planned = f.plan();
    assert.equal(planned.obs.pr.ciStatus, 'passing');
    assert.equal(planned.decision.action, approved ? 'merge' : 'request-merge-approval');
    assert.equal(planned.obs.pr.ciRuns, null);
  });
}

test('CLI canonical CI: latest exact-head run and attempt -> preserve failure and rerun recovery', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  const review = f.review();
  f.set('review', review, review.head_sha);
  f.cli('approve-merge', f.common);
  f.state.pr = { number: 42, state: 'OPEN', headRefOid: review.head_sha,
    mergeable: 'MERGEABLE', statusCheckRollup: [{ conclusion: 'SUCCESS' }] };
  const success = { ...f.state.run, head_sha: review.head_sha };
  const latest = { ...success, id: 102, status: 'queued', conclusion: null };
  f.state.actionsPages = [{ total_count: 4, workflow_runs: [
    latest, { ...success, id: 104, head_sha: 'f'.repeat(40) },
  ] }, { total_count: 4, workflow_runs: [
    { ...success, id: 103, path: '.github/workflows/extended-verification.yml', conclusion: 'failure' }, success,
  ] }];
  f.update();

  assert.equal(f.plan().decision.action, 'wait-ci');

  for (const conclusion of ['failure', 'timed_out', 'cancelled', 'action_required']) {
    Object.assign(latest, { status: 'completed', conclusion });
    f.update();
    const planned = f.plan();
    assert.equal(planned.obs.pr.ciStatus, 'failing', conclusion);
    assert.equal(planned.decision.reason, 'ci-failing', conclusion);
  }
  Object.assign(latest, { run_attempt: 2, status: 'in_progress', conclusion: null });
  f.update();
  assert.equal(f.plan().decision.action, 'wait-ci');
  Object.assign(latest, { status: 'completed', conclusion: 'success' });
  f.update();
  assert.equal(f.plan().decision.action, 'merge');
  f.state.pr.statusCheckRollup = [{ conclusion: 'FAILURE' }];
  f.update();
  assert.equal(f.plan().decision.reason, 'ci-failing');
});

test('CLI canonical CI: unavailable or incomplete run evidence -> wait without losing PR or rollup failure', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  const review = f.review();
  f.set('review', review, review.head_sha);
  f.state.pr = { number: 42, state: 'OPEN', headRefOid: review.head_sha,
    mergeable: 'MERGEABLE', statusCheckRollup: [{ conclusion: 'SUCCESS' }] };
  const success = { ...f.state.run, head_sha: review.head_sha };
  const page = (runs, total = runs.length) => [{ total_count: total, workflow_runs: runs }];
  const cases = [
    { fail: 'api' }, { actionsRaw: '{' }, { actionsRaw: '{}' }, { actionsRaw: 'null' },
    { actionsPages: null }, { actionsPages: [] }, { actionsPages: [null] }, { actionsPages: [{ total_count: 1 }] },
    { actionsPages: page([]) }, { actionsPages: page([success], 2) },
    { actionsPages: page([{ ...success, path: '.github/workflows/node-verification.yml' }]) },
    { actionsPages: page([{ ...success, head_sha: 'f'.repeat(40) }]) },
    ...[0, -1, '101', 1.5, null].map(id => ({ actionsPages: page([{ ...success, id }]) })),
    ...[0, -1, '2', 1.5, null].map(run_attempt => ({ actionsPages: page([{ ...success, run_attempt }]) })),
    ...['neutral', 'skipped', null].map(conclusion => ({ actionsPages: page([{ ...success, conclusion }]) })),
    { actionsPages: page([{ ...success, status: 'waiting', conclusion: null }]) },
    { actionsPages: page([{ ...success, status: null }]) },
    { actionsPages: page([success, success]) },
    { actionsPages: [{ total_count: 2, workflow_runs: [success] }, { total_count: 1, workflow_runs: [{ ...success, id: 102 }] }] },
  ];
  for (const patch of cases) {
    delete f.state.fail;
    delete f.state.actionsRaw;
    delete f.state.actionsPages;
    Object.assign(f.state, patch);
    f.state.pr.statusCheckRollup = [{ conclusion: 'SUCCESS' }];
    f.update();

    const planned = f.plan();

    assert.equal(planned.decision.action, 'wait-ci', JSON.stringify(patch));
    assert.equal(planned.obs.pr.number, 42);
    assert.notEqual(planned.obs.pr.ciStatus, 'passing');
    assert.equal(planned.obs.pr.ciRuns, null);
    f.state.pr.statusCheckRollup = [{ conclusion: 'ERROR' }];
    f.update();
    assert.equal(f.plan().decision.reason, 'ci-failing', JSON.stringify(patch));
  }
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
        verdict_signal: 'PASS', blockers: [],
        evidence: [{ acceptance: 'Retain generated consumer', locations: ['src/generated.ts:1'] }], observations: [] })) };
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

const externalFixture = (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  const before = f.plan().decision;
  const lane = JSON.parse(readFileSync(f.lanePath));
  lane.preflight_overlap = 1;
  writeFileSync(f.lanePath, JSON.stringify(lane));
  const externalPath = join(f.root, '.omo/lanes-v4/other.json');
  const external = { version: 4, lane_id: 'other', base_branch: 'main', issues: {
    99: { issue: 99, branch: 'issue-99', depends_on: [], attempts: {}, approvals: { merge: false }, blocker: null,
      facts: { preflight: { value: createPreflight({ ...lane.issues['42'].facts.preflight.value, issue: 99 }) } } },
  } };
  const writeExternal = () => writeFileSync(externalPath, JSON.stringify(external));
  writeExternal();
  const connection = nodes => ({ totalCount: nodes.length, pageInfo: { hasNextPage: false }, nodes });
  f.state.externalIssues = { data: { repository: { issue0: { ...f.state.issue }, branch0: connection([]) } } };
  f.state.externalPrs = { data: { repository: { pullRequests: connection([
    { number: 142, headRefName: 'issue-42', headRefOid: 'a'.repeat(40), files: connection([{ path: 'docs/guide.md' }]) },
    { number: 199, headRefName: 'issue-99', headRefOid: 'b'.repeat(40),
      files: connection([{ path: 'docs/guide.md' }, { path: 'docs/unrelated.md' }]) },
  ]) } } };
  f.update();
  const calls = () => readFileSync(f.ghLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  return { ...f, before, external, externalPath, writeExternal, connection, calls };
};

test('#4130 external CLI: shared snapshot and fresh observations -> exact matches, unchanged decisions and read-only external lanes', (t) => {
  const f = externalFixture(t);
  const externalBytes = readFileSync(f.externalPath, 'utf8');
  let count = f.calls().length;

  const planned = f.plan();

  assert.equal(JSON.stringify(planned.decision), JSON.stringify(f.before));
  assert.deepEqual(planned.obs.externalOverlaps, { version: 1, status: 'complete',
    laneMatches: [{ lane_id: 'other', issue: 99, files: ['docs/guide.md'] }],
    prMatches: [{ pr: 199, head: 'b'.repeat(40), files: ['docs/guide.md'] }], unknowns: [] });
  assert.equal(f.calls().slice(count).filter(args => ['repo', 'api'].includes(args[0])).length, 3);
  const lane = JSON.parse(readFileSync(f.lanePath));
  lane.issues['43'] = { ...lane.issues['42'], issue: 43, branch: 'issue-43', facts: {} };
  writeFileSync(f.lanePath, JSON.stringify(lane));
  count = f.calls().length;
  const rows = JSON.parse(f.cli('plan-all', ['--lane', f.lanePath, '--with-retro']).stdout).issues;
  assert.deepEqual(rows[0].externalOverlaps, planned.obs.externalOverlaps);
  assert.equal(rows[1].externalOverlaps.status, 'unobservable');
  assert.equal(f.calls().slice(count).filter(args => ['repo', 'api'].includes(args[0])).length, 3);
  f.state.externalPrs.data.repository.pullRequests = f.connection([]);
  f.external.issues['99'].facts.preflight.value = createPreflight({
    ...f.external.issues['99'].facts.preflight.value, predicted_files: ['docs/clear.md'] });
  f.writeExternal();
  const changedBytes = readFileSync(f.externalPath, 'utf8');
  f.update();
  const fresh = f.plan();
  assert.equal(fresh.obs.externalOverlaps.status, 'complete');
  assert.deepEqual(fresh.obs.externalOverlaps.laneMatches, []);
  assert.deepEqual(fresh.obs.externalOverlaps.prMatches, []);
  assert.equal(JSON.stringify(fresh.decision), JSON.stringify(planned.decision));
  assert.equal(readFileSync(f.externalPath, 'utf8'), changedBytes);
  assert.notEqual(externalBytes, changedBytes);
  assert.equal(existsSync(`${f.externalPath}.lock`), false);
  const events = readRetroEvents(f.root, 'fixture');
  assert.ok(events.some(event => event.kind === 'observation' && event.data.externalOverlaps?.laneMatches.length === 1));
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(f.lanePath)), 'externalOverlaps'), false);
});

for (const scenario of ['closed', 'merged-done', 'merged-cleanup', 'stale', 'invalid', 'invalid-base', 'scope-expansion']) {
  test(`#4130 external CLI: ${scenario} -> terminal exclusion or validated active prediction with explicit unknowns`, (t) => {
    const f = externalFixture(t);
    const entry = f.external.issues['99'];
    if (scenario === 'closed') f.state.externalIssues.data.repository.issue0.state = 'CLOSED';
    if (scenario.startsWith('merged')) {
      f.state.externalIssues.data.repository.branch0 = f.connection([{ number: 199, state: 'MERGED', headRefOid: 'b'.repeat(40) }]);
      if (scenario === 'merged-cleanup') f.git(f.root, 'branch', 'issue-99', 'main');
    }
    if (scenario === 'stale') f.state.externalIssues.data.repository.issue0 = { ...f.state.issue, body: 'new requirements' };
    if (scenario === 'invalid') entry.facts.preflight.value.sha256 = '0'.repeat(64);
    if (scenario === 'invalid-base') entry.facts.preflight.value = createPreflight({
      ...entry.facts.preflight.value, base_sha: 'f'.repeat(40) });
    if (scenario === 'scope-expansion') {
      f.git(f.root, 'branch', 'issue-99', 'issue-42');
      entry.facts.preflight.value = createPreflight({ ...entry.facts.preflight.value,
        scope: ['src/'], non_scope: [], predicted_files: ['src/a.ts'],
        active_axes: ['contract', 'code', 'verification'], omitted_axes: {} });
    }
    f.writeExternal();
    const bytes = readFileSync(f.externalPath, 'utf8');
    f.update();

    const result = f.plan();

    const unknown = ['stale', 'invalid', 'invalid-base', 'scope-expansion'].includes(scenario);
    assert.equal(result.obs.externalOverlaps.status, unknown ? 'unobservable' : 'complete');
    assert.equal(result.obs.externalOverlaps.laneMatches.length, scenario === 'merged-cleanup' ? 1 : 0);
    assert.equal(result.obs.externalOverlaps.prMatches.length, 1);
    assert.equal(JSON.stringify(result.decision), JSON.stringify(f.before));
    assert.equal(readFileSync(f.externalPath, 'utf8'), bytes);
  });
}

for (const scenario of ['corrupt', 'unreadable', 'symlink', 'legacy', 'marker', 'readiness', 'structure',
  'partial-prs', 'partial-files', 'partial-issues', 'errors', 'partial-command', 'null-response', 'missing-issue', 'repository', 'command']) {
  test(`#4130 external CLI: ${scenario} -> explicit incomplete observation without decision failure`, (t) => {
    const f = externalFixture(t);
    if (scenario === 'corrupt') writeFileSync(f.externalPath, '{');
    if (scenario === 'unreadable') {
      rmSync(f.externalPath);
      mkdirSync(f.externalPath);
    }
    if (scenario === 'symlink') {
      rmSync(f.externalPath);
      symlinkSync(join(f.root, 'gh.json'), f.externalPath);
    }
    if (scenario === 'legacy') { f.external.version = 2; f.writeExternal(); }
    if (scenario === 'marker') { f.external.preflight_overlap = 2; f.writeExternal(); }
    if (scenario === 'readiness') {
      f.external.preflight_overlap = 1;
      f.external.issues['99'].facts['review-readiness'] = { value: {} };
      f.writeExternal();
    }
    if (scenario === 'structure') { f.external.issues['99'].issue = 100; f.writeExternal(); }
    if (scenario === 'partial-prs') f.state.externalPrs.data.repository.pullRequests.totalCount = 101;
    if (scenario === 'partial-files') f.state.externalPrs.data.repository.pullRequests.nodes[1].files.pageInfo.hasNextPage = true;
    if (scenario === 'partial-issues') f.state.externalIssues.data.repository.branch0.totalCount = 2;
    if (scenario === 'errors') f.state.externalPrs.errors = [{ message: 'partial outage' }];
    if (scenario === 'partial-command') f.state.externalPrExit = 1;
    if (scenario === 'null-response') f.state.externalPrs = null;
    if (scenario === 'missing-issue') delete f.state.externalIssues.data.repository.issue0;
    if (scenario === 'repository') f.state.externalRepository = {};
    if (scenario === 'command') f.state.fail = 'api';
    f.update();

    const result = f.plan();

    assert.equal(result.obs.externalOverlaps.status, 'unobservable');
    assert.ok(result.obs.externalOverlaps.unknowns.length > 0);
    assert.deepEqual(result.obs.observationFailures, []);
    assert.equal(JSON.stringify(result.decision), JSON.stringify(f.before));
    if (['partial-prs', 'partial-files', 'errors', 'partial-command'].includes(scenario)) assert.equal(result.obs.externalOverlaps.prMatches.length, 1);
  });
}

test('#4130 external CLI: legacy execution -> no supplemental calls, events or ledger rewrites', (t) => {
  const f = externalFixture(t);
  const lane = JSON.parse(readFileSync(f.lanePath));
  delete lane.preflight_overlap;
  writeFileSync(f.lanePath, JSON.stringify(lane));
  const bytes = readFileSync(f.lanePath, 'utf8');
  const count = f.calls().length;
  const eventCount = readRetroEvents(f.root, 'fixture').length;

  const result = f.plan();

  assert.equal(Object.hasOwn(result.obs, 'externalOverlaps'), false);
  assert.equal(f.calls().slice(count).filter(args => ['repo', 'api'].includes(args[0])).length, 0);
  assert.equal(readFileSync(f.lanePath, 'utf8'), bytes);
  assert.equal(readRetroEvents(f.root, 'fixture').length, eventCount);
});

test('#4130 external CLI: watch once -> separate observation row and persisted evidence without generated hints', (t) => {
  const f = externalFixture(t);

  const watched = f.cli('watch', ['--lane', f.lanePath, '--once']).stdout;

  const lines = watched.split('\n').filter(line => line.includes('externalOverlaps='));
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0].split('externalOverlaps=')[1]).laneMatches[0].issue, 99);
  assert.equal(watched.split('\n').filter(line => line.includes(' -> ')).length, 1);
  const evidence = JSON.parse(f.cli('retro-evidence', ['--lane', f.lanePath]).stdout);
  assert.equal(evidence.externalOverlapObservations.length, 1);
});

test('#4130 external bounds: 51 issues and 101 PRs/files -> first bounded positives survive with explicit limits', (t) => {
  const f = externalFixture(t);
  const template = f.external.issues['99'];
  f.external.issues = {};
  f.state.externalIssues.data.repository = {};
  for (let index = 0; index < 51; index++) {
    const issue = 99 + index;
    f.external.issues[issue] = { ...template, issue, branch: `issue-${issue}`,
      facts: { preflight: { value: createPreflight({ ...template.facts.preflight.value, issue }) } } };
    if (index < 50) {
      f.state.externalIssues.data.repository[`issue${index}`] = { ...f.state.issue };
      f.state.externalIssues.data.repository[`branch${index}`] = f.connection([]);
    }
  }
  f.writeExternal();
  const files = [{ path: 'docs/guide.md' }, ...Array.from({ length: 100 }, (_, index) => ({ path: `docs/file-${index}.md` }))];
  f.state.externalPrs.data.repository.pullRequests = f.connection(Array.from({ length: 101 }, (_, index) => ({
    number: 200 + index, headRefName: `feature-${index}`, headRefOid: 'b'.repeat(40), files: f.connection(files),
  })));
  f.update();
  const count = f.calls().length;

  const observation = f.plan().obs.externalOverlaps;

  assert.equal(observation.status, 'unobservable');
  assert.equal(observation.laneMatches.length, 50);
  assert.equal(observation.prMatches.length, 100);
  assert.ok(observation.unknowns.some(item => item.source === 'issue' && item.subject === 'other:149' && item.code === 'limit-exceeded'));
  assert.ok(observation.unknowns.some(item => item.source === 'pr' && item.code === 'limit-exceeded'));
  assert.ok(observation.unknowns.some(item => item.source === 'pr-files' && item.subject === 200 && item.code === 'limit-exceeded'));
  const supplemental = f.calls().slice(count).filter(args => ['repo', 'api'].includes(args[0]));
  assert.equal(supplemental.length, 3);
  const batch = supplemental.find(args => args.some(arg => arg.includes('ExternalOverlapIssues'))).join(' ');
  assert.equal([...batch.matchAll(/issue\d+:issue\(/gu)].length, 50);
});

test('#4130 external discovery: current lane identity and marker external lane -> self excluded and external included', (t) => {
  const f = externalFixture(t);
  const alias = join(f.root, '.omo/lanes-v4/self.json');
  writeFileSync(alias, readFileSync(f.lanePath));
  f.external.preflight_overlap = 1;
  f.writeExternal();
  const bytes = readFileSync(alias, 'utf8');

  const observation = f.plan().obs.externalOverlaps;

  assert.equal(observation.status, 'complete');
  assert.deepEqual(observation.laneMatches.map(item => [item.lane_id, item.issue]), [['other', 99]]);
  assert.equal(readFileSync(alias, 'utf8'), bytes);
  assert.equal(existsSync(`${alias}.lock`), false);
});

for (const scenario of ['missing', 'enumeration-failed']) {
  test(`#4130 external directory: ${scenario} -> absence or explicit discovery gap`, (t) => {
    const f = externalFixture(t);
    const current = join(f.root, 'current-lane.json');
    writeFileSync(current, readFileSync(f.lanePath));
    rmSync(join(f.root, '.omo/lanes-v4'), { recursive: true });
    if (scenario === 'enumeration-failed') writeFileSync(join(f.root, '.omo/lanes-v4'), 'unreadable directory');
    f.state.externalPrs.data.repository.pullRequests = f.connection([]);
    f.update();

    const observation = JSON.parse(f.cli('plan', ['--lane', current, '--issue', '42']).stdout).obs.externalOverlaps;

    assert.equal(observation.status, scenario === 'missing' ? 'complete' : 'unobservable');
    assert.deepEqual(observation.laneMatches, []);
    if (scenario === 'enumeration-failed') assert.ok(observation.unknowns.some(item => item.code === 'enumeration-failed'));
  });
}

async function withGatedWatch({ makeFixture, gate, releaseOnTick = false, onListening = () => {} }, run) {
  const failure = new AbortController();
  const errors = [];
  const recordError = error => {
    if (!errors.includes(error)) errors.push(error);
    failure.abort(error);
  };
  const attempt = action => {
    try { action(); } catch (error) { recordError(error); }
  };
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), failure.signal]);
  const sockets = new Map();
  const pending = [];
  const writers = new Map();
  const groups = new Map();
  const spawnOwned = (argv, options) => {
    // The watch and each writer lead a private POSIX group inherited by their Git/gh children.
    const owned = spawn(process.execPath, argv, { ...options, detached: true });
    if (owned.pid) {
      const group = -owned.pid;
      const processState = { owned, exited: false };
      groups.set(group, processState);
      owned.once('exit', () => { processState.exited = true; });
      owned.once('close', () => attempt(() => {
        if (processState.exited && !signalFixtureProcess(group, 0)) groups.delete(group);
      }));
    }
    return owned;
  };
  let removeFixture;
  let server;
  let child;
  let closed;
  let stopping = false;
  let transcript = '';
  let stderr = '';
  const release = socket => {
    if (!socket.destroyed && !socket.writableEnded) socket.end('continue\n');
  };
  let stage = 'fixture setup';
  try {
    const f = makeFixture({ after: remove => { removeFixture = remove; } });
    server = createServer(socket => {
      sockets.set(socket, new Promise(resolve => socket.once('close', () => {
        sockets.delete(socket);
        resolve();
      })));
      socket.on('error', recordError);
      socket.once('data', () => {
        if (stopping) attempt(() => release(socket));
        else if (releaseOnTick) { server.emit('tick'); attempt(() => release(socket)); }
        else { pending.push(socket); server.emit('tick'); }
      });
    });
    server.on('error', recordError);
    stage = 'listen';
    const listening = once(server, 'listening', { signal });
    server.listen(0, '127.0.0.1');
    await listening;
    stage = 'watch setup';
    onListening(f.root, server);
    const gh = join(f.root, 'bin/gh');
    const original = readFileSync(gh, 'utf8').replace(/^#![^\n]*\n/u, '');
    writeFileSync(gh, `#!${process.execPath}
import { connect as fixtureConnect } from 'node:net';
if(process.env.WATCH_PORT && (${gate})) {
  await new Promise((done,reject)=>{
    const socket=fixtureConnect(Number(process.env.WATCH_PORT),'127.0.0.1');
    socket.on('connect',()=>socket.write('tick\\n'));
    socket.on('end',done); socket.on('error',reject); socket.resume();
  });
}
${original}`);
    // The IPC callback runs between synchronous CLI observations, so every started gh has exited.
    const stopOnRequest = `data:text/javascript,${encodeURIComponent(`
      const stop = () => process.exit(0);
      if (!process.connected) stop();
      process.once('disconnect', stop);
      process.on('message', message => { if (message === 'stop') stop(); });
    `)}`;
    child = spawnOwned(['--import', stopOnRequest, script, 'watch',
      '--root', f.root, '--lane', f.lanePath, '--interval', releaseOnTick ? '0.01' : '0'], {
      env: { ...f.env, WATCH_PORT: String(server.address().port) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child.on('error', recordError);
    closed = new Promise(resolve => child.once('close', (code, exitSignal) => {
      if (!stopping || code !== 0 || exitSignal !== null) {
        recordError(new Error(`Watch closed during ${stage} (code ${code}, signal ${exitSignal}):\n${transcript}\n${stderr}`));
      }
      resolve();
    }));
    child.stdout.on('data', chunk => { transcript += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const tick = async () => {
      stage = 'watch handshake';
      signal.throwIfAborted();
      if (releaseOnTick) return once(server, 'tick', { signal });
      if (!pending.length) await once(server, 'tick', { signal });
      return pending.shift();
    };
    const output = predicate => new Promise((resolve, reject) => {
      stage = 'watch output';
      const cleanup = () => { child.stdout.off('data', inspect); signal.removeEventListener('abort', abort); };
      const inspect = () => {
        const value = predicate(transcript);
        if (value) { cleanup(); resolve(value); }
      };
      const abort = () => {
        cleanup();
        reject(failure.signal.reason ?? new Error(`Missing watch output: ${transcript}\n${stderr}`, { cause: signal.reason }));
      };
      if (signal.aborted) { abort(); return; }
      child.stdout.on('data', inspect);
      signal.addEventListener('abort', abort, { once: true });
      inspect();
    });
    const recordBlocker = async () => {
      stage = 'record writer';
      signal.throwIfAborted();
      const writerEnv = { ...f.env };
      delete writerEnv.WATCH_PORT;
      const writer = spawnOwned([script, 'record', '--root', f.root, ...f.common,
        '--phase', 'implement', '--result-json', '{"ok":false}'], { env: writerEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      let writerStderr = '';
      writers.set(writer, new Promise(resolve => writer.once('close', (code, exitSignal) => {
        if (code !== 0 || exitSignal !== null) {
          recordError(new Error(`record writer closed (code ${code}, signal ${exitSignal}):\n${writerStderr}`));
        }
        writers.delete(writer);
        resolve();
      })));
      writer.on('error', recordError);
      writer.stdout.resume();
      writer.stderr.on('data', chunk => { writerStderr += chunk; });
      try {
        await once(writer, 'close', { signal });
      } catch (error) {
        throw failure.signal.reason ?? error;
      }
      signal.throwIfAborted();
    };
    await run({ f, child, tick, output, recordBlocker, transcript: () => transcript });
  } catch (error) {
    recordError(signal.aborted && !failure.signal.aborted
      ? new Error(`Watch fixture deadline during ${stage}:\n${transcript}\n${stderr}`, { cause: error }) : error);
  } finally {
    stopping = true;
    // Let the child close IPC: parent-initiated disconnect can bypass Node's child close accounting.
    if (child?.connected) attempt(() => child.send('stop', error => {
      if (error) recordError(error);
    }));
    for (const socket of sockets.keys()) attempt(() => release(socket));
    const drain = await Promise.race([
      Promise.all([closed, ...writers.values()]),
      aborted(AbortSignal.timeout(20_000), server ?? failure),
    ]);
    if (!drain) {
      recordError(new Error(`Watch teardown did not drain after ${stage}; forcing fixture process groups to exit`));
    }
    const remainingGroups = [...groups.keys()];
    if (remainingGroups.length && !errors.length) {
      recordError(new Error(`Gated watch teardown found surviving process groups after ${stage}: ${remainingGroups}`));
    }
    for (const group of remainingGroups) attempt(() => signalFixtureProcess(group, 'SIGKILL'));
    const listenerClosed = !server || new Promise(resolve => {
      try {
        server.close(error => {
          if (!error || error.code === 'ERR_SERVER_NOT_RUNNING') resolve(true);
          else { recordError(error); resolve(false); }
        });
      } catch (error) {
        recordError(error);
        resolve(false);
      }
    });
    const socketClosures = [...sockets];
    for (const [socket] of socketClosures) attempt(() => socket.destroy());
    const cleanupDeadline = AbortSignal.timeout(20_000);
    const stopped = await Promise.race([
      Promise.all([listenerClosed, closed, ...writers.values(), ...socketClosures.map(([, done]) => done)]),
      aborted(cleanupDeadline, server ?? failure),
    ]);
    // Only a reaped leader and an absent group prove exit; socket/pipe closure cannot prove either.
    // For groups not cleared at child close, check once at the end of resource drain and fail closed.
    for (const [group, { owned, exited }] of groups) {
      attempt(() => {
        if (exited && !signalFixtureProcess(group, 0)) groups.delete(group);
      });
      if (!stopped) {
        owned.stdout?.destroy();
        owned.stderr?.destroy();
        if (owned.connected) attempt(() => owned.disconnect());
        owned.unref();
      }
    }
    const alive = [...groups.keys()];
    if (!stopped?.[0]) recordError(new Error(`Watch teardown after ${stage} did not observe resource close; retaining fixture`));
    if (alive.length) recordError(new Error(`Watch teardown after ${stage} could not prove exit of process groups ${alive}; retaining fixture`));
    if (stopped?.[0] && !alive.length) attempt(() => removeFixture?.());
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'Gated watch fixture failed');
}

test('4153 gated watch teardown: unproven process-group exit retains the fixture', async (t) => {
  let root;
  let group;
  let forced = false;
  let finalProbeDenied = false;
  let removeFixture;
  const kill = process.kill;
  const killMock = t.mock.method(process, 'kill', (pid, signal) => {
    if (pid === group && signal === 'SIGKILL') forced = true;
    if (pid === group && signal === 0 && !finalProbeDenied) {
      if (forced) finalProbeDenied = true;
      throw Object.assign(new Error('injected EPERM during watch group exit proof'), { code: 'EPERM' });
    }
    return kill.call(process, pid, signal);
  });

  try {
    const failure = await withGatedWatch({
      makeFixture: context => {
        const f = externalFixture({ after: remove => { removeFixture = remove; } });
        root = f.root;
        context.after(() => removeFixture ? removeFixture() : rmSync(root, { recursive: true }));
        return f;
      },
      gate: "process.argv[2]==='api' && process.argv.some(arg=>arg.includes('ExternalOverlapPullRequests'))",
    }, async ({ child, tick }) => {
      group = -child.pid;
      await tick();
    }).then(() => null, error => error);

    assert.equal(finalProbeDenied, true, 'the terminal existence check must encounter EPERM');
    assert.equal(existsSync(root), true, 'without exit proof at teardown, the fixture root must remain');
    const errors = failure instanceof AggregateError ? failure.errors : [failure];
    assert.ok(errors.some(error => /Watch teardown.*exit.*retaining fixture/u.test(error?.message)),
      'teardown must report the unproven exit');
  } finally {
    killMock.mock.restore();
    if (group && !signalFixtureProcess(group, 0)) removeFixture?.();
  }
});

function withExternalWatch(externalLane, run, onListening) {
  let initialCalls;
  return withGatedWatch({
    makeFixture: context => {
      const f = externalFixture(context);
      if (!externalLane) rmSync(f.externalPath);
      initialCalls = f.calls().length;
      return f;
    },
    gate: "process.argv[2]==='api' && process.argv.some(arg=>arg.includes('ExternalOverlapPullRequests'))",
    onListening,
  }, fixture => run({ ...fixture, initialCalls }));
}

for (const externalLane of [false, true]) {
test(`#4130 external watch: ${externalLane ? 'with' : 'without'} external lane -> fresh observations with one repository lookup per process`, () => withExternalWatch(externalLane, async ({ f, tick, output, initialCalls, transcript }) => {
  const supplemental = start => f.calls().slice(start).filter(args => ['repo', 'api'].includes(args[0]));
  (await tick()).end('continue\n');
  await output(text => text.includes(' -> review'));
  const firstEnd = f.calls().length;
  assert.equal(supplemental(initialCalls).length, externalLane ? 3 : 2);
  (await tick()).end('continue\n');
  const third = await tick();
  assert.equal(supplemental(firstEnd).length, externalLane ? 2 : 1);
  assert.equal(supplemental(initialCalls).filter(args => args[0] === 'repo').length, 1);
  const secondEnd = f.calls().length;
  assert.equal(transcript().split('\n').filter(line => line.includes('externalOverlaps=')).length, 1);
  f.state.externalPrs.data.repository.pullRequests = f.connection([]);
  f.update();
  third.end('continue\n');
  await output(text => text.split('\n').filter(line => line.includes('externalOverlaps=')).length === 2);

  assert.equal(supplemental(secondEnd).length, externalLane ? 2 : 1);
  assert.ok(supplemental(secondEnd).length <= 3);
  assert.equal(transcript().split('\n').filter(line => line.includes(' -> ')).length, 1);
  const observations = transcript().split('\n').filter(line => line.includes('externalOverlaps='))
    .map(line => JSON.parse(line.split('externalOverlaps=')[1]));
  assert.equal(observations[0].prMatches.length, 1);
  assert.equal(observations[1].prMatches.length, 0);
}));
}

for (const setupFails of [false, true]) {
  test(`#4296 external watch teardown: ${setupFails ? 'partial setup failure' : 'normal completion'} -> close resources before removing the fixture root`, async () => {
    const setupError = new Error('injected watch setup failure after listen');
    const rootAtClose = {};
    let root;
    let server;
    let pendingGhFinished;
    const onListening = (fixtureRoot, listener) => {
      root = fixtureRoot;
      server = listener;
      server.once('close', () => { rootAtClose.listener = existsSync(root); });
      if (setupFails) throw setupError;
    };

    try {
      const run = () => withExternalWatch(true, async ({ f, child, tick }) => {
        const socket = await tick();
        const before = f.calls().length;
        socket.once('close', () => { rootAtClose.socket = existsSync(root); });
        child.once('close', () => {
          rootAtClose.child = existsSync(root);
          pendingGhFinished = rootAtClose.child && f.calls().slice(before)
            .some(args => args.some(arg => arg.includes('ExternalOverlapPullRequests')));
        });
      }, onListening);
      if (setupFails) await assert.rejects(run, (error) => error === setupError);
      else await run();

      assert.deepEqual(rootAtClose, setupFails ? { listener: true } : { child: true, socket: true, listener: true },
        'the fixture root must still exist at each acquired resource close');
      if (!setupFails) assert.equal(pendingGhFinished, true, 'the gated fake gh must finish writing before the watch closes');
      assert.equal(existsSync(root), Boolean(process.env.FLUO_PRODUCT_TEST_EVIDENCE));
    } finally {
      if (server?.listening) await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  });
}

function signalFixtureProcess(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (error instanceof Error) {
      if (error.code === 'ESRCH') return false;
      if (signal === 0 && error.code === 'EPERM') return true;
    }
    throw error;
  }
}

test('#4153 gated watch writer: inherited WATCH_PORT stays out of the record process', async () => {
  await withGatedWatch({
    makeFixture: context => {
      const ambientWatchPort = process.env.WATCH_PORT;
      process.env.WATCH_PORT = '41530';
      try {
        const f = externalFixture(context);
        const writerWatchPortPath = join(f.root, 'bin/record-watch-port.json');
        const observeWriterWatchPort = `data:text/javascript,${encodeURIComponent(`
          import { writeFileSync } from 'node:fs';
          if (process.argv[2] === 'record') {
            writeFileSync(${JSON.stringify(writerWatchPortPath)}, JSON.stringify(process.env.WATCH_PORT ?? null));
          }
        `)}`;
        f.env.NODE_OPTIONS = `--import ${observeWriterWatchPort}`;
        return f;
      } finally {
        if (ambientWatchPort === undefined) delete process.env.WATCH_PORT;
        else process.env.WATCH_PORT = ambientWatchPort;
      }
    },
    gate: "process.argv[2]==='api' && process.argv.some(arg=>arg.includes('ExternalOverlapPullRequests'))",
  }, async ({ f, tick, recordBlocker }) => {
    await tick();
    await recordBlocker();

    const writerWatchPort = JSON.parse(readFileSync(join(f.root, 'bin/record-watch-port.json'), 'utf8'));
    assert.equal(writerWatchPort, null, 'the record process must not inherit the watch-only WATCH_PORT');
  });
});

test('#4153 gated watch teardown: a signaled record writer cannot leave a live fake gh at fixture removal', async (t) => {
  const probe = createServer(socket => {
    socket.on('error', () => socket.destroy());
    let handshake = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      handshake += chunk;
      if (handshake.endsWith('\n')) probe.emit('gh-ready', JSON.parse(handshake));
    });
  });
  const signal = AbortSignal.timeout(20_000);
  let root;
  let removeFixture;
  let listenerClosed = false;
  let watchGroup;
  let writerGroup;
  let fakeGhPid;
  let aliveAtRemoval;
  let socket;
  let injectedProbeError = false;
  const kill = process.kill;
  const killMock = t.mock.method(process, 'kill', (pid, signal) => {
    if (pid === writerGroup && signal === 0 && !injectedProbeError) {
      injectedProbeError = true;
      throw Object.assign(new Error('injected EPERM at writer close'), { code: 'EPERM' });
    }
    return kill.call(process, pid, signal);
  });
  probe.once('connection', accepted => { socket = accepted; });
  try {
    const listening = once(probe, 'listening', { signal });
    probe.listen(0, '127.0.0.1');
    await listening;
    const fixtureError = await withGatedWatch({
      makeFixture: context => {
        const f = externalFixture({ after: remove => {
          removeFixture = remove;
          context.after(() => {
            if (fakeGhPid) aliveAtRemoval = signalFixtureProcess(fakeGhPid, 0);
            remove();
            removeFixture = undefined;
          });
        } });
        root = f.root;
        // Deliver the stop request while gh is gated, but let the synchronous CLI reap gh
        // before its signal callback runs. The test must not hand gh off to an OS orphan reaper.
        const stopWriter = `data:text/javascript,${encodeURIComponent(`
          import { MessageChannel } from 'node:worker_threads';
          if (process.argv[2] === 'record') {
            // A signal listener alone does not keep the event loop alive to deliver the signal.
            const { port1 } = new MessageChannel();
            port1.on('message', () => {});
            process.once('SIGTERM', () => process.kill(process.pid, 'SIGKILL'));
          }
        `)}`;
        f.env.NODE_OPTIONS = `--import ${stopWriter}`;
        const gh = join(root, 'bin/gh');
        const entered = JSON.stringify(join(root, 'bin/writer-probe-entered'));
        const original = readFileSync(gh, 'utf8').replace(/^#![^\n]*\n/u, '');
        writeFileSync(gh, `#!${process.execPath}
import { connect } from 'node:net';
import { existsSync as probeExists, writeFileSync as writeProbe } from 'node:fs';
if (!process.env.WATCH_PORT && process.argv[2] === 'issue' && process.argv[3] === 'view' && !probeExists(${entered})) {
  writeProbe(${entered}, '');
  const probe = connect(${probe.address().port}, '127.0.0.1');
  probe.once('connect', () => probe.write(JSON.stringify({ writer: process.ppid, gh: process.pid }) + '\\n'));
  probe.on('error', () => probe.destroy());
  await new Promise(resolve => { probe.once('end', resolve); probe.resume(); });
  probe.end();
}
${original}`);
        return f;
      },
      gate: "process.argv[2]==='api' && process.argv.some(arg=>arg.includes('ExternalOverlapPullRequests'))",
      onListening: (_, server) => server.once('close', () => { listenerClosed = true; }),
    }, async ({ child, tick, recordBlocker }) => {
      watchGroup = -child.pid;
      await tick();
      const ready = once(probe, 'gh-ready', { signal });
      const writerDone = recordBlocker().then(() => null, error => error);
      const [{ writer, gh }] = await ready;
      writerGroup = -writer;
      fakeGhPid = gh;
      try {
        assert.ok(signalFixtureProcess(fakeGhPid, 0), 'fake gh must be alive when the writer is signaled');
        process.kill(writer, 'SIGTERM');
      } finally {
        socket.end();
      }
      const writerError = await writerDone;
      assert.match(writerError?.message ?? '', /record writer/u);
      assert.ok(existsSync(root), 'the root must outlive the abnormal writer exit');
    }).then(() => null, error => error);

    assert.ok(fakeGhPid, fixtureError?.stack);
    assert.ok(injectedProbeError, 'the first existence probe after abnormal writer exit must report EPERM');
    assert.equal(existsSync(root), Boolean(process.env.FLUO_PRODUCT_TEST_EVIDENCE),
      'a transient EPERM must not stop teardown before the fixture can be removed');
    assert.equal(aliveAtRemoval ?? signalFixtureProcess(fakeGhPid, 0), false,
      'the delayed fake gh must exit before fixture root removal');
    assert.match(fixtureError?.message ?? '', /record writer.*SIGKILL/u,
      fixtureError?.errors?.map(error => error.stack).join('\n'));
  } finally {
    killMock.mock.restore();
    try {
      if (fakeGhPid && aliveAtRemoval !== false && removeFixture) {
        // The fixture has drained the owned children; a new probe without the injected error
        // still must prove absence before this test can remove a retained root.
        const alive = [fakeGhPid, writerGroup, watchGroup].filter(pid => signalFixtureProcess(pid, 0));
        assert.deepEqual(alive, [], 'the regression failed to confirm exit of its fixture processes; retaining fixture');
        if (listenerClosed) removeFixture?.();
      }
    } finally {
      socket?.destroy();
      if (probe.listening) await new Promise(resolve => probe.close(resolve));
    }
  }
});

test('#4130 external cost: no valid current prediction -> no supplemental gh calls and explicit unknown', (t) => {
  const f = externalFixture(t);
  f.state.issue = { ...f.state.issue, body: 'Changed current issue requirements.' };
  f.update();
  const externalBytes = readFileSync(f.externalPath, 'utf8');
  const initialCalls = f.calls().length;

  const result = f.plan();

  assert.equal(result.decision.action, 'preflight');
  assert.equal(result.obs.externalOverlaps.status, 'unobservable');
  assert.ok(result.obs.externalOverlaps.unknowns.some(item => item.code === 'prediction-unavailable'));
  assert.equal(f.calls().slice(initialCalls).filter(args => ['repo', 'api'].includes(args[0])).length, 0);
  assert.equal(readFileSync(f.externalPath, 'utf8'), externalBytes);
});

const overlapFixture = (t, enabled = true) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
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
  if (enabled) {
    assert.equal(JSON.parse(f.cli('plan', args).stdout).decision.action, 'review');
  }
  f.implement();
  const siblingHead = f.git(sibling, 'rev-parse', 'HEAD');
  f.state.prs = { 'issue-43': { number: 143, state: 'OPEN', headRefOid: siblingHead,
    mergeable: 'MERGEABLE', statusCheckRollup: [{ state: 'PENDING' }] } };
  f.update();
  return { ...f, siblingHead };
};

const readinessFixture = (t, predictions = { 42: ['docs/shared.md'], 43: ['docs/shared.md'] }) => {
  const f = fixture(t);
  const accepted = f.preflight({ scope: ['docs/', 'src/', 'tests/'], non_scope: [], predicted_files: predictions[42] });
  f.set('preflight', accepted);
  const lane = JSON.parse(readFileSync(f.lanePath));
  lane.preflight_overlap = 1;
  for (const [number, files] of Object.entries(predictions)) {
    if (number === '42') continue;
    const issue = Number(number);
    lane.issues[number] = { issue, branch: `issue-${issue}`, depends_on: [], approvals: { merge: false },
      attempts: {}, blocker: null, facts: { preflight: { value: createPreflight({
        ...accepted, issue, predicted_files: files,
      }) } } };
  }
  writeFileSync(f.lanePath, JSON.stringify(lane));
  const planIssue = issue => JSON.parse(f.cli('plan', ['--lane', f.lanePath, '--issue', String(issue)]).stdout);
  const implementIssue = (issue, file) => {
    if (issue === 42) {
      f.implement();
      if (file) f.commit(file, 'implementation 42\n');
    } else {
      const worktree = join(f.root, `.worktrees/issue-${issue}`);
      f.git(f.root, 'worktree', 'add', '-b', `issue-${issue}`, worktree, 'main');
      const path = join(worktree, file ?? `docs/issue-${issue}.md`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `implementation ${issue}\n`);
      f.git(worktree, 'add', '.');
      f.git(worktree, '-c', 'commit.gpgsign=false', 'commit', '-m', `implement ${issue}`);
    }
  };
  const recordIssue = (issue, phase, result) => f.cli('record', ['--lane', f.lanePath, '--issue', String(issue),
    '--phase', phase, '--result-json', JSON.stringify(result)]);
  const readiness = issue => JSON.parse(readFileSync(f.lanePath)).issues[String(issue)].facts['review-readiness'];
  const all = () => JSON.parse(f.cli('plan-all', ['--lane', f.lanePath]).stdout);
  return { ...f, planIssue, implementIssue, recordIssue, readiness, all };
};

test('#4323 review preparation: exact grant releases the live overlap and recovery re-enters at a new sequence', () =>
  withGatedWatch({
    makeFixture: context => {
      const file = 'src/shared.ts';
      const f = readinessFixture(context, { 42: [file], 43: [file] });
      for (const issue of [42, 43]) f.implementIssue(issue, file);
      const lane = JSON.parse(readFileSync(f.lanePath));
      lane.retry_policy = { retry_count_is_terminal: false, max_same_failure_repeats: null,
        max_wall_clock_minutes: null, stop_on_child_contract_error: true };
      writeFileSync(f.lanePath, JSON.stringify(lane));
      f.state.prs = { 'issue-42': { number: 142, state: 'OPEN', headRefOid: f.git(f.root, 'rev-parse', 'main'),
        mergeable: 'MERGEABLE', statusCheckRollup: [{ state: 'PENDING' }] } };
      f.update();
      f.recordIssue(42, 'review', { ok: false });
      f.recordIssue(42, 'implement', { ok: false });
      assert.equal(f.planIssue(42).decision.action, 'review');
      assert.equal(f.planIssue(43).decision.action, 'wait-preflight-overlap');
      return f;
    },
    gate: "process.argv[2]==='api' && process.argv.some(arg=>arg.includes('ExternalOverlapPullRequests'))",
  }, async ({ f, tick, output }) => {
    const firstTick = await tick(); // Supplementary observation, after the first snapshot unlocked.
    const readiness = f.readiness(42);
    const request = { reason: 'prior-head-red-unavailable', fix_back_eligible: false,
      head_sha: readiness.head, policy_sha256: readiness.value.policy_sha256, sequence: readiness.value.sequence };
    const record = (value = request, ok = true) => f.cli('record-review-preparation-blocker',
      [...f.common, '--value', JSON.stringify(value)], ok);
    const blocker = { type: 'input-preparation', phase: 'review', ...request };
    const expected = JSON.parse(readFileSync(f.lanePath));
    const events = () => readRetroEvents(f.root, 'fixture').filter(event => event.kind !== 'observation');
    const priorEvents = events();

    // Leave the watch paused until the atomic post-state has been inspected.
    record();
    expected.issues[42].blocker = blocker;
    expected.issues[42].facts['review-readiness'].value.active = false;
    assert.deepEqual(JSON.parse(readFileSync(f.lanePath)), expected);
    const blockedBytes = readFileSync(f.lanePath);
    record();
    assert.deepEqual(readFileSync(f.lanePath), blockedBytes);
    assert.deepEqual(events(), priorEvents);
    assert.equal(f.planIssue(42).decision.action, 'blocked');
    assert.equal(f.readiness(43), undefined, 'planning only the blocked issue cannot grant its sibling');

    firstTick.end('continue\n');
    const initial = await output(text => text.match(/issue 43: \(start\) -> wait-preflight-overlap[^\n]*\n/u));
    assert.match(initial[0], /"issue":42.*src\/shared\.ts/u);
    (await tick()).end('continue\n');
    const transition = await output(text => /issue 43: wait-preflight-overlap -> review\b[^\n]*\n/u.test(text) && text);
    assert.match(transition, /issue 42: review -> blocked/u);
    const sibling = f.readiness(43);
    assert.equal(sibling.value.sequence, request.sequence + 1);
    assert.deepEqual(f.all().map(row => row.decision.action), ['blocked', 'review']);
    assert.equal(f.planIssue(43).decision.action, 'review');

    const beforeClear = readFileSync(f.lanePath);
    record();
    assert.deepEqual(readFileSync(f.lanePath), beforeClear, 'an ended grant can replay even after sibling admission');
    f.cli('clear-blocker', [...f.common, '--phase', 'implement'], false);
    assert.deepEqual(readFileSync(f.lanePath), beforeClear);
    assert.deepEqual(events(), priorEvents);
    f.cli('clear-blocker', [...f.common, '--phase', 'review']);
    const cleared = JSON.parse(readFileSync(f.lanePath)).issues[42];
    const { review: reviewTelemetry, ...otherTelemetry } = expected.issues[42].retry_telemetry;
    assert.equal(reviewTelemetry.same_failure_repeats, 1);
    assert.deepEqual(cleared, { ...expected.issues[42], blocker: null,
      attempts: { ...expected.issues[42].attempts, review: 0 }, retry_telemetry: otherTelemetry });
    assert.deepEqual(events().slice(priorEvents.length).map(event => [event.kind, event.data.action, event.data.blocker]),
      [['incident', 'clear-blocker', blocker]]);
    assert.equal(f.planIssue(42).decision.action, 'wait-preflight-overlap');
    assert.deepEqual(f.readiness(42), cleared.facts['review-readiness']);
    assert.deepEqual(f.readiness(43), sibling);

    f.state.issues = { 43: { ...f.state.issue, state: 'CLOSED' } };
    f.update();
    assert.equal(f.planIssue(42).decision.action, 'review');
    assert.deepEqual(f.readiness(42), { ...readiness, value: { ...readiness.value, sequence: sibling.value.sequence + 1 } });
    const regrantedBytes = readFileSync(f.lanePath);
    assert.equal(record(request, false).stdout, '');
    assert.deepEqual(readFileSync(f.lanePath), regrantedBytes);

    const latest = { ...request, sequence: f.readiness(42).value.sequence };
    record(latest);
    assert.deepEqual(JSON.parse(f.recordIssue(42, 'implement', {
      ok: false, error: { type: 'child-contract-error' },
    }).stdout).blocker, { ...blocker, sequence: latest.sequence });
    f.commit('src/shared.ts', 'new review head while parked\n');
    const staleBytes = readFileSync(f.lanePath);
    assert.equal(record(latest, false).stdout, '');
    assert.deepEqual(readFileSync(f.lanePath), staleBytes);
  }));

test('#4323 review preparation: malformed, stale and ineligible requests preserve lane bytes and history', t => {
  const file = 'src/shared.ts';
  const f = readinessFixture(t, { 42: [file], 43: [file] });
  for (const issue of [42, 43]) f.implementIssue(issue, file);
  const { obs } = f.planIssue(42);
  const request = { reason: 'prior-head-red-unavailable', fix_back_eligible: false, head_sha: obs.headSha,
    policy_sha256: obs.preflightPolicy.sha256, sequence: f.readiness(42).value.sequence };
  const bytes = readFileSync(f.lanePath);
  const events = readRetroEvents(f.root, 'fixture');
  const reject = (value, expected, issue = '42', flags = []) => {
    const before = readFileSync(f.lanePath);
    const result = f.cli('record-review-preparation-blocker',
      ['--lane', f.lanePath, '--issue', issue, '--value', JSON.stringify(value), ...flags], false);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, expected);
    assert.deepEqual(readFileSync(f.lanePath), before);
  };

  const { sequence, ...missingSequence } = request;
  for (const bad of [null, [], missingSequence, { ...request, reviews: [] }, { ...request, phase: 'review' },
    { ...request, authority: true }, { ...request, reason: 'dispatch-target-unavailable' },
    { ...request, fix_back_eligible: true }, { ...request, fix_back_eligible: 'false' },
    { ...request, sequence: String(sequence) }, { ...request, sequence: 0 },
    { ...request, sequence: 1.5 }, { ...request, sequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...request, head_sha: request.head_sha.toUpperCase() }, { ...request, head_sha: 42 },
    { ...request, policy_sha256: 'short' }]) reject(bad, /review-preparation blocker input/u);
  reject(request, /review-preparation blocker arguments/u, '42', ['--phase', 'review']);
  reject(request, /review-preparation blocker arguments/u, '4.2e1');
  reject(request, /not in this lane/u, '999');
  reject({ ...request, head_sha: f.git(f.root, 'rev-parse', 'issue-43') }, /exact review grant/u);
  reject({ ...request, policy_sha256: '0'.repeat(64) }, /exact review grant/u);
  reject({ ...request, sequence: sequence + 1 }, /exact review grant/u);
  reject({ ...request, head_sha: f.git(f.root, 'rev-parse', 'issue-43') }, /exact review grant/u, '43');

  const lane = JSON.parse(bytes);
  for (const [change, expected] of [
    [copy => { delete copy.preflight_overlap; }, /preflight_overlap: 1/u],
    [copy => { copy.issues[42].facts['review-readiness'].value.active = 'true'; }, /invalid-review-readiness/u],
    [copy => { copy.issues[42].depends_on = [43]; }, /not eligible/u],
    [copy => { copy.issues[42].blocker = { type: 'input-preparation', phase: 'review', code: 'dispatch-target-unavailable' }; },
      /different blocker/u],
  ]) {
    const copy = structuredClone(lane);
    change(copy);
    writeFileSync(f.lanePath, JSON.stringify(copy));
    reject(request, expected);
  }
  writeFileSync(f.lanePath, bytes);
  for (const state of ['OPEN', 'CLOSED', 'MERGED']) {
    f.state.pr = { number: 142, state, headRefOid: obs.headSha,
      mergeable: 'MERGEABLE', statusCheckRollup: [{ state: 'PENDING' }] };
    f.update();
    reject(request, /not eligible/u);
  }
  f.state.pr = null;
  f.state.issue.state = 'CLOSED';
  f.update();
  reject(request, /not eligible/u);
  f.state.issue.state = 'OPEN';
  f.state.fail = 'issue';
  f.update();
  reject(request, /not eligible/u);
  delete f.state.fail;
  const originalBody = f.state.issue.body;
  f.state.issue.body += ' New issue requirements.';
  f.update();
  reject(request, /not eligible/u);
  assert.deepEqual(readFileSync(f.lanePath), bytes);
  assert.deepEqual(readRetroEvents(f.root, 'fixture'), events);

  f.state.issue.body = originalBody;
  const siblingHead = f.git(f.root, 'rev-parse', 'issue-43');
  f.state.prs = { 'issue-43': { number: 143, state: 'MERGED', headRefOid: siblingHead,
    mergeCommit: { oid: siblingHead }, mergeable: 'MERGEABLE', statusCheckRollup: [] } };
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', siblingHead);
  f.update();
  reject(request, /not eligible/u);
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', obs.baseSha);
  delete f.state.prs;
  f.update();
  writeFileSync(join(f.worktree, file), 'dirty checkout\n');
  reject(request, /current clean implementation checkout/u);
  f.git(f.worktree, 'restore', file);
  const completed = f.review();
  f.set('review', completed, obs.headSha);
  assert.equal(f.planIssue(42).decision.action, 'create-pr');
  reject(request, /not eligible/u);
  f.commit(file, 'changed review head\n');
  reject(request, /not eligible/u);
});

for (const [command, flags, granted] of [
  ['plan-all', [], [43, 44]],
  ['plan', ['--issue', '43'], [43]],
  ['watch', ['--once'], [43, 44]],
]) {
  test(`#4140 readiness: ${command} on an ungranted star -> only returned independent reviews persist without churn`, (t) => {
    const f = readinessFixture(t, {
      42: ['src/shared.ts', 'tests/shared.test.mjs'],
      43: ['src/shared.ts'],
      44: ['tests/shared.test.mjs'],
    });
    for (const issue of [42, 43, 44]) f.implementIssue(issue);

    const result = f.cli(command, ['--lane', f.lanePath, ...flags]);

    if (command === 'watch') {
      assert.match(result.stdout, /issue 42:.*-> wait-preflight-overlap/u);
      for (const issue of granted) assert.match(result.stdout, new RegExp(`issue ${issue}:.*-> review`, 'u'));
    } else if (command === 'plan-all') {
      const rows = JSON.parse(result.stdout);
      assert.deepEqual(rows.map(row => row.decision.action), ['wait-preflight-overlap', 'review', 'review']);
      assert.deepEqual(rows[0].decision.siblings.map(row => row.issue), [43, 44]);
    } else {
      assert.equal(JSON.parse(result.stdout).decision.action, 'review');
    }
    const lane = JSON.parse(readFileSync(f.lanePath));
    for (const issue of [42, 43, 44]) {
      if (!granted.includes(issue)) {
        assert.equal(f.readiness(issue), undefined);
        continue;
      }
      const { policy } = evaluatePreflight(lane.issues[issue].facts.preflight.value, {
        issue, issueSha256: lane.issues[issue].facts.preflight.value.issue_sha256,
        baseSha: lane.issues[issue].facts.preflight.value.base_sha, changedFiles: [],
      });
      assert.deepEqual(f.readiness(issue), {
        head: f.git(f.root, 'rev-parse', `issue-${issue}`),
        value: { policy_sha256: policy.sha256, sequence: 1, active: true },
      });
    }
    const bytes = readFileSync(f.lanePath);
    f.cli(command, ['--lane', f.lanePath, ...flags]);
    assert.deepEqual(readFileSync(f.lanePath), bytes);
  });
}

for (const termination of ['closed-pr', 'closed-issue']) {
  for (const [command, flags] of [
    ['plan', ['--issue', '42']], ['plan-all', []], ['plan-all', ['--with-retro']], ['watch', ['--once']],
  ]) {
    test(`readiness isolated: ${termination} ${command} ${flags.join(' ')} -> base review is granted without churn until overlap`, (t) => {
      const f = readinessFixture(t, { 42: ['docs/shared.md'] });
      f.implementIssue(42);
      const head = f.git(f.root, 'rev-parse', 'issue-42');
      f.state.prs = { 'issue-42': { number: 142, state: termination === 'closed-pr' ? 'CLOSED' : 'OPEN',
        headRefOid: head, mergeable: 'MERGEABLE', statusCheckRollup: [] } };
      if (termination === 'closed-issue') f.state.issues = { 42: { ...f.state.issue, state: 'CLOSED' } };
      f.update();
      const markerBytes = readFileSync(f.lanePath);
      const legacy = JSON.parse(markerBytes);
      const accepted = legacy.issues['42'].facts.preflight.value;
      delete legacy.preflight_overlap;
      writeFileSync(f.lanePath, JSON.stringify(legacy));
      const base = f.planIssue(42).decision;
      assert.equal(base.action, 'review');
      writeFileSync(f.lanePath, markerBytes);
      assert.equal(f.readiness(42), undefined);
      const outputGuard = join(f.root, 'bin/readiness-output.mjs');
      writeFileSync(outputGuard, `import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
if(process.argv[1]?.endsWith('/lane-v4-cli.mjs')) {
  const write=process.stdout.write;
  process.stdout.write=function(chunk,...args) {
    if(/"action"\\s*:\\s*"review"| -> review/u.test(String(chunk))) {
      const lane=JSON.parse(readFileSync(${JSON.stringify(f.lanePath)}));
      const fact=lane.issues['42'].facts['review-readiness'];
      assert.deepEqual(fact,{head:${JSON.stringify(head)},value:{
        policy_sha256:${JSON.stringify(base.policy.sha256)},sequence:1,active:true}},
        'review output requires its grant already on disk');
    }
    return write.call(this,chunk,...args);
  };
}
`);
      const originalOptions = f.env.NODE_OPTIONS;
      f.env.NODE_OPTIONS = `${originalOptions ?? ''} --import ${outputGuard}`.trim();

      const result = f.cli(command, ['--lane', f.lanePath, ...flags]);

      if (command === 'watch') assert.match(result.stdout, /issue 42:.*-> review/u);
      else {
        const value = JSON.parse(result.stdout);
        const row = command === 'plan' ? value : (Array.isArray(value) ? value : value.issues)[0];
        assert.deepEqual(row.decision, base);
      }
      const fact = f.readiness(42);
      assert.deepEqual(fact, { head, value: { policy_sha256: base.policy.sha256, sequence: 1, active: true } });
      const unchanged = readFileSync(f.lanePath);
      assert.deepEqual(f.planIssue(42).decision, base);
      assert.deepEqual(readFileSync(f.lanePath), unchanged);
      if (originalOptions === undefined) delete f.env.NODE_OPTIONS;
      else f.env.NODE_OPTIONS = originalOptions;
      f.recordIssue(42, 'implement', { ok: true, agent: 'fluo-issue-implementer' });
      assert.deepEqual(f.readiness(42), fact, 'same-head record preserves a grantable non-occupant');
      assert.deepEqual(f.planIssue(42).decision, base);
      assert.deepEqual(f.readiness(42), fact);
      const lane = JSON.parse(readFileSync(f.lanePath));
      lane.issues['43'] = { issue: 43, branch: 'issue-43', depends_on: [], approvals: { merge: false },
        attempts: {}, blocker: null, facts: {} };
      writeFileSync(f.lanePath, JSON.stringify(lane));
      f.implementIssue(43);
      f.cli('set-fact', ['--lane', f.lanePath, '--issue', '43', '--kind', 'preflight',
        '--value', JSON.stringify(createPreflight({ ...accepted, issue: 43 }))]);

      const rows = f.all();

      assert.deepEqual(rows.map(row => row.decision.action), ['blocked', 'review']);
      assert.equal(rows[0].decision.reason, termination === 'closed-pr' ? 'pr-closed-externally' : 'issue-closed-externally');
      assert.deepEqual(f.readiness(42), { ...fact, value: { ...fact.value, active: false } });
      assert.equal(rows[1].decision.siblings, undefined);
      assert.equal(f.readiness(43).value.sequence, 2);
      assert.equal(f.readiness(43).value.active, true);
    });
  }

  test(`readiness isolated: ${termination} with an existing grant -> re-observation preserves exact bytes and sequence`, (t) => {
    const f = readinessFixture(t, { 42: ['docs/shared.md'] });
    f.implementIssue(42);
    const head = f.git(f.root, 'rev-parse', 'issue-42');
    f.state.prs = { 'issue-42': { number: 142, state: termination === 'closed-pr' ? 'CLOSED' : 'OPEN',
      headRefOid: head, mergeable: 'MERGEABLE', statusCheckRollup: [] } };
    if (termination === 'closed-issue') f.state.issues = { 42: { ...f.state.issue, state: 'CLOSED' } };
    f.update();
    const lane = JSON.parse(readFileSync(f.lanePath));
    const accepted = lane.issues['42'].facts.preflight.value;
    const { policy } = evaluatePreflight(accepted, { issue: 42, issueSha256: accepted.issue_sha256,
      baseSha: accepted.base_sha, changedFiles: ['docs/guide.md'] });
    const fact = { head, value: { policy_sha256: policy.sha256, sequence: 7, active: true } };
    lane.issues['42'].facts['review-readiness'] = fact;
    writeFileSync(f.lanePath, JSON.stringify(lane));
    const bytes = readFileSync(f.lanePath);

    const result = f.planIssue(42);

    assert.equal(result.decision.action, 'review');
    assert.deepEqual(f.readiness(42), fact);
    assert.deepEqual(readFileSync(f.lanePath), bytes);
  });

  test(`review eligibility CLI: ${termination} with an overlap -> no ungranted review through any output path`, (t) => {
    const f = readinessFixture(t);
    f.implementIssue(43);
    f.state.prs = { 'issue-43': { number: 143, state: termination === 'closed-pr' ? 'CLOSED' : 'OPEN',
      headRefOid: f.git(f.root, 'rev-parse', 'issue-43'), mergeable: 'MERGEABLE', statusCheckRollup: [] } };
    if (termination === 'closed-issue') f.state.issues = { 43: { ...f.state.issue, state: 'CLOSED' } };
    f.update();
    const reason = termination === 'closed-pr' ? 'pr-closed-externally' : 'issue-closed-externally';
    const args = ['--lane', f.lanePath];

    assert.equal(f.planIssue(43).decision.action, 'blocked');
    assert.equal(f.planIssue(43).decision.reason, reason);
    for (const flags of [[], ['--with-retro']]) {
      const value = JSON.parse(f.cli('plan-all', [...args, ...flags]).stdout);
      const rows = Array.isArray(value) ? value : value.issues;
      assert.equal(rows.find(row => row.issue === 43).decision.action, 'blocked');
    }
    assert.match(f.cli('watch', [...args, '--once']).stdout, /issue 43:.*-> blocked/u);
    assert.equal(f.readiness(43), undefined);
    f.implementIssue(42);
    assert.equal(f.planIssue(42).decision.action, 'review');
    assert.equal(f.readiness(42).value.active, true);
    assert.equal(f.readiness(43), undefined);
  });
}

for (const mode of ['missing', 'unknown', 'integrate']) {
  test(`review eligibility CLI: merged x and ${mode} x/y -> y can review and the old x/y grant is inactive`, (t) => {
    const f = readinessFixture(t, { 42: ['docs/x.md', 'docs/y.md'], 43: ['docs/y.md'], 41: ['docs/x.md'] });
    f.implementIssue(42);
    f.planIssue(42);
    assert.equal(f.readiness(42).value.sequence, 1);
    f.implementIssue(41);
    f.implementIssue(43);
    const head = f.git(f.root, 'rev-parse', 'issue-41');
    if (mode === 'integrate') {
      f.git(f.root, 'merge', '--ff-only', 'issue-41');
      f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    }
    f.state.prs = { 'issue-41': { number: 141, state: 'MERGED', headRefOid: head,
      mergeCommit: mode === 'missing' ? null : { oid: mode === 'unknown' ? 'f'.repeat(40) : head },
      mergeable: 'MERGEABLE', statusCheckRollup: [] } };
    f.update();

    const rows = f.all();

    assert.equal(rows.find(row => row.issue === 42).decision.action,
      mode === 'integrate' ? 'resolve-conflict' : 'observation-failed');
    assert.equal(rows.find(row => row.issue === 43).decision.action, 'review');
    assert.equal(f.readiness(42).value.active, false);
    assert.equal(f.readiness(43).value.sequence, 2);
    assert.equal(f.planIssue(43).decision.action, 'review');
  });
}

test('readiness boundary: malformed persisted grant -> typed field error before every decision or ledger write', (t) => {
  const f = readinessFixture(t);
  f.implementIssue(43);
  f.planIssue(43);
  f.implementIssue(42);
  const original = JSON.parse(readFileSync(f.lanePath));
  const cases = [
    ...[0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1].map(sequence =>
      ({ field: 'sequence', corrupt: fact => { fact.value.sequence = sequence; } })),
    { field: 'sequence', corrupt: fact => { delete fact.value.sequence; } },
    { field: 'sequence', corrupt: fact => { fact.value.active = false; fact.value.sequence = 0; } },
    ...['true', 1, null].map(active => ({ field: 'active', corrupt: fact => { fact.value.active = active; } })),
    { field: 'active', corrupt: fact => { delete fact.value.active; } },
    { field: 'policy_sha256', corrupt: fact => { delete fact.value.policy_sha256; } },
    { field: 'policy_sha256', corrupt: fact => { fact.value.policy_sha256 = 'bad'; } },
    { field: 'head', corrupt: fact => { delete fact.head; } },
    { field: 'head', corrupt: fact => { fact.head = 'bad'; } },
    { field: 'value', corrupt: fact => { fact.value = null; } },
    { field: 'owner', corrupt: fact => { fact.owner = 'unexpected'; } },
    { field: 'lease', corrupt: fact => { fact.value.lease = 1; } },
  ];
  const commands = [
    ['plan', ['--issue', '42']], ['plan-all', []], ['watch', ['--once']],
    ['approve-merge', ['--issue', '42']],
  ];
  for (const { field, corrupt } of cases) {
    const lane = structuredClone(original);
    corrupt(lane.issues['43'].facts['review-readiness']);
    writeFileSync(f.lanePath, JSON.stringify(lane));
    const bytes = readFileSync(f.lanePath);

    for (const [command, args] of commands) {
      const result = f.cli(command, ['--lane', f.lanePath, ...args], false);
      const error = JSON.parse(result.stderr);
      assert.equal(error.code, 'invalid-review-readiness');
      assert.equal(error.issue, 43);
      assert.equal(error.field.endsWith(`.${field}`), true, error.field);
      assert.equal(result.stdout, '');
      assert.deepEqual(readFileSync(f.lanePath), bytes);
    }
  }
  for (const fact of [null, [], { head: original.issues['43'].facts['review-readiness'].head }]) {
    const lane = structuredClone(original);
    lane.issues['43'].facts['review-readiness'] = fact;
    writeFileSync(f.lanePath, JSON.stringify(lane));
    const bytes = readFileSync(f.lanePath);
    for (const [command, args] of [
      ['plan-all', ['--with-retro']], ['retro-plan', []],
      ['record', ['--issue', '42', '--phase', 'implement', '--result-json', '{"ok":false}']],
      ['set-fact', ['--issue', '42', '--kind', 'preflight', '--value', '{}']],
      ['clear-blocker', ['--issue', '42', '--phase', 'implement']],
    ]) {
      const result = f.cli(command, ['--lane', f.lanePath, ...args], false);
      const error = JSON.parse(result.stderr);
      assert.equal(error.code, 'invalid-review-readiness');
      assert.equal(error.issue, 43);
      assert.equal(error.field.startsWith('facts.review-readiness'), true);
      assert.equal(result.stdout, '');
      assert.deepEqual(readFileSync(f.lanePath), bytes);
    }
  }
});

test('readiness boundary: well-formed stale facts deactivate and legacy malformed keys stay unvalidated and read-only', (t) => {
  const f = readinessFixture(t);
  f.implementIssue(43);
  f.planIssue(43);
  const saved = JSON.parse(readFileSync(f.lanePath));
  for (const field of ['head', 'policy_sha256']) {
    const lane = structuredClone(saved);
    if (field === 'head') lane.issues['43'].facts['review-readiness'].head = 'f'.repeat(40);
    else lane.issues['43'].facts['review-readiness'].value.policy_sha256 = 'f'.repeat(64);
    writeFileSync(f.lanePath, JSON.stringify(lane));
    f.cli('retro-plan', ['--lane', f.lanePath]);
    assert.equal(f.readiness(43).value.active, false);
    assert.equal(f.readiness(43).value.sequence, 1);
    assert.equal(f.planIssue(43).decision.action, 'review');
    assert.equal(f.readiness(43).value.sequence, 2);
  }
  const legacy = structuredClone(saved);
  delete legacy.preflight_overlap;
  legacy.issues['43'].facts['review-readiness'] = { value: { sequence: 'bad', active: 'bad' }, arbitrary: [] };
  writeFileSync(f.lanePath, JSON.stringify(legacy));
  const bytes = readFileSync(f.lanePath);

  assert.equal(f.planIssue(43).decision.action, 'review');
  assert.equal(f.all().find(row => row.issue === 43).decision.action, 'review');
  assert.match(f.cli('watch', ['--lane', f.lanePath, '--once']).stdout, /issue 43:.*-> review/u);
  assert.deepEqual(readFileSync(f.lanePath), bytes);
});

test('readiness outputs: JSON plan, all, retro variant and first watch tick -> every returned review has its saved grant', (t) => {
  for (const [command, flags] of [
    ['plan', ['--issue', '43']], ['plan-all', []], ['plan-all', ['--with-retro']], ['watch', ['--once']],
  ]) {
    const f = readinessFixture(t);
    f.implementIssue(43);
    assert.equal(f.readiness(43), undefined);

    const result = f.cli(command, ['--lane', f.lanePath, ...flags]);

    if (command === 'watch') assert.match(result.stdout, /issue 43:.*-> review/u);
    else {
      const value = JSON.parse(result.stdout);
      const row = command === 'plan' ? value : (Array.isArray(value) ? value : value.issues).find(row => row.issue === 43);
      assert.equal(row.decision.action, 'review');
    }
    assert.equal(f.readiness(43).value.active, true);
    assert.equal(f.readiness(43).value.sequence, 1);
    assert.equal(f.readiness(42), undefined);
  }
});

test('readiness concurrency control: two real plan processes and a late implementation -> only the saved first grant can occupy', async (t) => {
  const f = readinessFixture(t);
  f.implementIssue(43);
  const signal = AbortSignal.timeout(20_000);
  const sockets = [];
  const server = createServer(socket => {
    sockets.push(socket);
    socket.once('data', bytes => server.emit(bytes.toString().trim(), socket));
  });
  const listening = once(server, 'listening', { signal });
  server.listen(0, '127.0.0.1');
  await listening;
  const port = String(server.address().port);
  const gh = join(f.root, 'bin/gh');
  const original = readFileSync(gh, 'utf8').replace(/^#![^\n]*\n/u, '');
  writeFileSync(gh, `#!${process.execPath}
import { connect as fixtureConnect } from 'node:net';
if(process.env.PLAN_BARRIER && process.argv[2]==='pr' && process.argv[4]==='issue-42') {
  await new Promise((done,reject)=>{
    const socket=fixtureConnect(Number(process.env.PLAN_BARRIER),'127.0.0.1');
    socket.on('connect',()=>socket.write('held\\n'));
    socket.on('end',done); socket.on('error',reject); socket.resume();
  });
}
${original}`);
  const startedFile = join(f.root, 'bin/started.mjs');
  writeFileSync(startedFile, `import {connect} from 'node:net';
await new Promise((done,reject)=>{
 const socket=connect(Number(process.env.STARTED_PORT),'127.0.0.1');
 socket.on('connect',()=>socket.end('started\\n')); socket.on('close',done); socket.on('error',reject);
});
`);
  const children = [];
  const planning = (issue, env) => {
    const child = spawn(process.execPath, [script, 'plan', '--root', f.root, '--lane', f.lanePath,
      '--issue', String(issue)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const closed = once(child, 'close', { signal });
    children.push({ child, closed });
    return { child, closed, result: () => JSON.parse(stdout), stderr: () => stderr };
  };
  t.after(async () => {
    for (const { child } of children) child.kill('SIGKILL');
    for (const socket of sockets) socket.destroy();
    server.close();
    await Promise.all(children.map(({ closed }) => closed));
  });
  const held = once(server, 'held', { signal });
  const first = planning(43, { ...f.env, PLAN_BARRIER: port });
  const [holder] = await held;
  f.implementIssue(42);
  const started = once(server, 'started', { signal });
  const second = planning(42, { ...f.env, STARTED_PORT: port,
    NODE_OPTIONS: `${f.env.NODE_OPTIONS ?? ''} --import ${startedFile}`.trim() });
  await started;
  holder.end('release\n');
  const [[firstCode], [secondCode]] = await Promise.all([first.closed, second.closed]);

  assert.equal(firstCode, 0, first.stderr());
  assert.equal(secondCode, 0, second.stderr());
  assert.equal(first.result().decision.action, 'review');
  assert.equal(second.result().decision.action, 'wait-preflight-overlap');
  assert.deepEqual(second.result().decision.siblings.map(row => row.issue), [43]);
  assert.equal(f.readiness(43).value.sequence, 1);
  assert.equal(f.readiness(42), undefined);
});

for (const action of ['review', 'wait-ci']) {
test(`readiness wait control: watch ${action} awaiting its next tick -> independent writer finishes before watch is stopped`, async (t) => {
  const f = readinessFixture(t);
  f.implementIssue(43);
  if (action === 'wait-ci') {
    const { obs } = f.planIssue(43);
    const value = { head_sha: obs.headSha, preflight_sha256: obs.preflightPolicy.sha256,
      active_axes: obs.preflightPolicy.active_axes, reviews: obs.preflightPolicy.active_axes.map(reviewer => ({
        reviewer, agent: `fluo-${reviewer}-reviewer`, reviewed_head_sha: obs.headSha,
        preflight_sha256: obs.preflightPolicy.sha256, verdict_signal: 'PASS', blockers: [],
        evidence: [{ acceptance: 'Keep public behavior', locations: ['docs/guide.md:1'] }], observations: [],
      })) };
    f.cli('set-fact', ['--lane', f.lanePath, '--issue', '43', '--kind', 'review', '--head', obs.headSha,
      '--value', JSON.stringify(value)]);
    f.state.prs = { 'issue-43': { number: 143, state: 'OPEN', headRefOid: obs.headSha,
      mergeable: 'MERGEABLE', statusCheckRollup: [{ state: 'PENDING' }] } };
    f.update();
  }
  const signal = AbortSignal.timeout(15_000);
  const child = spawn(process.execPath, [script, 'watch', '--root', f.root, '--lane', f.lanePath,
    '--interval', '3600'], { env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error(`watch not ready: ${stdout}\n${stderr}`)), { once: true });
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.split('\n').some(line => line.includes('issue 43:') && line.includes(`-> ${action}`))) resolve();
    });
  });
  const closed = once(child, 'close');
  t.after(async () => { child.kill('SIGKILL'); await closed; });
  await ready;

  f.cli('approve-merge', ['--lane', f.lanePath, '--issue', '43']);

  assert.equal(child.exitCode, null, 'writer completed while watch is still waiting');
  assert.equal(JSON.parse(readFileSync(f.lanePath)).issues['43'].approvals.merge, true);
  assert.equal(f.readiness(43).value.active, true);
});
}

test('readiness: first returned review survives a later implementation, late PR and same-head record across processes', (t) => {
  const f = readinessFixture(t);
  assert.equal(f.planIssue(42).decision.action, 'implement');
  f.implementIssue(43);

  const first = f.planIssue(43);

  assert.equal(first.decision.action, 'review');
  assert.deepEqual(f.readiness(43), { head: first.obs.headSha,
    value: { policy_sha256: first.obs.preflightPolicy.sha256, sequence: 1, active: true } });
  assert.equal(f.readiness(42), undefined);
  const bytes = readFileSync(f.lanePath);
  f.planIssue(43);
  assert.deepEqual(readFileSync(f.lanePath), bytes, 'unchanged plan never rewrites readiness');
  f.implementIssue(42);
  f.recordIssue(42, 'implement', { ok: true, agent: 'fluo-issue-implementer' });
  f.recordIssue(43, 'implement', { ok: true, agent: 'fluo-issue-implementer' });
  assert.deepEqual(f.all().map(row => row.decision.action), ['wait-preflight-overlap', 'review']);
  f.state.prs = { 'issue-42': { number: 142, state: 'OPEN', headRefOid: f.git(f.root, 'rev-parse', 'issue-42'),
    mergeable: 'MERGEABLE', statusCheckRollup: [{ state: 'PENDING' }] } };
  f.update();
  assert.deepEqual(f.all().map(row => row.decision.action), ['wait-preflight-overlap', 'review']);
  assert.equal(f.readiness(43).value.sequence, 1);
  assert.equal(f.readiness(42), undefined);
  const watched = f.cli('watch', ['--lane', f.lanePath, '--once']).stdout;
  assert.match(watched, /issue 42:.*wait-preflight-overlap/u);
  assert.match(watched, /issue 43:.*review/u);
  f.state.fail = '43';
  f.update();
  assert.deepEqual(f.all().map(row => row.decision.action), ['review', 'observation-failed']);
  assert.equal(f.readiness(43).value.active, false);
  assert.equal(f.readiness(42).value.sequence, 2);
  delete f.state.fail;
  f.update();
  assert.deepEqual(f.all().map(row => row.decision.action), ['review', 'wait-preflight-overlap']);
  assert.equal(f.readiness(43).value.sequence, 1);
});

test('readiness: internal rows, timestamps and observation recovery -> only returned reviews receive monotone sequences', (t) => {
  const f = readinessFixture(t, { 42: ['docs/a.md'], 43: ['docs/b.md'], 44: ['docs/c.md'] });
  const clock = join(f.root, 'bin/clock.mjs');
  writeFileSync(clock, `const RealDate=Date;
globalThis.Date=class extends RealDate {
  constructor(...args){super(...(args.length?args:[process.env.FIXTURE_TIME]));}
  static now(){return new RealDate(process.env.FIXTURE_TIME).getTime();}
};
`);
  f.env.NODE_OPTIONS = `${f.env.NODE_OPTIONS ?? ''} --import ${clock}`.trim();
  f.env.FIXTURE_TIME = '2099-01-01T00:00:00.000Z';
  for (const issue of [42, 43, 44]) f.implementIssue(issue);
  f.planIssue(43);
  assert.equal(f.readiness(42), undefined);
  assert.equal(f.readiness(44), undefined);
  assert.equal(f.readiness(43).value.sequence, 1);
  let lane = JSON.parse(readFileSync(f.lanePath));
  for (const entry of Object.values(lane.issues)) entry.facts.implement = { head: f.git(f.root, 'rev-parse', entry.branch),
    accepted_at: '2099-01-01T00:00:00.000Z', value: {} };
  writeFileSync(f.lanePath, JSON.stringify(lane));
  f.all();
  assert.equal(f.readiness(42).value.sequence, 2);
  assert.equal(f.readiness(44).value.sequence, 2, 'independent grants in one snapshot share a sequence');
  f.state.fail = '43';
  f.update();
  const failed = f.all();
  assert.equal(failed[1].decision.action, 'observation-failed');
  assert.equal(f.readiness(43).value.active, false);
  assert.equal(failed[0].decision.action, 'review');
  delete f.state.fail;
  f.update();
  lane = JSON.parse(readFileSync(f.lanePath));
  lane.issues['43'].facts.implement.accepted_at = '1900-01-01T00:00:00.000Z';
  writeFileSync(f.lanePath, JSON.stringify(lane));
  f.env.FIXTURE_TIME = '1900-01-01T00:00:00.000Z';
  f.planIssue(43);
  assert.equal(f.readiness(43).value.sequence, 3);
});

test('readiness: blocker set and cleared before a plan -> old sequence remains inactive until a new grant', (t) => {
  const f = readinessFixture(t);
  f.implementIssue(43);
  f.planIssue(43);
  for (let attempt = 0; attempt < 3; attempt++) f.recordIssue(43, 'implement', { ok: false });
  assert.equal(f.readiness(43).value.active, false, 'record invalidates inside its write transaction');
  f.cli('clear-blocker', ['--lane', f.lanePath, '--issue', '43', '--phase', 'implement']);
  assert.equal(f.readiness(43).value.active, false);
  f.implementIssue(42);
  const next = f.all();
  assert.deepEqual(next.map(row => row.decision.action), ['review', 'wait-preflight-overlap']);
  assert.equal(f.readiness(42).value.sequence, 2);
  assert.equal(f.readiness(43).value.sequence, 1);
});

test('readiness: fix-back, new head and policy change -> no inherited position or stale active fact', (t) => {
  const f = readinessFixture(t);
  f.implementIssue(42);
  const first = f.planIssue(42);
  const blocked = f.review();
  blocked.reviews[0].verdict_signal = 'BLOCK';
  blocked.reviews[0].blockers = [{ reviewer: blocked.reviews[0].reviewer, signature: 'fixture-fix',
    evidence: 'Fix the fixture head', fix_back_eligible: true, status: 'unresolved' }];
  f.set('review', blocked, first.obs.headSha);
  assert.equal(f.readiness(42).value.active, false, 'BLOCK invalidates before another plan');
  f.commit('docs/fixed.md', 'fixed\n');
  f.recordIssue(42, 'fix-back', { ok: true, agent: 'fluo-issue-implementer' });
  assert.equal(f.readiness(42).value.active, false);
  const fixed = f.planIssue(42);
  assert.notEqual(fixed.obs.headSha, first.obs.headSha);
  assert.equal(f.readiness(42).value.sequence, 2);
  const changed = createPreflight({ ...fixed.obs.preflight, acceptance: ['Updated accepted policy'] });
  f.set('preflight', changed);
  assert.equal(f.readiness(42).value.active, false);
  f.planIssue(42);
  assert.equal(f.readiness(42).value.sequence, 3);
  f.commit('docs/next-head.md', 'another implementation\n');
  f.recordIssue(42, 'implement', { ok: true, agent: 'fluo-issue-implementer' });
  assert.equal(f.readiness(42).value.active, false, 'a head change is invalidated by record before a plan');
  f.planIssue(42);
  assert.equal(f.readiness(42).value.sequence, 4);
  const passed = f.review();
  f.set('review', passed, passed.head_sha);
  assert.equal(f.planIssue(42).decision.action, 'create-pr');
  f.state.pr = { number: 142, state: 'OPEN', headRefOid: first.obs.headSha,
    mergeable: 'MERGEABLE', statusCheckRollup: [{ state: 'PENDING' }] };
  f.update();
  assert.equal(f.planIssue(42).decision.action, 'push');
  f.state.pr.headRefOid = passed.head_sha;
  f.update();
  assert.equal(f.planIssue(42).decision.action, 'wait-ci');
  f.state.pr.statusCheckRollup = [{ conclusion: 'SUCCESS' }];
  f.update();
  assert.equal(f.planIssue(42).decision.action, 'request-merge-approval');
  f.cli('approve-merge', f.common);
  assert.equal(f.planIssue(42).decision.action, 'merge');
  assert.equal(f.readiness(42).value.sequence, 4);
  assert.equal(f.readiness(42).value.active, true);
  f.state.pr.state = 'CLOSED';
  f.update();
  assert.equal(f.planIssue(42).decision.action, 'blocked');
  assert.equal(f.readiness(42).value.active, false);
});

test('readiness: partial overlap with A and C granted -> B cannot overtake C after A terminates', (t) => {
  const f = readinessFixture(t, { 42: ['docs/a.md'], 43: ['docs/a.md', 'docs/c.md'], 44: ['docs/c.md'] });
  for (const issue of [42, 43, 44]) f.implementIssue(issue);
  assert.deepEqual(f.all().map(row => row.decision.action), ['review', 'wait-preflight-overlap', 'review']);
  assert.equal(f.readiness(42).value.sequence, 1);
  assert.equal(f.readiness(44).value.sequence, 1);
  for (let attempt = 0; attempt < 3; attempt++) f.recordIssue(42, 'implement', { ok: false });
  assert.deepEqual(f.all().map(row => row.decision.action), ['blocked', 'wait-preflight-overlap', 'review']);
  assert.deepEqual(f.planIssue(43).decision.siblings.map(row => row.issue), [44]);
  assert.equal(f.readiness(43), undefined);
});

test('readiness: real merged base integration -> deactivate the old grant and issue a new head sequence', (t) => {
  const f = readinessFixture(t);
  f.implementIssue(42);
  f.planIssue(42);
  f.implementIssue(43);
  const mergeCommit = f.git(f.root, 'rev-parse', 'issue-43');
  f.git(f.root, 'merge', '--ff-only', 'issue-43');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  f.state.prs = { 'issue-43': { number: 143, state: 'MERGED', headRefOid: mergeCommit,
    mergeCommit: { oid: mergeCommit }, mergeable: 'MERGEABLE', statusCheckRollup: [] } };
  f.update();

  const integrate = f.planIssue(42);

  assert.equal(integrate.decision.reason, 'preflight-overlap-base-integration');
  assert.equal(f.readiness(42).value.active, false);
  f.git(f.worktree, 'merge', '--no-edit', integrate.decision.base);
  f.recordIssue(42, 'resolve-conflict', { ok: true, head_sha: f.git(f.worktree, 'rev-parse', 'HEAD') });
  assert.equal(f.planIssue(42).decision.action, 'review');
  assert.equal(f.readiness(42).value.sequence, 2);
});

for (const removalFails of [false, true]) {
  test(removalFails
    ? '#4153 watch readiness: ENOTEMPTY while removing the root -> resources already closed'
    : 'watch readiness targets: three OPEN PRs and record blocker between fixture handshakes -> changed selected sibling and blocked state', async () => {
    const rootAtClose = {};
    let root;
    let removalError;
    const run = () => withGatedWatch({
      makeFixture: context => {
        const removeWithFault = remove => () => {
          try {
            rmdirSync(root);
          } catch (error) {
            removalError = error;
            throw error;
          } finally {
            remove?.();
          }
        };
        const f = readinessFixture(removalFails ? { after: remove => context.after(removeWithFault(remove)) } : context,
          { 42: ['docs/shared.md'], 43: ['docs/shared.md'], 44: ['docs/shared.md'] });
        root = f.root;
        if (removalFails && process.env.FLUO_PRODUCT_TEST_EVIDENCE) context.after(removeWithFault());
        for (const issue of [42, 43, 44]) f.implementIssue(issue);
        f.state.prs = Object.fromEntries([42, 43, 44].map(issue => [`issue-${issue}`, {
          number: issue + 100, state: 'OPEN', headRefOid: f.git(f.root, 'rev-parse', `issue-${issue}`),
          mergeable: 'MERGEABLE', statusCheckRollup: [{ state: 'PENDING' }],
        }]));
        f.update();
        return f;
      },
      gate: "process.argv[2]==='pr' && process.argv[4]==='issue-44'",
      releaseOnTick: true,
      onListening: (fixtureRoot, server) => {
        server.once('close', () => { rootAtClose.listener = existsSync(fixtureRoot); });
        server.on('connection', socket => {
          rootAtClose.socket = false;
          socket.once('close', () => { rootAtClose.socket = existsSync(fixtureRoot); });
        });
      },
    }, async ({ child, tick, output, recordBlocker }) => {
      child.once('close', () => { rootAtClose.child = existsSync(root); });
      const first = await output(text => text.split('\n').find(line =>
        line.includes('issue 44:') && line.includes('wait-preflight-overlap')));
      assert.match(first, /siblings=\[\{"issue":42,/u);
      await tick();
      for (let attempt = 0; attempt < 3; attempt++) await recordBlocker();
      const changed = await output(text => text.split('\n').find(line =>
        line.includes('issue 44: wait-preflight-overlap -> wait-preflight-overlap') && line.includes('siblings=[{"issue":43,')));

      assert.match(changed, /"issue":42[^]*"state":"blocked"/u);
      assert.match(changed, /siblings=\[\{"issue":43,/u);
    });
    if (removalFails) {
      await assert.rejects(run, error => error === removalError && error.code === 'ENOTEMPTY');
    } else await run();
    assert.deepEqual(rootAtClose, { child: true, socket: true, listener: true });
  });
}

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

test('#4130 fix-back CLI: rejected conflict result with ok true -> retrospective records zero successful resolutions', (t) => {
  const f = fixture(t);
  f.set('preflight', f.preflight());
  f.implement();
  const lane = JSON.parse(readFileSync(f.lanePath));
  lane.retry_policy = importedAdaptive;
  writeFileSync(f.lanePath, JSON.stringify(lane));
  const result = { ok: true, head_sha: 'f'.repeat(40), error: { type: 'child-contract-error' } };

  const recorded = JSON.parse(f.cli('record', [...f.common, '--phase', 'resolve-conflict',
    '--result-json', JSON.stringify(result)]).stdout);
  const evidence = JSON.parse(f.cli('retro-evidence', ['--lane', f.lanePath]).stdout);

  assert.deepEqual(recorded.blocker, { type: 'child-contract-error', phase: 'resolve-conflict' });
  assert.equal(recorded.attempts['resolve-conflict'], 1);
  const event = evidence.events.find(event => event.kind === 'stage' && event.data.phase === 'resolve-conflict');
  assert.deepEqual(event.data.result, result);
  assert.equal(event.data.attempts['resolve-conflict'], 1);
  assert.deepEqual(evidence.conflictResolutions, [{ issue: 42, observedConflictResolutions: 0,
    heads: [], eventIds: [], history: 'unknown' }]);
});
