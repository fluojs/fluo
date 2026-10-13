import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPreflight, evaluatePreflight } from '../../issue-preflight/scripts/contracts.mjs';
import { prepareReviewInput, prepareSourceFootprint, sourceFootprintCategories } from './workflow-preparation.mjs';
import { createCommandRunner } from '../../../../examples/react-vite-ssr/tests/verify-background-starter.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const modulePath = fileURLToPath(new URL('./workflow-preparation.mjs', import.meta.url));

function fixture(t) {
  const directory = process.env.FLUO_PRODUCT_TEST_EVIDENCE ?? tmpdir();
  mkdirSync(directory, { recursive: true });
  const root = mkdtempSync(join(directory, 'fluo-workflow-preparation-'));
  if (!process.env.FLUO_PRODUCT_TEST_EVIDENCE) t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Preparation Test');
  git(root, 'config', 'user.email', 'preparation@example.invalid');
  writeFileSync(join(root, 'source.mjs'), 'export const value = 1;\n');
  git(root, 'add', 'source.mjs');
  git(root, 'commit', '-qm', 'base');
  const base = git(root, 'rev-parse', 'HEAD');
  const footprintInput = { version: 1, issue: 42, issue_sha256: 'c'.repeat(64), base_sha: base,
    categories: Object.fromEntries(sourceFootprintCategories.map((name) => [name, {
      affected: name === 'direct_callers', reason: `${name}: fixture source has no other integration`,
      sources: [{ path: 'source.mjs', sha256: hash(readFileSync(join(root, 'source.mjs'))) }],
      searches: [`Inspect source.mjs for ${name}`],
    }])) };
  const footprint = prepareSourceFootprint(root, footprintInput);
  const contract = createPreflight({ issue: 42, issue_sha256: 'c'.repeat(64), base_sha: base,
    scope: ['source.mjs'], non_scope: [], predicted_files: ['source.mjs'],
    acceptance: ['Keep executable value behavior'], validation: ['node focused check'] });
  git(root, 'checkout', '-qb', 'issue-42');
  // An upstream commit incorporated by merge must not enter the authored diff.
  git(root, 'checkout', '-q', 'main');
  writeFileSync(join(root, 'upstream.txt'), 'upstream\n');
  git(root, 'add', 'upstream.txt');
  git(root, 'commit', '-qm', 'upstream');
  const baseHead = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', 'refs/remotes/origin/main', baseHead);
  git(root, 'checkout', '-q', 'issue-42');
  writeFileSync(join(root, 'source.mjs'), 'export const value = 2;\n');
  git(root, 'add', 'source.mjs');
  git(root, 'commit', '-qm', 'implementation');
  git(root, 'merge', '--no-edit', '-q', 'main');
  const head = git(root, 'rev-parse', 'HEAD');
  const tree = git(root, 'rev-parse', 'HEAD^{tree}');
  const checkout = join(root, 'review');
  git(root, 'worktree', 'add', '--quiet', '--detach', checkout, head);
  const artifactRoot = join(root, 'evidence');
  mkdirSync(artifactRoot);
  const store = (path, value) => {
    const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    writeFileSync(join(artifactRoot, path), bytes);
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  };
  const diff = store('authored.diff', execFileSync('git',
    ['diff', '--binary', '--full-index', '--no-renames', baseHead, head], { cwd: root, encoding: 'utf8' }));
  const stdout = store('focused.stdout', 'actual focused check passed\n');
  const stderr = store('focused.stderr', '');
  const receipt = { version: 1, complete: true, command: 'node focused check',
    head_sha: head, tree_sha: tree, contract_sha256: contract.sha256,
    status: 'passed', exit_code: 0, signal: null, duration_ms: 1, stdout, stderr };
  const policy = evaluatePreflight(contract, {
    issue: 42, issueSha256: contract.issue_sha256, baseSha: base, changedFiles: ['source.mjs'],
  }).policy;
  const acceptedPath = join(artifactRoot, 'accepted.json');
  writeFileSync(acceptedPath, JSON.stringify(contract));
  const observation = store('plan.json', { issue: 42, decision: { action: 'review' }, obs: {
    preflight: contract, preflightPolicy: policy, issueSha256: contract.issue_sha256,
    headSha: head, baseSha: base, changedFiles: ['source.mjs'],
  } });
  const input = { version: 1, stage: 'review', root, checkout, issue: 42,
    issue_sha256: contract.issue_sha256, contract, policy, base_ref: 'origin/main',
    accepted_contract_path: acceptedPath, observation,
    base_head_sha: baseHead, head_sha: head, artifact_root: artifactRoot,
    diff, changed_paths: ['source.mjs'], required_checks: ['node focused check'],
    evidence: [{ command: 'node focused check', receipt: store('focused.json', receipt) }], footprint };
  return { root, input, store, receipt, footprintInput, base, baseHead, head, tree };
}

test('review preparation: real merged graph -> one identical authenticated input for every axis', (t) => {
  const value = fixture(t);

  const result = prepareReviewInput(value.input);

  assert.equal(result.status, 'prepared');
  assert.equal(result.common.verification_base_sha, value.base);
  assert.equal(result.common.authored_merge_base_sha, value.baseHead);
  assert.notEqual(value.base, value.baseHead);
  assert.deepEqual(result.common.changed_paths, ['source.mjs']);
  assert.equal(result.common.footprint.categories.reflective_integration.affected, false);
  assert.deepEqual(result.reviewers.map((entry) => entry.reviewer), ['contract', 'code', 'verification']);
  for (const reviewer of result.reviewers) assert.equal(reviewer.input, result.common);
});

test('review readable index: retained focused receipts -> authenticated decoder free exact results and unknown counts', (t) => {
  const value = fixture(t);

  const result = prepareReviewInput(value.input);

  assert.ok(result.common.readable_index, 'reviewers need a readable authenticated index');
  const index = result.common.readable_index;
  assert.equal(index.head_sha, value.head);
  assert.equal(index.tree_sha, value.tree);
  assert.equal(index.contract_sha256, value.input.contract.sha256);
  assert.equal(index.policy_sha256, value.input.policy.sha256);
  assert.equal(index.commands[0].command, 'node focused check');
  assert.equal(index.commands[0].test_results, null);
  assert.deepEqual(index.commands[0].packed_commands, []);
  assert.equal(index.commands[0].receipt.sha256, value.input.evidence[0].receipt.sha256);
  assert.equal(index.commands[0].stdout.sha256, value.receipt.stdout.sha256);
  assert.ok(index.sha256);
  for (const reviewer of result.reviewers) assert.equal(reviewer.input.readable_index, index);
});

async function packedIndexFixture(t) {
  const value = fixture(t);
  const root = join(value.input.artifact_root, 'packed');
  const commands = [];
  const runner = createCommandRunner(root, commands, 'actual-1');
  t.after(() => runner.dispose());
  const testPath = join(value.input.artifact_root, 'actual.test.mjs');
  writeFileSync(testPath, `import test from 'node:test'; import assert from 'node:assert/strict';
test('actual check', () => assert.equal(1 + 1, 2));\n`);
  await runner.run('actual-tests', ['--test', '--test-reporter=tap', testPath], value.input.artifact_root,
    { NODE_TEST_CONTEXT: undefined }, process.execPath);
  value.receipt.stdout = value.store('focused.stdout', readFileSync(commands[0].evidence.stdout.path, 'utf8'));
  value.receipt.packed_receipt = value.store('packed/pack-release.json', { head: value.head,
    source: { head: value.head, tree: value.tree }, status: 'passed', commands });
  value.input.evidence[0].receipt = value.store('focused.json', value.receipt);
  return value;
}

test('review readable index: real packed command and Node results -> exposes actual inventory without decoder', async (t) => {
  const value = await packedIndexFixture(t);

  const { common } = prepareReviewInput(value.input);

  assert.ok(common.readable_index.commands[0].test_results, 'actual Node subprocess must report its executed tests');
  assert.equal(common.readable_index.commands[0].test_results.summary.tests, 1);
  assert.equal(common.readable_index.commands[0].test_results.summary.pass, 1);
  const packed = common.readable_index.commands[0].packed_commands;
  assert.equal(packed.length, 1);
  assert.equal(packed[0].label, 'actual-tests');
  assert.equal(packed[0].command[0], process.execPath);
  assert.equal(packed[0].exit_code, 0);
  assert.equal(packed[0].signal, null);
  assert.equal(packed[0].test_results.summary.tests, 1);
  assert.ok(packed[0].duration_ms >= 0);
  const supplied = value.store('readable-index.json', common.readable_index);
  assert.deepEqual(prepareReviewInput({ ...value.input, readable_index: supplied }).common.readable_index, common.readable_index);
});

for (const defect of ['missing', 'truncated', 'altered', 'rebound-count', 'stale-head', 'rebound-policy', 'rebound-contract']) {
  test(`review readable index: ${defect} retained index -> input preparation rejection`, (t) => {
    const value = fixture(t);
    const index = prepareReviewInput(value.input).common.readable_index;
    value.input.readable_index = value.store('readable-index.json', index);
    if (defect === 'missing') rmSync(join(value.input.artifact_root, 'readable-index.json'));
    if (defect === 'truncated') writeFileSync(join(value.input.artifact_root, 'readable-index.json'), '{}');
    if (defect === 'altered') {
      const bytes = readFileSync(join(value.input.artifact_root, 'readable-index.json'));
      bytes[bytes.length - 3] ^= 1;
      writeFileSync(join(value.input.artifact_root, 'readable-index.json'), bytes);
    }
    if (defect.startsWith('rebound') || defect === 'stale-head') {
      if (defect === 'rebound-count') index.commands[0].test_results = { summary: { tests: 99 } };
      else index[defect === 'stale-head' ? 'head_sha' : defect === 'rebound-policy' ? 'policy_sha256' : 'contract_sha256'] = 'd'.repeat(defect === 'stale-head' ? 40 : 64);
      value.input.readable_index = value.store('readable-index.json', index);
    }

    assert.throws(() => prepareReviewInput(value.input), (error) => {
      assert.equal(error.kind, 'input-preparation');
      assert.equal(error.fix_back_eligible, false);
      assert.match(error.message, /readable index/u);
      return true;
    });
  });
}

for (const defect of ['missing-packed', 'truncated-packed', 'rebound-command', 'stale-packed-head', 'altered-raw']) {
  test(`review readable index: ${defect} packed source -> authenticated source rejection`, async (t) => {
    const value = await packedIndexFixture(t);
    const path = join(value.input.artifact_root, 'packed/pack-release.json');
    const packed = JSON.parse(readFileSync(path));
    if (defect === 'missing-packed') rmSync(path);
    if (defect === 'truncated-packed') writeFileSync(path, '{}');
    if (defect === 'rebound-command' || defect === 'stale-packed-head') {
      if (defect === 'rebound-command') packed.commands[0].command = ['pnpm', 'fiction'];
      else packed.head = 'd'.repeat(40);
      value.receipt.packed_receipt = value.store('packed/pack-release.json', packed);
      value.input.evidence[0].receipt = value.store('focused.json', value.receipt);
    }
    if (defect === 'altered-raw') writeFileSync(packed.commands[0].evidence.stdout.path, 'changed raw bytes');

    assert.throws(() => prepareReviewInput(value.input), (error) => {
      assert.equal(error.kind, 'input-preparation');
      assert.equal(error.fix_back_eligible, false);
      assert.match(error.message, /packed/u);
      return true;
    });
  });
}

const defects = [
  ['wrong-checkout', (v) => { v.input.checkout = v.root; git(v.root, 'checkout', '-q', 'main'); }, /wrong checkout\/head/u],
  ['wrong-head', (v) => { v.input.head_sha = v.base; }, /wrong checkout\/head/u],
  ['wrong-base', (v) => { v.input.base_head_sha = v.base; }, /stale origin\/base/u],
  ['wrong-issue', (v) => { v.input.issue_sha256 = 'd'.repeat(64); }, /stale canonical plan observation/u],
  ['wrong-contract', (v) => { v.input.contract.acceptance.push('unaccepted'); }, /contract digest mismatch/u],
  ['wrong-policy', (v) => { v.input.policy.sha256 = 'd'.repeat(64); }, /stale canonical plan observation/u],
  ['missing-path', (v) => { v.input.changed_paths = []; }, /stale canonical plan observation/u],
  ['old-accepted-contract', (v) => {
    v.input.contract = createPreflight({ ...v.input.contract, acceptance: ['Older approved acceptance'] });
  }, /stale accepted contract/u],
  ['missing-observation', (v) => { rmSync(join(v.input.artifact_root, 'plan.json')); }, /canonical plan observation: artifact unavailable/u],
  ['missing-diff', (v) => { rmSync(join(v.input.artifact_root, v.input.diff.path)); }, /review diff: artifact unavailable/u],
  ['truncated-diff', (v) => { writeFileSync(join(v.input.artifact_root, v.input.diff.path), 'diff'); }, /review diff: truncated artifact/u],
  ['tampered-diff', (v) => {
    const bytes = readFileSync(join(v.input.artifact_root, v.input.diff.path)); bytes[bytes.length - 2] ^= 1;
    writeFileSync(join(v.input.artifact_root, v.input.diff.path), bytes);
  }, /review diff: artifact digest mismatch/u],
  ['authenticated-wrong-diff', (v) => { v.input.diff = v.store('other.diff', 'diff --git a/other b/other\n'); }, /does not match complete/u],
  ['missing-evidence', (v) => { v.input.evidence = []; }, /missing required focused evidence/u],
  ['missing-receipt', (v) => { rmSync(join(v.input.artifact_root, 'focused.json')); }, /focused receipt: artifact unavailable/u],
  ['truncated-receipt', (v) => { writeFileSync(join(v.input.artifact_root, 'focused.json'), '{}'); }, /focused receipt: truncated artifact/u],
  ['stale-evidence', (v) => {
    v.receipt.head_sha = v.base; v.input.evidence[0].receipt = v.store('focused.json', v.receipt);
  }, /stale head\/tree\/contract/u],
  ['wrong-tree-evidence', (v) => {
    v.receipt.tree_sha = 'd'.repeat(40); v.input.evidence[0].receipt = v.store('focused.json', v.receipt);
  }, /stale head\/tree\/contract/u],
  ['wrong-contract-evidence', (v) => {
    v.receipt.contract_sha256 = 'd'.repeat(64); v.input.evidence[0].receipt = v.store('focused.json', v.receipt);
  }, /stale head\/tree\/contract/u],
  ['incomplete-evidence', (v) => {
    v.receipt.complete = false; v.input.evidence[0].receipt = v.store('focused.json', v.receipt);
  }, /incomplete receipt/u],
  ['failed-evidence', (v) => {
    v.receipt.exit_code = 1; v.input.evidence[0].receipt = v.store('focused.json', v.receipt);
  }, /no completed passing command/u],
  ['tampered-stdout', (v) => {
    const bytes = readFileSync(join(v.input.artifact_root, 'focused.stdout')); bytes[0] ^= 1;
    writeFileSync(join(v.input.artifact_root, 'focused.stdout'), bytes);
  }, /focused stdout: artifact digest mismatch/u],
  ['missing-footprint-category', (v) => { delete v.input.footprint.categories.book; }, /categories: non-canonical keys/u],
  ['wrong-footprint-source', (v) => {
    v.input.footprint.categories.governance.sources[0].sha256 = 'd'.repeat(64);
  }, /source digest mismatch/u],
  ['unexplained-unaffected-footprint', (v) => {
    v.input.footprint.categories.generated_consumers.reason = '';
  }, /missing impact, selection rationale/u],
  ['stale-footprint', (v) => { v.input.footprint.sha256 = 'd'.repeat(64); }, /stale source footprint binding/u],
  ['scope-expansion', (v) => {
    const contract = createPreflight({ ...v.input.contract, scope: ['other/'], predicted_files: ['other/source.mjs'] });
    v.input.contract = contract;
    writeFileSync(v.input.accepted_contract_path, JSON.stringify(contract));
    const observation = JSON.parse(readFileSync(join(v.input.artifact_root, 'plan.json'), 'utf8'));
    observation.obs.preflight = contract;
    v.input.observation = v.store('plan.json', observation);
  }, /scope-expansion: source.mjs/u],
];
for (const [name, mutate, expected] of defects) {
  test(`review preparation: ${name} -> input block before any reviewer dispatch`, (t) => {
    const value = fixture(t);
    mutate(value);

    assert.throws(() => prepareReviewInput(value.input), (error) => {
      assert.equal(error.kind, 'input-preparation');
      assert.equal(error.fix_back_eligible, false);
      assert.match(error.message, expected);
      return true;
    });
  });
}

test('workflow preparation CLI: preflight sidecar -> runnable stage input consumed by review', (t) => {
  const value = fixture(t);
  const inputPath = join(value.root, 'preflight-input.json');
  writeFileSync(inputPath, JSON.stringify({ version: 1, stage: 'preflight', root: value.root, footprint: value.footprintInput }));

  const output = execFileSync(process.execPath, [modulePath, 'preflight', inputPath], { encoding: 'utf8' });

  value.input.footprint = JSON.parse(output).footprint;
  assert.equal(prepareReviewInput(value.input).common.footprint.sha256, value.input.footprint.sha256);
});

test('workflow preparation CLI: authenticated real inputs -> executable review dispatch payload', (t) => {
  const value = fixture(t);
  const path = join(value.root, 'review-input.json');
  writeFileSync(path, JSON.stringify(value.input));

  const output = execFileSync(process.execPath, [modulePath, 'review', path], { encoding: 'utf8' });

  assert.equal(JSON.parse(output).common.head_sha, value.head);
});

test('artifact guard mutation: removing digest comparison -> tampered artifact regression fails', (t) => {
  const value = fixture(t);
  const source = readFileSync(modulePath, 'utf8');
  const needle = 'requireInput(sha256(bytes) === reference.sha256,';
  assert.equal(source.split(needle).length, 2);
  const mutated = source.replace(needle, 'requireInput(true,');
  const path = join(value.root, 'mutation-input.json');
  const bytes = readFileSync(join(value.input.artifact_root, 'focused.stdout')); bytes[0] ^= 1;
  writeFileSync(join(value.input.artifact_root, 'focused.stdout'), bytes);
  writeFileSync(path, JSON.stringify(value.input));
  const driver = `
    import { registerHooks } from 'node:module';
    import { pathToFileURL } from 'node:url';
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    const target = pathToFileURL(${JSON.stringify(modulePath)}).href;
    registerHooks({ load(url, context, next) {
      if (url === target) return { format: 'module', source: ${JSON.stringify(mutated)}, shortCircuit: true };
      return next(url, context);
    } });
    const { prepareReviewInput } = await import(target);
    assert.throws(() => prepareReviewInput(JSON.parse(fs.readFileSync(${JSON.stringify(path)}, 'utf8'))),
      /focused stdout: artifact digest mismatch/);
  `;

  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', driver],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), (error) => {
    assert.equal(error.status, 1);
    assert.match(error.stderr, /Missing expected exception/u);
    process.stdout.write(`${JSON.stringify({ kind: 'mutation-evidence',
      guard: 'artifact-sha256', command: [process.execPath, '--input-type=module', '-e', driver],
      exit_code: error.status, stdout: error.stdout, stderr: error.stderr })}\n`);
    return true;
  });
});

test('authored diff guard mutation: removing byte comparison -> authenticated wrong diff regression fails', (t) => {
  const value = fixture(t);
  const source = readFileSync(modulePath, 'utf8');
  const needle = 'requireInput(actualDiff.equals(capturedDiff),';
  assert.equal(source.split(needle).length, 2);
  const mutated = source.replace(needle, 'requireInput(true,');
  value.input.diff = value.store('authored.diff', 'diff --git a/wrong b/wrong\n');
  const path = join(value.root, 'mutation-input.json');
  writeFileSync(path, JSON.stringify(value.input));
  const driver = `
    import { registerHooks } from 'node:module';
    import { pathToFileURL } from 'node:url';
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    const target = pathToFileURL(${JSON.stringify(modulePath)}).href;
    registerHooks({ load(url, context, next) {
      if (url === target) return { format: 'module', source: ${JSON.stringify(mutated)}, shortCircuit: true };
      return next(url, context);
    } });
    const { prepareReviewInput } = await import(target);
    assert.throws(() => prepareReviewInput(JSON.parse(fs.readFileSync(${JSON.stringify(path)}, 'utf8'))),
      /does not match complete merge-base-to-head authored diff/);
  `;

  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', driver],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), (error) => {
    assert.equal(error.status, 1);
    assert.match(error.stderr, /Missing expected exception/u);
    process.stdout.write(`${JSON.stringify({ kind: 'mutation-evidence',
      guard: 'authored-diff-bytes', command: [process.execPath, '--input-type=module', '-e', driver],
      exit_code: error.status, stdout: error.stdout, stderr: error.stderr })}\n`);
    return true;
  });
});
