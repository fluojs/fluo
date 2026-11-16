import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPreflight, evaluatePreflight } from '../../issue-preflight/scripts/contracts.mjs';
import { buildReviewFact } from '../../review-head/scripts/contracts.mjs';
import { observeReviewRetention } from './lane-v4-cli.mjs';
import { prepareReviewInput, prepareSourceFootprint, sourceFootprintCategories } from './workflow-preparation.mjs';
import { readRegisteredAgents, validateDispatchTarget } from './dispatch-targets.mjs';
import { createCommandRunner } from '../../../../examples/react-vite-ssr/tests/verify-background-starter.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const modulePath = fileURLToPath(new URL('./workflow-preparation.mjs', import.meta.url));

function redFixture(t, scenario = 'assertion', comparison = null) {
  const value = fixture(t);
  const { input } = value;
  if (comparison) {
    writeFileSync(join(value.root, 'source.mjs'), `export const value = ${JSON.stringify(comparison.before)};\n`);
    git(value.root, 'add', 'source.mjs');
    git(value.root, 'commit', '-qm', 'assertion data baseline');
  }
  const previous = git(value.root, 'rev-parse', 'HEAD');
  const testFile = 'regression.test.mjs';
  const expected = comparison ? JSON.stringify(comparison.after) : scenario === 'green' ? '2' : '3';
  const source = scenario === 'setup'
    ? "import './missing.mjs';\n"
    : scenario === 'module'
      ? `console.log("code: 'ERR_ASSERTION'");\nawait import('./missing.mjs');\n`
      : scenario === 'syntax'
        ? `import test from 'node:test';\nconst = "code: 'ERR_ASSERTION'";\n`
        : `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from './source.mjs';\ntest('value regression', () => {\n  ${scenario === 'reference' ? `console.log("code: 'ERR_ASSERTION'"); unknownValue;` : `assert.equal(value, ${expected});`}\n});\n`;
  writeFileSync(join(value.root, testFile), source);
  writeFileSync(join(value.root, 'source.mjs'), `export const value = ${comparison ? JSON.stringify(comparison.after) : '3'};\n`);
  git(value.root, 'add', testFile, 'source.mjs');
  git(value.root, 'commit', '-qm', 'fix-back');
  const head = git(value.root, 'rev-parse', 'HEAD');
  git(input.checkout, 'checkout', '--detach', '-q', head);
  input.head_sha = head;
  input.implementation = { mode: 'fix-back', previous_head_sha: previous, head_sha: head,
    contract_sha256: '' };
  const argv = [process.execPath, '--test', '--test-reporter=tap', testFile];
  const command = `node --test --test-reporter=tap ${testFile}`;
  input.contract = createPreflight({ ...input.contract, scope: ['source.mjs', testFile], validation: [command] });
  input.implementation.contract_sha256 = input.contract.sha256;
  input.policy = evaluatePreflight(input.contract, { issue: 42, issueSha256: input.issue_sha256,
    baseSha: value.base, changedFiles: [testFile, 'source.mjs'] }).policy;
  input.changed_paths = [testFile, 'source.mjs'];
  input.diff = value.store('fix.diff', execFileSync('git',
    ['diff', '--binary', '--full-index', '--no-renames', value.baseHead, head], { cwd: value.root, encoding: 'utf8' }));
  input.required_checks = [command];
  const { NODE_TEST_CONTEXT: _context, ...environment } = process.env;
  const passing = scenario === 'assertion'
    ? spawnSync(argv[0], argv.slice(1), { cwd: input.checkout, env: environment, encoding: 'utf8' }) : null;
  if (passing) assert.equal(passing.status, 0, passing.stderr);
  input.evidence = [{ command, receipt: value.store('fix-focused.json', { ...value.receipt,
    command, argv, head_sha: head, tree_sha: git(input.checkout, 'rev-parse', 'HEAD^{tree}'),
    ...(passing ? { stdout: value.store('fix-green.stdout', passing.stdout),
      stderr: value.store('fix-green.stderr', passing.stderr) } : {}),
    contract_sha256: input.contract.sha256 }) }];
  writeFileSync(input.accepted_contract_path, JSON.stringify(input.contract));
  input.observation = value.store('fix-plan.json', { issue: 42, decision: { action: 'review' }, obs: {
    preflight: input.contract, preflightPolicy: input.policy, issueSha256: input.issue_sha256,
    baseSha: value.base, headSha: head, changedFiles: input.changed_paths,
  } });
  const patch = value.store('regression.patch', execFileSync('git',
    ['diff', '--binary', '--full-index', '--no-renames', previous, head, '--', testFile], { cwd: value.root, encoding: 'utf8' }));
  const checkout = join(value.root, 'reproduction');
  git(value.root, 'worktree', 'add', '--quiet', '--detach', checkout, previous);
  const capture = { version: 1, stage: 'fix-back-red', root: value.root, checkout,
    artifact_root: join(input.artifact_root, 'red'), issue: 42, contract: input.contract,
    implementation: input.implementation, command, argv,
    regression_patch: { ...patch, path: `evidence/${patch.path}` },
    failure: { file: testFile, line: ['module', 'syntax'].includes(scenario) ? 1 : 5,
      test: ['module', 'syntax'].includes(scenario) ? testFile : 'value regression' } };
  const capturePath = join(input.artifact_root, 'capture.json');
  const run = () => {
    writeFileSync(capturePath, JSON.stringify(capture));
    return spawnSync(process.execPath, [modulePath, 'fix-back-red', capturePath], { encoding: 'utf8' });
  };
  const attach = () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const receipt = readFileSync(join(capture.artifact_root, 'receipt.json'));
    input.fix_back_red = { path: 'red/receipt.json', sha256: hash(receipt), bytes: receipt.length };
    return JSON.parse(receipt);
  };
  return { ...value, head: previous, capture, run, attach };
}

for (const marker of ['ERR_MODULE_NOT_FOUND', 'ERR_TEST_FAILURE', 'SyntaxError:', 'ReferenceError:']) {
  test(`#4128 fix-back diagnostic data: ${marker} in assertion values -> capture and preparation accept RED`, (t) => {
    const value = redFixture(t, 'assertion', { before: marker, after: `normalized ${marker}` });
    const receipt = value.attach();

    const prepared = prepareReviewInput(value.input);

    assert.equal(receipt.exit_code, 1);
    const stdout = readFileSync(join(value.capture.artifact_root, receipt.stdout.path), 'utf8');
    assert.ok(stdout.includes(`actual: '${marker}'`));
    assert.ok(stdout.includes(`expected: 'normalized ${marker}'`));
    assert.deepEqual(prepared.common.fix_back_red.receipt, receipt);
  });
}

for (const [scenario, diagnostic] of [
  ['module', /code: 'ERR_TEST_FAILURE'/u],
  ['syntax', /code: 'ERR_TEST_FAILURE'/u],
  ['reference', /name: 'ReferenceError'/u],
]) {
  test(`#4128 fix-back diagnostic kind: genuine ${scenario} failure -> capture rejects non-assertion RED`, (t) => {
    const value = redFixture(t, scenario);

    const result = value.run();

    assert.equal(result.status, 1);
    const block = JSON.parse(result.stderr);
    assert.equal(block.kind, 'input-preparation');
    assert.match(block.error, /expected one named runner assertion failure/u);
    const stdout = readFileSync(join(value.capture.artifact_root, 'stdout'), 'utf8');
    assert.match(stdout, diagnostic);
    if (scenario === 'reference') assert.match(stdout, /^# code: 'ERR_ASSERTION'$/mu);
  });
}

test('#4128 fix-back RED: actual previous-head assertion -> authenticated common evidence', (t) => {
  const value = redFixture(t);
  const receipt = value.attach();

  const prepared = prepareReviewInput(value.input);

  assert.equal(receipt.previous_head_sha, value.head);
  assert.notEqual(receipt.previous_head_sha, value.base);
  assert.equal(receipt.exit_code, 1);
  assert.equal(receipt.producer, 'lead');
  assert.equal(prepared.common.fix_back_red.receipt.head_sha, value.input.head_sha);
  for (const reviewer of prepared.reviewers) assert.equal(reviewer.input.fix_back_red, prepared.common.fix_back_red);
});

for (const scenario of ['green', 'setup']) {
  test(`#4128 fix-back RED: ${scenario} subprocess -> no accepted receipt`, (t) => {
    const value = redFixture(t, scenario);

    const result = value.run();

    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).kind, 'input-preparation');
  });
}

for (const defect of ['missing', 'bytes', 'head', 'contract', 'previous', 'partial', 'stdout',
  'patch', 'failure', 'argv', 'producer', 'exit', 'signal', 'duration', 'extra']) {
  test(`#4128 fix-back preparation: ${defect} receipt -> non-fixable preparation block`, (t) => {
    const value = redFixture(t);
    const receipt = value.attach();
    if (defect === 'missing') delete value.input.fix_back_red;
    if (defect === 'bytes') value.input.fix_back_red.bytes += 1;
    if (defect === 'head') receipt.head_sha = value.head;
    if (defect === 'contract') receipt.contract_sha256 = '0'.repeat(64);
    if (defect === 'previous') receipt.previous_head_sha = value.base;
    if (defect === 'partial') receipt.complete = false;
    if (defect === 'stdout') writeFileSync(join(value.capture.artifact_root, receipt.stdout.path), 'tampered');
    if (defect === 'patch') receipt.regression_patch = receipt.stderr;
    if (defect === 'failure') receipt.failure.test = 'other test';
    if (defect === 'argv') receipt.argv = [process.execPath, '--version'];
    if (defect === 'producer') receipt.producer = 'child';
    if (defect === 'exit') receipt.exit_code = 0;
    if (defect === 'signal') receipt.signal = 'SIGTERM';
    if (defect === 'duration') receipt.duration_ms = -1;
    if (defect === 'extra') receipt.extra = true;
    if (!['missing', 'bytes', 'stdout'].includes(defect)) {
      value.input.fix_back_red = value.store('red/receipt.json', receipt);
    }

    assert.throws(() => prepareReviewInput(value.input),
      (error) => error.kind === 'input-preparation' && error.fix_back_eligible === false);
  });
}

for (const defect of ['product-patch', 'wrong-test', 'wrong-head', 'spawn', 'ancestry']) {
  test(`#4128 RED capture: ${defect} -> rejected before reviewer dispatch`, (t) => {
    const value = redFixture(t);
    if (defect === 'product-patch') {
      const patch = value.store('product.patch', execFileSync('git', ['diff', '--binary', '--full-index',
        value.head, value.input.head_sha, '--', 'source.mjs'], { cwd: value.root, encoding: 'utf8' }));
      value.capture.regression_patch = { ...patch, path: `evidence/${patch.path}` };
    }
    if (defect === 'wrong-test') value.capture.failure.test = 'unrelated failure';
    if (defect === 'wrong-head') value.capture.implementation.head_sha = value.base;
    if (defect === 'spawn') value.capture.argv[0] = `/nonexistent/${process.execPath.split('/').at(-1)}`;
    if (defect === 'ancestry') value.capture.implementation.previous_head_sha = '0'.repeat(40);

    const result = value.run();

    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).fix_back_eligible, false);
  });
}

test('#4128 review preparation: missing implementation -> rejected; ordinary and conflict modes need no RED', (t) => {
  const value = fixture(t);
  const { implementation, ...missing } = value.input;
  assert.throws(() => prepareReviewInput(missing), (error) => error.kind === 'input-preparation');
  for (const mode of ['implement', 'resolve-conflict']) {
    assert.equal(prepareReviewInput({ ...value.input, implementation: { ...implementation, mode } }).status, 'prepared');
  }
});

function fixture(t) {
  const directory = process.env.FLUO_PRODUCT_TEST_EVIDENCE ?? tmpdir();
  mkdirSync(directory, { recursive: true });
  const root = mkdtempSync(join(directory, 'fluo-workflow-preparation-'));
  if (!process.env.FLUO_PRODUCT_TEST_EVIDENCE) t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  mkdirSync(join(root, '.omo'));
  writeFileSync(join(root, '.gitignore'), '.omo/\n');
  writeFileSync(join(root, '.omo/omo.jsonc'),
    readFileSync(new URL('../../../../.omo/omo.jsonc', import.meta.url)));
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
    implementation: { mode: 'implement', previous_head_sha: base, head_sha: head, contract_sha256: contract.sha256 },
    diff, changed_paths: ['source.mjs'], required_checks: ['node focused check'],
    evidence: [{ command: 'node focused check', receipt: store('focused.json', receipt) }], footprint };
  return { root, input, store, receipt, footprintInput, base, baseHead, head, tree };
}

function retainedPreparation(t) {
  const value = fixture(t);
  const { input } = value;
  input.contract = createPreflight({ ...input.contract, scope: ['source.mjs', 'docs/'] });
  input.policy = evaluatePreflight(input.contract, { issue: 42, issueSha256: input.issue_sha256,
    baseSha: value.base, changedFiles: ['source.mjs'] }).policy;
  const previous = buildReviewFact({ head_sha: value.head, preflight_sha256: input.policy.sha256,
    active_axes: input.policy.active_axes, reviews: input.policy.active_axes.map((reviewer) => ({
      reviewer, agent: `fluo-${reviewer}-reviewer`, reviewed_head_sha: value.head,
      preflight_sha256: input.policy.sha256, verdict_signal: 'PASS', blockers: [],
      evidence: [{ acceptance: 'Keep executable value behavior', locations: ['source.mjs:1'] }], observations: [],
    })) }, value.head, input.policy);
  mkdirSync(join(value.root, 'docs/guides'), { recursive: true });
  writeFileSync(join(value.root, 'docs/guides/routing.md'), '# Routing\n');
  git(value.root, 'add', 'docs/guides/routing.md');
  git(value.root, 'commit', '-qm', 'explanation');
  input.head_sha = git(value.root, 'rev-parse', 'HEAD');
  input.implementation = { mode: 'resolve-conflict', previous_head_sha: value.head,
    head_sha: input.head_sha, contract_sha256: input.contract.sha256 };
  git(input.checkout, 'checkout', '--detach', '-q', input.head_sha);
  input.changed_paths = ['docs/guides/routing.md', 'source.mjs'];
  input.diff = value.store('retained.diff', execFileSync('git',
    ['diff', '--binary', '--full-index', '--no-renames', value.baseHead, input.head_sha], { cwd: value.root, encoding: 'utf8' }));
  writeFileSync(input.accepted_contract_path, JSON.stringify(input.contract));
  input.evidence[0].receipt = value.store('retained-receipt.json', { ...value.receipt,
    head_sha: input.head_sha, tree_sha: git(input.checkout, 'rev-parse', 'HEAD^{tree}'),
    contract_sha256: input.contract.sha256 });
  const proof = observeReviewRetention(value.root, { previousReview: previous,
    previousAcceptedAt: '2026-01-01T00:00:00.000Z', headSha: input.head_sha,
    baseHeadSha: value.baseHead, policy: input.policy, worktree: input.checkout });
  assert.ok(proof);
  const observation = { issue: 42, decision: { action: 'review',
    dispatch: { contract: { subagent_type: 'fluo-contract-reviewer' } } }, obs: {
    preflight: input.contract, preflightPolicy: input.policy, issueSha256: input.issue_sha256,
    baseSha: value.base, headSha: input.head_sha, changedFiles: input.changed_paths, reviewRetention: proof,
  } };
  input.observation = value.store('retained-plan.json', observation);
  return { ...value, observation };
}

test('#4099 preparation: independently authenticated retention -> only fresh reviewers with complete common evidence', (t) => {
  const value = retainedPreparation(t);

  const result = prepareReviewInput(value.input);

  assert.deepEqual(result.reviewers.map((reviewer) => reviewer.reviewer), ['contract']);
  assert.equal(result.reviewers[0].input, result.common);
  assert.deepEqual(result.common.policy.active_axes, ['contract', 'code', 'verification']);
  assert.deepEqual(result.common.retention, value.observation.obs.reviewRetention);
  assert.deepEqual(result.common.changed_paths, ['docs/guides/routing.md', 'source.mjs']);
  assert.deepEqual(result.common.required_checks, ['node focused check']);
});

for (const mutation of ['narrowed-without-proof', 'manifest-omission', 'digest-tampering', 'missing-receipt']) {
  test(`#4099 preparation: ${mutation} -> input-preparation`, (t) => {
    const value = retainedPreparation(t);
    if (mutation === 'narrowed-without-proof') delete value.observation.obs.reviewRetention;
    if (mutation === 'manifest-omission') value.observation.obs.reviewRetention.compared_files = [];
    if (mutation === 'digest-tampering') value.observation.obs.reviewRetention.compared_files[0].new_sha256 = '0'.repeat(64);
    if (mutation === 'missing-receipt') value.input.evidence = [];
    value.input.observation = value.store('altered-plan.json', value.observation);

    assert.throws(() => prepareReviewInput(value.input), (error) => error.kind === 'input-preparation');
  });
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
  assert.deepEqual(result.reviewers.map((entry) => entry.dispatch), [
    { subagent_type: 'fluo-contract-reviewer' },
    { subagent_type: 'fluo-code-reviewer' },
    { subagent_type: 'fluo-verification-reviewer' },
  ]);
  for (const reviewer of result.reviewers) assert.equal(reviewer.input, result.common);
});

test('#4091 preflight preparation: authenticated footprint -> registered preflight dispatch', (t) => {
  const value = fixture(t);
  const path = join(value.input.artifact_root, 'preflight-input.json');
  writeFileSync(path, JSON.stringify({ version: 1, stage: 'preflight', root: value.root, footprint: value.footprintInput }));

  const output = JSON.parse(execFileSync(process.execPath, [modulePath, 'preflight', path], { encoding: 'utf8' }));

  assert.deepEqual(output.dispatch, { subagent_type: 'fluo-issue-preflight' });
  assert.deepEqual(output.footprint, value.input.footprint);
});

test('#4091 preparation: absent registration -> typed non-fixable input block', (t) => {
  const value = fixture(t);
  const config = JSON.parse(readFileSync(join(value.root, '.omo/omo.jsonc')));
  delete config.agents['fluo-code-reviewer'];
  writeFileSync(join(value.root, '.omo/omo.jsonc'), JSON.stringify(config));

  assert.throws(() => prepareReviewInput(value.input),
    (error) => error.kind === 'input-preparation' && error.fix_back_eligible === false
      && error.code === 'dispatch-target-unavailable' && error.subagent_type === 'fluo-code-reviewer');
});

test('#4091 registration JSONC: comments and trailing commas -> both preparation dispatch payloads', (t) => {
  const value = fixture(t);
  const path = join(value.root, '.omo/omo.jsonc');
  const { agents } = JSON.parse(readFileSync(path));
  writeFileSync(path, `// registered stage agents
{ /* operator note */
  "routes": ["https://example.test//model/*prompt*/",],
  "agents": ${JSON.stringify(agents)},
}`);
  const inputPath = join(value.input.artifact_root, 'preflight-input.json');
  writeFileSync(inputPath, JSON.stringify({ version: 1, stage: 'preflight', root: value.root, footprint: value.footprintInput }));

  const preflight = JSON.parse(execFileSync(process.execPath, [modulePath, 'preflight', inputPath], { encoding: 'utf8' }));
  const review = prepareReviewInput(value.input);

  assert.equal(preflight.dispatch.subagent_type, 'fluo-issue-preflight');
  assert.deepEqual(review.reviewers.map((entry) => entry.dispatch.subagent_type),
    ['fluo-contract-reviewer', 'fluo-code-reviewer', 'fluo-verification-reviewer']);
});

test('#4091 registration JSONC: escaped strings and comment markers -> unchanged agent values', (t) => {
  const value = fixture(t);
  const prompt = 'A "quoted" \\path // literal /*comment*/ ,} ,]';
  const model = 'https://example.test//provider/*model*/';
  const agents = { 'fluo-issue-preflight': { prompt, models: [model] } };
  writeFileSync(join(value.root, '.omo/omo.jsonc'), `// registration
{ "agents": {
    "fluo-issue-preflight": {
      "prompt": ${JSON.stringify(prompt)},
      "models": [${JSON.stringify(model)}, /* array trailing comma */],
    },
  }, // object trailing comma
}`);

  const registered = readRegisteredAgents(value.root);

  assert.deepEqual(registered, agents);
});

test('#4091 registration entries: own plain objects -> registered; invalid values and inherited names -> unavailable', () => {
  const dispatch = { subagent_type: 'fluo-issue-preflight' };
  const nullPrototype = Object.create(null);
  nullPrototype[dispatch.subagent_type] = {};

  assert.doesNotThrow(() => validateDispatchTarget(dispatch, { [dispatch.subagent_type]: {} }));
  assert.doesNotThrow(() => validateDispatchTarget(dispatch, nullPrototype));
  for (const entry of [null, [], true, 1, 'agent', () => {}, new Date(0), Object.create({ inherited: true })]) {
    assert.throws(() => validateDispatchTarget(dispatch, { [dispatch.subagent_type]: entry }),
      (error) => error.code === 'dispatch-target-unavailable' && error.subagent_type === dispatch.subagent_type);
  }
  for (const subagent_type of ['constructor', '__proto__', 'toString']) {
    assert.throws(() => validateDispatchTarget({ subagent_type }, {}),
      (error) => error.code === 'dispatch-target-unavailable' && error.subagent_type === subagent_type);
  }
  assert.throws(() => validateDispatchTarget(dispatch, Object.create({ [dispatch.subagent_type]: {} })),
    (error) => error.code === 'dispatch-target-unavailable');
});

for (const [defect, content] of [
  ['missing', null], ['truncated', '{"agents":'], ['unterminated-comment', '{"agents":{}} /*'],
  ['leading-comma', '{,}'], ['missing-value', '{"agents":,}'],
  ['split-token', '{"agents": 1/* comment */2}'], ['double-comma', '{"agents":{},,}'],
  ['root-null', 'null'], ['root-array', '[]'], ['root-number', '1'], ['root-string', '"registration"'],
  ['agents-missing', '{}'], ['agents-array', '{"agents":[]}'], ['agents-null', '{"agents":null}'],
  ['agents-number', '{"agents":1}'], ['agents-string', '{"agents":"registration"}'],
]) {
  test(`#4091 registration unreadable: ${defect} -> typed preparation block`, (t) => {
    const value = fixture(t);
    const path = join(value.root, '.omo/omo.jsonc');
    if (content === null) rmSync(path);
    else writeFileSync(path, content);
    const inputPath = join(value.input.artifact_root, 'preflight-input.json');
    writeFileSync(inputPath, JSON.stringify({ version: 1, stage: 'preflight', root: value.root, footprint: value.footprintInput }));

    const result = spawnSync(process.execPath, [modulePath, 'preflight', inputPath], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    const block = JSON.parse(result.stderr);
    assert.equal(block.kind, 'input-preparation');
    assert.equal(block.code, 'dispatch-registration-unreadable');
    assert.equal(block.fix_back_eligible, false);
    assert.throws(() => readRegisteredAgents(value.root),
      (error) => error.kind === 'input-preparation' && error.fix_back_eligible === false
        && error.code === 'dispatch-registration-unreadable');
    assert.throws(() => prepareReviewInput(value.input),
      (error) => error.kind === 'input-preparation' && error.fix_back_eligible === false
        && error.code === 'dispatch-registration-unreadable');
  });
}

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
    v.input.implementation.contract_sha256 = contract.sha256;
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
