#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { contractDigest, evaluatePreflight, validatePreflight } from '../../issue-preflight/scripts/contracts.mjs';
import { dispatchFor, DispatchPreparationError, readRegisteredAgents, reviewerTargets, validateDispatchTarget } from './dispatch-targets.mjs';
import { observeReviewRetention } from './lane-v4-cli.mjs';
import { retentionFreshAxes } from '../../review-head/scripts/contracts.mjs';

export class WorkflowPreparationError extends TypeError {
  constructor(reason) {
    super(`workflow-preparation: ${reason}`);
    this.name = 'WorkflowPreparationError';
    this.kind = 'input-preparation';
    this.fix_back_eligible = false;
  }
}
const requireInput = (condition, reason) => {
  if (!condition) throw new WorkflowPreparationError(reason);
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => {
  try { return execFileSync('git', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }); }
  catch (error) { throw new WorkflowPreparationError(`git ${args.join(' ')}: ${error.stderr?.toString() ?? error.message}`); }
};
const text = (root, ...args) => git(root, ...args).toString().trim();
const exact = (value, keys, name) => requireInput(value && typeof value === 'object'
  && !Array.isArray(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()), `${name}: non-canonical keys`);
const pathSafe = (path) => typeof path === 'string' && path.length > 0 && !isAbsolute(path)
  && !path.includes('\\') && !/[\x00-\x1f]/u.test(path)
  && path.split('/').every((part) => part && part !== '.' && part !== '..');
const list = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim())
  && new Set(value).size === value.length;
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const commit = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
const registeredDispatch = (root, dispatch) => {
  validateDispatchTarget(dispatch, readRegisteredAgents(root));
  return dispatch;
};

export const sourceFootprintCategories = Object.freeze([
  'direct_callers', 'reflective_integration', 'governance', 'book',
  'en_ko_owners', 'context', 'generated_consumers', 'existing_tests',
]);

/** A sidecar keeps the accepted preflight schema unchanged. */
export function prepareSourceFootprint(root, input) {
  exact(input, ['version', 'issue', 'issue_sha256', 'base_sha', 'categories'], 'source footprint');
  requireInput(input.version === 1 && Number.isSafeInteger(input.issue) && input.issue > 0
    && digest(input.issue_sha256) && commit(input.base_sha), 'source footprint: invalid issue/base binding');
  requireInput(text(root, 'rev-parse', `${input.base_sha}^{commit}`) === input.base_sha,
    'source footprint: pinned base is not a commit');
  exact(input.categories, sourceFootprintCategories, 'source footprint categories');
  for (const name of sourceFootprintCategories) {
    const category = input.categories[name];
    exact(category, ['affected', 'reason', 'sources', 'searches'], `source footprint ${name}`);
    requireInput(typeof category.affected === 'boolean' && typeof category.reason === 'string'
      && category.reason.trim() && list(category.searches) && category.searches.length > 0
      && Array.isArray(category.sources) && (!category.affected || category.sources.length > 0),
    `source footprint ${name}: missing impact, selection rationale or investigation`);
    const paths = new Set();
    for (const source of category.sources) {
      exact(source, ['path', 'sha256'], `source footprint ${name} source`);
      requireInput(pathSafe(source.path) && digest(source.sha256) && !paths.has(source.path),
        `source footprint ${name}: invalid/duplicate source`);
      paths.add(source.path);
      requireInput(sha256(git(root, 'show', `${input.base_sha}:${source.path}`)) === source.sha256,
        `source footprint ${name}: source digest mismatch ${source.path}`);
    }
  }
  return { ...input, sha256: contractDigest(input) };
}

/** Read authenticated artifacts completely; never use a clipped tool response. */
export function readPreparationArtifact(root, reference, label) {
  exact(reference, ['path', 'sha256', 'bytes'], label);
  requireInput(pathSafe(reference.path) && digest(reference.sha256)
    && Number.isSafeInteger(reference.bytes) && reference.bytes >= 0, `${label}: invalid artifact reference`);
  let bytes;
  try {
    const canonicalRoot = realpathSync(root);
    const file = realpathSync(resolve(canonicalRoot, reference.path));
    const inside = relative(canonicalRoot, file);
    requireInput(inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside),
      `${label}: artifact escaped root`);
    bytes = readFileSync(file);
  } catch (error) {
    if (error instanceof WorkflowPreparationError) throw error;
    throw new WorkflowPreparationError(`${label}: artifact unavailable ${reference.path}: ${error.message}`);
  }
  requireInput(bytes.length === reference.bytes, `${label}: truncated artifact ${reference.path}`);
  requireInput(sha256(bytes) === reference.sha256, `${label}: artifact digest mismatch ${reference.path}`);
  return bytes;
}

const implementationBinding = (root, implementation, head, contract) => {
  exact(implementation, ['mode', 'previous_head_sha', 'head_sha', 'contract_sha256'], 'implementation');
  requireInput(['implement', 'fix-back', 'resolve-conflict'].includes(implementation.mode)
    && commit(implementation.previous_head_sha) && commit(implementation.head_sha)
    && implementation.head_sha === head && implementation.contract_sha256 === contract.sha256
    && implementation.previous_head_sha !== head, 'implementation: stale mode/head/contract');
  requireInput(text(root, 'rev-parse', `${implementation.previous_head_sha}^{commit}`) === implementation.previous_head_sha
    && text(root, 'rev-parse', `${head}^{commit}`) === head, 'implementation: invalid commit');
  git(root, 'merge-base', '--is-ancestor', implementation.previous_head_sha, head);
  return text(root, 'rev-parse', `${implementation.previous_head_sha}^{tree}`);
};

const regressionPatch = (root, implementation, bytes, failure) => {
  exact(failure, ['file', 'line', 'test'], 'RED failure');
  requireInput(pathSafe(failure.file) && /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(failure.file)
    && Number.isSafeInteger(failure.line) && failure.line > 0
    && typeof failure.test === 'string' && failure.test.trim(), 'RED failure: invalid assertion location/test');
  let stats;
  try {
    stats = execFileSync('git', ['apply', '--numstat', '-z', '-'],
      { cwd: root, input: bytes, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).toString();
  } catch (error) {
    throw new WorkflowPreparationError(`RED patch: invalid patch: ${error.message}`);
  }
  const paths = stats.split('\0').filter(Boolean).map((row) => row.split('\t').slice(2).join('\t'));
  requireInput(paths.length > 0 && new Set(paths).size === paths.length && paths.includes(failure.file)
    && paths.every((path) => pathSafe(path) && !path.includes(':')
      && (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)
        || /(?:^|\/)(?:tests?|__tests__|fixtures|__fixtures__|test-fixtures)\//u.test(path))),
  'RED patch: only regression tests and test fixtures may be projected');
  const expected = git(root, '--literal-pathspecs', 'diff', '--binary', '--full-index', '--no-renames',
    implementation.previous_head_sha, implementation.head_sha, '--', ...paths);
  requireInput(bytes.equals(expected), 'RED patch: must equal complete post-head regression test changes');
  for (const path of paths) {
    requireInput(/^100(?:644|755) blob /u.test(text(root, '--literal-pathspecs', 'ls-tree', implementation.head_sha, '--', path)),
      'RED patch: test/fixture must be a regular post-head file');
  }
  return paths;
};

const redAssertion = (receipt, stdout) => {
  requireInput(receipt.version === 1 && receipt.complete === true && receipt.producer === 'lead'
    && Number.isSafeInteger(receipt.exit_code) && receipt.exit_code > 0 && receipt.signal === null
    && Number.isFinite(receipt.duration_ms) && receipt.duration_ms >= 0,
  `RED receipt: incomplete or unsuccessful capture (exit=${receipt.exit_code}, signal=${receipt.signal})`);
  // Only the failing entry's top-level diagnostic fields classify the error.
  // Expected/actual values and logged error words are assertion data.
  const failed = [...stdout.matchAll(/^not ok \d+ - (.+)$/gmu)];
  const diagnostic = failed.length === 1
    ? /^\n {2}---\n([\s\S]*?)\n {2}\.\.\.(?:\n|$)/u.exec(
      stdout.slice(failed[0].index + failed[0][0].length))?.[1] : undefined;
  const escapedFile = receipt.failure.file.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  requireInput(failed.length === 1 && failed[0][1] === receipt.failure.test && diagnostic !== undefined
    && /^# fail 1$/mu.test(stdout) && /^# cancelled 0$/mu.test(stdout)
    && /^ {2}failureType: 'testCodeFailure'$/mu.test(diagnostic)
    && /^ {2}code: 'ERR_ASSERTION'$/mu.test(diagnostic)
    && new RegExp(`${escapedFile}:${receipt.failure.line}:[1-9][0-9]*`, 'u').test(diagnostic),
  'RED receipt: expected one named runner assertion failure, without setup/unrelated failures');
};

const redCommand = (command, argv, paths) => {
  requireInput(typeof command === 'string' && command.trim() && Array.isArray(argv)
    && argv.length >= 4 && argv.every((arg) => typeof arg === 'string' && arg.length > 0)
    && basename(argv[0]) === basename(process.execPath) && argv[1] === '--test'
    && argv[2] === '--test-reporter=tap'
    && argv.slice(3).every((arg) => paths.includes(arg) || /^--test-name-pattern=.+/u.test(arg))
    && argv.slice(3).some((arg) => paths.includes(arg)),
  'RED command: use the focused Node test TAP runner and projected regression paths');
};

// This lead preparation mode is separate from issue-implement/reviewer authority.
const captureFixBackRed = (input) => {
  exact(input, ['version', 'stage', 'root', 'checkout', 'artifact_root', 'issue', 'contract',
    'implementation', 'command', 'argv', 'regression_patch', 'failure'], 'RED capture');
  requireInput(input.version === 1 && input.stage === 'fix-back-red'
    && [input.root, input.checkout, input.artifact_root].every((path) => typeof path === 'string' && isAbsolute(path)),
  'RED capture: invalid stage/paths');
  try { validatePreflight(input.contract); }
  catch (error) { throw new WorkflowPreparationError(`RED capture: ${error.message}`); }
  requireInput(input.issue === input.contract.issue && input.implementation?.mode === 'fix-back',
    'RED capture: wrong issue/mode');
  const previousTree = implementationBinding(input.root, input.implementation, input.implementation.head_sha, input.contract);
  const root = realpathSync(input.root);
  const checkout = realpathSync(input.checkout);
  requireInput(root !== checkout && text(checkout, 'rev-parse', 'HEAD') === input.implementation.previous_head_sha
    && text(checkout, 'rev-parse', 'HEAD^{tree}') === previousTree
    && text(checkout, 'status', '--porcelain=v1', '--untracked-files=all') === ''
    && realpathSync(resolve(root, text(root, 'rev-parse', '--git-common-dir')))
      === realpathSync(resolve(checkout, text(checkout, 'rev-parse', '--git-common-dir'))),
  'RED capture: requires a clean separate previous-head checkout in the same repository');
  const patch = readPreparationArtifact(root, input.regression_patch, 'RED patch');
  const paths = regressionPatch(root, input.implementation, patch, input.failure);
  redCommand(input.command, input.argv, paths);
  // Exclusive creation prevents overwriting an earlier command's evidence.
  mkdirSync(input.artifact_root);
  const store = (path, bytes) => {
    writeFileSync(resolve(input.artifact_root, path), bytes, { flag: 'wx' });
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  };
  execFileSync('git', ['apply', '--index', '-'], { cwd: checkout, input: patch });
  const started = performance.now();
  // A preparation CLI invoked from node:test must start an independent runner.
  const { NODE_TEST_CONTEXT: _testContext, ...environment } = process.env;
  const result = spawnSync(input.argv[0], input.argv.slice(1), {
    cwd: checkout, env: environment, maxBuffer: 64 * 1024 * 1024,
  });
  const duration = performance.now() - started;
  const stdout = store('stdout', result.stdout ?? Buffer.alloc(0));
  const stderr = store('stderr', result.stderr ?? Buffer.alloc(0));
  requireInput(!result.error, `RED capture: spawn/stream failure: ${result.error?.message}`);
  requireInput(text(checkout, 'rev-parse', 'HEAD') === input.implementation.previous_head_sha
    && git(checkout, 'diff', '--cached', '--binary', '--full-index', '--no-renames').equals(patch)
    && text(checkout, 'diff', '--name-only') === ''
    && text(checkout, 'ls-files', '--others', '--exclude-standard') === '',
  'RED capture: reproduction changed beyond the regression patch');
  const receipt = { version: 1, complete: true, producer: 'lead', issue: input.issue,
    previous_head_sha: input.implementation.previous_head_sha, head_sha: input.implementation.head_sha,
    previous_tree_sha: previousTree, contract_sha256: input.contract.sha256,
    command: input.command, argv: input.argv, regression_patch: store('regression.patch', patch),
    exit_code: result.status, signal: result.signal, duration_ms: duration, stdout, stderr, failure: input.failure };
  redAssertion(receipt, result.stdout.toString());
  const reference = store('receipt.json', Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
  return { status: 'captured', kind: 'fix-back-red', receipt: reference };
};

/**
 * The lead calls this after canonical plan observes "review", before spawning
 * any reviewer. It is preparation, not an engine, dispatcher or ledger writer.
 */
export function prepareReviewInput(input) {
  const { readable_index: suppliedIndex, fix_back_red: redReference, ...preparation } = input;
  exact(preparation, ['version', 'stage', 'root', 'checkout', 'issue', 'issue_sha256', 'contract',
    'policy', 'base_ref', 'base_head_sha', 'head_sha', 'artifact_root', 'diff',
    'changed_paths', 'required_checks', 'evidence', 'footprint', 'accepted_contract_path', 'observation',
    'implementation'], 'review preparation');
  requireInput(input.version === 1 && input.stage === 'review', 'review preparation: invalid stage');
  requireInput([input.root, input.checkout, input.artifact_root].every((path) => typeof path === 'string' && isAbsolute(path)),
    'review preparation: paths must be absolute');
  let root;
  let checkout;
  try {
    root = realpathSync(input.root);
    checkout = realpathSync(input.checkout);
  } catch (error) {
    throw new WorkflowPreparationError(`review preparation: checkout/root unavailable: ${error.message}`);
  }
  requireInput(realpathSync(resolve(root, text(root, 'rev-parse', '--git-common-dir')))
    === realpathSync(resolve(checkout, text(checkout, 'rev-parse', '--git-common-dir'))),
  'review preparation: wrong repository checkout');
  requireInput(commit(input.head_sha) && text(checkout, 'rev-parse', 'HEAD') === input.head_sha,
    'review preparation: wrong checkout/head');
  requireInput(text(checkout, 'status', '--porcelain=v1') === '', 'review preparation: dirty checkout');
  try { validatePreflight(input.contract); }
  catch (error) { throw new WorkflowPreparationError(`review preparation: ${error.message}`); }
  requireInput(typeof input.accepted_contract_path === 'string' && isAbsolute(input.accepted_contract_path),
    'review preparation: missing authoritative accepted contract path');
  let accepted;
  let observation;
  try {
    accepted = JSON.parse(readFileSync(input.accepted_contract_path, 'utf8'));
    observation = JSON.parse(readPreparationArtifact(input.artifact_root, input.observation, 'canonical plan observation'));
  } catch (error) {
    if (error instanceof WorkflowPreparationError) throw error;
    throw new WorkflowPreparationError(`review preparation: accepted contract/observation unavailable: ${error.message}`);
  }
  requireInput(isDeepStrictEqual(accepted, input.contract), 'review preparation: stale accepted contract');
  requireInput(observation.issue === input.issue && observation.decision?.action === 'review'
    && isDeepStrictEqual(observation.obs?.preflight, accepted)
    && observation.obs.issueSha256 === input.issue_sha256 && observation.obs.headSha === input.head_sha
    && observation.obs.baseSha === accepted.base_sha && isDeepStrictEqual(observation.obs.preflightPolicy, input.policy)
    && isDeepStrictEqual(observation.obs.changedFiles, input.changed_paths),
  'review preparation: stale canonical plan observation');
  requireInput(input.contract.issue === input.issue && input.contract.issue_sha256 === input.issue_sha256,
    'review preparation: stale issue/contract binding');
  const previousTree = implementationBinding(root, input.implementation, input.head_sha, input.contract);
  let red;
  let redRoot;
  if (input.implementation.mode === 'fix-back') {
    try { red = JSON.parse(readPreparationArtifact(input.artifact_root, redReference, 'fix-back RED')); }
    catch (error) {
      if (error instanceof WorkflowPreparationError) throw error;
      throw new WorkflowPreparationError(`fix-back RED: invalid receipt: ${error.message}`);
    }
    exact(red, ['version', 'complete', 'producer', 'issue', 'previous_head_sha', 'head_sha',
      'previous_tree_sha', 'contract_sha256', 'command', 'argv', 'regression_patch', 'exit_code',
      'signal', 'duration_ms', 'stdout', 'stderr', 'failure'], 'RED receipt');
    requireInput(red.issue === input.issue && red.previous_head_sha === input.implementation.previous_head_sha
      && red.head_sha === input.head_sha && red.previous_tree_sha === previousTree
      && red.contract_sha256 === input.contract.sha256, 'RED receipt: stale issue/head/tree/contract');
    redRoot = dirname(resolve(input.artifact_root, redReference.path));
    const patch = readPreparationArtifact(redRoot, red.regression_patch, 'RED patch');
    const paths = regressionPatch(root, input.implementation, patch, red.failure);
    redCommand(red.command, red.argv, paths);
    readPreparationArtifact(redRoot, red.stderr, 'RED stderr');
    redAssertion(red, readPreparationArtifact(redRoot, red.stdout, 'RED stdout').toString());
  } else {
    requireInput(!Object.hasOwn(input, 'fix_back_red'), 'RED receipt is only valid for fix-back');
  }
  requireInput(typeof input.base_ref === 'string' && /^origin\/[^ \x00-\x1f]+$/u.test(input.base_ref)
    && commit(input.base_head_sha), 'review preparation: invalid origin/base observation');
  const baseHead = text(root, 'rev-parse', '--verify', `${input.base_ref}^{commit}`);
  requireInput(baseHead === input.base_head_sha, 'review preparation: stale origin/base observation');
  const pinned = input.contract.base_sha;
  git(root, 'merge-base', '--is-ancestor', pinned, baseHead);
  git(root, 'merge-base', '--is-ancestor', pinned, input.head_sha);
  const mergeBase = text(root, 'merge-base', baseHead, input.head_sha);
  const changedPaths = git(root, 'diff', '--name-only', '--no-renames', '-z', mergeBase, input.head_sha)
    .toString().split('\0').filter(Boolean);
  requireInput(changedPaths.length > 0 && isDeepStrictEqual(changedPaths, input.changed_paths),
    'review preparation: missing or stale changed paths');
  const evaluation = evaluatePreflight(input.contract, {
    issue: input.issue, issueSha256: input.issue_sha256, baseSha: pinned, changedFiles: changedPaths,
    reviewAxisFloor: input.policy?.active_axes,
  });
  requireInput(evaluation.valid, `review preparation: ${evaluation.reason}: ${evaluation.files?.join(', ') ?? ''}`);
  requireInput(isDeepStrictEqual(evaluation.policy, input.policy), 'review preparation: stale effective policy digest');
  const proof = observation.obs.reviewRetention;
  const retention = proof === undefined ? undefined : observeReviewRetention(root, {
    previousReview: proof.previous_review, previousAcceptedAt: proof.previous_accepted_at,
    headSha: input.head_sha, baseHeadSha: baseHead, policy: input.policy, worktree: checkout,
  });
  requireInput(isDeepStrictEqual(proof, retention), 'review preparation: unauthenticated retention');
  const freshAxes = retentionFreshAxes(retention, input.head_sha, input.policy);
  const dispatch = dispatchFor('review', freshAxes);
  // Legacy observations may omit dispatch; narrowed dispatch always needs proof.
  requireInput(observation.decision.dispatch === undefined
    ? retention === undefined
    : isDeepStrictEqual(observation.decision.dispatch, dispatch),
  'review preparation: stale or narrowed dispatch');
  const actualDiff = git(root, 'diff', '--binary', '--full-index', '--no-renames', mergeBase, input.head_sha);
  const capturedDiff = readPreparationArtifact(input.artifact_root, input.diff, 'review diff');
  requireInput(actualDiff.equals(capturedDiff), 'review diff: does not match complete merge-base-to-head authored diff');
  const { sha256: footprintDigest, ...footprintInput } = input.footprint ?? {};
  const footprint = prepareSourceFootprint(root, footprintInput);
  requireInput(footprint.sha256 === footprintDigest && footprint.issue === input.issue
    && footprint.issue_sha256 === input.issue_sha256 && footprint.base_sha === pinned,
  'review preparation: stale source footprint binding');
  requireInput(list(input.required_checks) && input.required_checks.length > 0
    && Array.isArray(input.evidence) && input.evidence.length === input.required_checks.length,
  'review preparation: missing required focused evidence inventory');
  const tree = text(checkout, 'rev-parse', 'HEAD^{tree}');
  const observedCommands = new Set();
  const indexCommands = [];
  const authenticated = [];
  const readEvidence = (reference, label) => {
    const bytes = readPreparationArtifact(input.artifact_root, reference, label);
    authenticated.push({ reference, label });
    return bytes;
  };
  const readReport = (reference, label) => {
    try { return JSON.parse(readEvidence(reference, label)); }
    catch (error) {
      if (error instanceof WorkflowPreparationError) throw error;
      throw new WorkflowPreparationError(`${label}: invalid JSON: ${error.message}`);
    }
  };
  const nodeSummary = (stdout, source) => {
    const summary = {};
    for (const match of stdout.matchAll(/^(?:#|\u2139)\s+(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/gmu)) {
      summary[match[1]] = Number(match[2]);
    }
    return Object.hasOwn(summary, 'tests') ? { source, summary } : null;
  };
  for (const check of input.evidence) {
    exact(check, ['command', 'receipt'], 'focused evidence');
    requireInput(input.required_checks.includes(check.command) && !observedCommands.has(check.command),
      'review preparation: unexpected/duplicate focused command');
    observedCommands.add(check.command);
    let receipt;
    try { receipt = JSON.parse(readEvidence(check.receipt, 'focused receipt')); }
    catch (error) {
      if (error instanceof WorkflowPreparationError) throw error;
      throw new WorkflowPreparationError(`focused receipt: incomplete JSON: ${error.message}`);
    }
    requireInput(receipt.version === 1 && receipt.complete === true && receipt.command === check.command
      && receipt.head_sha === input.head_sha && receipt.tree_sha === tree
      && receipt.contract_sha256 === input.contract.sha256, 'focused receipt: stale head/tree/contract or incomplete receipt');
    requireInput(receipt.status === 'passed' && receipt.exit_code === 0 && receipt.signal === null
      && Number.isFinite(receipt.duration_ms) && receipt.duration_ms >= 0,
    'focused receipt: no completed passing command');
    if (red && check.command === red.command) {
      requireInput(isDeepStrictEqual(receipt.argv, red.argv), 'RED receipt: passing focused argv differs');
    }
    const stdout = readEvidence(receipt.stdout, 'focused stdout').toString();
    readEvidence(receipt.stderr, 'focused stderr');
    let testResults = null;
    if (receipt.test_results) {
      const report = readReport(receipt.test_results, 'test results');
      requireInput(report && Array.isArray(report.suites) && report.stats && typeof report.stats === 'object',
        'test results: missing actual reporter metadata');
      testResults = { source: receipt.test_results, stats: report.stats };
    } else {
      testResults = nodeSummary(stdout, receipt.stdout);
    }
    const packedCommands = [];
    if (receipt.packed_receipt) {
      const packed = readReport(receipt.packed_receipt, 'packed receipt');
      requireInput(packed.head === input.head_sha && packed.source?.head === input.head_sha
        && packed.source.tree === tree && packed.status === 'passed' && Array.isArray(packed.commands)
        && packed.commands.length > 0,
      'packed receipt: stale head/tree or incomplete inventory');
      const producerRoot = dirname(packed.authoring?.generatedArtifact ?? packed.commands[0]?.log ?? '');
      requireInput(isAbsolute(producerRoot), 'packed receipt: missing producer artifact root');
      const rawReference = (reference) => {
        requireInput(reference && typeof reference.path === 'string' && isAbsolute(reference.path),
          'packed receipt: missing absolute raw source reference');
        const inside = relative(producerRoot, reference.path);
        requireInput(pathSafe(inside), 'packed receipt: source escaped producer root');
        return { ...reference, path: relative(input.artifact_root,
          resolve(dirname(resolve(input.artifact_root, receipt.packed_receipt.path)), inside)) };
      };
      const labels = new Set();
      for (const entry of packed.commands) {
        requireInput(typeof entry.label === 'string' && !labels.has(entry.label)
          && Array.isArray(entry.command) && entry.command.every((arg) => typeof arg === 'string')
          && entry.command.length > 0 && typeof entry.cwd === 'string' && entry.env
          && Number.isInteger(entry.exit) && entry.signal === null && Number.isFinite(entry.elapsedMs)
          && entry.elapsedMs >= 0 && entry.evidence, 'packed receipt: incomplete command metadata');
        labels.add(entry.label);
        const commandReceiptRef = rawReference(entry.evidence.receipt);
        const commandReceipt = readReport(commandReceiptRef, 'packed command receipt');
        requireInput(commandReceipt.complete === true && commandReceipt.closed === true
          && commandReceipt.executable === entry.command[0]
          && isDeepStrictEqual(commandReceipt.args, entry.command.slice(1))
          && commandReceipt.cwd === entry.cwd && isDeepStrictEqual(commandReceipt.env, entry.env)
          && commandReceipt.exit_code === entry.exit && commandReceipt.signal === entry.signal,
        'packed command receipt: rebound command metadata');
        let packedStdout;
        for (const name of ['stdout', 'stderr', 'log']) {
          requireInput(isDeepStrictEqual(commandReceipt[name], entry.evidence[name]),
            'packed command receipt: rebound raw artifact');
          const bytes = readEvidence(rawReference(commandReceipt[name]), `packed ${name}`);
          if (name === 'stdout') packedStdout = bytes.toString();
        }
        requireInput(commandReceipt.log.path === entry.log && commandReceipt.log.sha256 === entry.logSha256,
          'packed command receipt: rebound combined log');
        let report = nodeSummary(packedStdout, rawReference(commandReceipt.stdout));
        if (entry.browserReport) {
          const reportRef = { path: rawReference({ path: entry.browserReport }).path,
            sha256: entry.browserReportSha256, bytes: entry.browserReportBytes };
          const browser = readReport(reportRef, 'packed browser report');
          requireInput(browser.stats && Array.isArray(browser.suites), 'packed browser report: missing reporter metadata');
          report = { source: reportRef, stats: browser.stats };
        }
        packedCommands.push({ label: entry.label, command: entry.command, cwd: entry.cwd, env: entry.env,
          exit_code: entry.exit, signal: entry.signal, duration_ms: entry.elapsedMs,
          expected_rejection: entry.expectedRejection, receipt: commandReceiptRef, test_results: report });
      }
    }
    indexCommands.push({ command: check.command, receipt: check.receipt, status: receipt.status,
      exit_code: receipt.exit_code, signal: receipt.signal, duration_ms: receipt.duration_ms,
      stdout: receipt.stdout, stderr: receipt.stderr, test_results: testResults, packed_commands: packedCommands });
  }
  const readable = { version: 1, head_sha: input.head_sha, tree_sha: tree,
    contract_sha256: input.contract.sha256, policy_sha256: input.policy.sha256, commands: indexCommands };
  const readableIndex = { ...readable, sha256: contractDigest(readable) };
  if (Object.hasOwn(input, 'readable_index')) {
    requireInput(isDeepStrictEqual(readReport(suppliedIndex, 'readable index'), readableIndex),
      'readable index: rebound or stale source metadata');
  }
  for (const { reference, label } of authenticated) readPreparationArtifact(input.artifact_root, reference, label);
  if (red) {
    requireInput(observedCommands.has(red.command), 'RED receipt: no matching passing focused command');
    readPreparationArtifact(input.artifact_root, redReference, 'fix-back RED');
    for (const name of ['regression_patch', 'stdout', 'stderr']) readPreparationArtifact(redRoot, red[name], `RED ${name}`);
  }
  // Recheck after reading evidence: moving the checkout during preparation is blocked.
  requireInput(text(checkout, 'rev-parse', 'HEAD') === input.head_sha
    && text(root, 'rev-parse', `${input.base_ref}^{commit}`) === baseHead
    && text(checkout, 'status', '--porcelain=v1') === ''
    && isDeepStrictEqual(JSON.parse(readFileSync(input.accepted_contract_path, 'utf8')), accepted),
  'review preparation: observation changed during preparation');
  if (retention !== undefined) {
    requireInput(isDeepStrictEqual(retention, observeReviewRetention(root, {
      previousReview: retention.previous_review, previousAcceptedAt: retention.previous_accepted_at,
      headSha: input.head_sha, baseHeadSha: baseHead, policy: input.policy, worktree: checkout,
    })), 'review preparation: retention changed during preparation');
  }
  const common = { version: 1, stage: 'review', issue: input.issue, checkout,
    head_sha: input.head_sha, tree_sha: tree, contract: input.contract,
    contract_sha256: input.contract.sha256, policy: input.policy, preflight_sha256: input.policy.sha256,
    verification_base_sha: pinned, authored_merge_base_sha: mergeBase, base_head_sha: baseHead,
    accepted_contract_path: input.accepted_contract_path, observation: input.observation,
    changed_paths: changedPaths, diff: input.diff, artifact_root: input.artifact_root,
    required_checks: input.required_checks, evidence: input.evidence, readable_index: readableIndex, footprint,
    implementation: input.implementation,
    ...(red === undefined ? {} : { fix_back_red: { reference: redReference, receipt: red } }),
    ...(retention === undefined ? {} : { retention, fresh_axes: freshAxes }) };
  return { status: 'prepared', kind: 'review-input', common,
    reviewers: freshAxes.map((reviewer) => ({
      reviewer, dispatch: registeredDispatch(root, reviewerTargets[reviewer]), input: common,
    })) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [stage, path] = process.argv.slice(2);
    requireInput(['preflight', 'review', 'fix-back-red'].includes(stage) && path && process.argv.length === 4,
      'Usage: node workflow-preparation.mjs <preflight|review|fix-back-red> <input.json>');
    const input = JSON.parse(readFileSync(path, 'utf8'));
    if (stage === 'preflight') {
      exact(input, ['version', 'stage', 'root', 'footprint'], 'preflight preparation');
      requireInput(input.version === 1 && input.stage === 'preflight' && isAbsolute(input.root),
        'preflight preparation: invalid stage/root');
    }
    const result = stage === 'fix-back-red' ? captureFixBackRed(input)
      : stage === 'review' ? prepareReviewInput(input)
      : { status: 'prepared', kind: 'preflight-input', dispatch: registeredDispatch(input.root, dispatchFor('preflight')), footprint: prepareSourceFootprint(input.root, input.footprint) };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'blocked', kind: 'input-preparation',
      fix_back_eligible: false, error: error.message,
      ...(error instanceof DispatchPreparationError ? { code: error.code, subagent_type: error.subagent_type } : {}) })}\n`);
    process.exitCode = 1;
  }
}
