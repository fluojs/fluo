import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { payloadDigest } from '../../../workflow-contracts/contracts.mjs';

const sha = /^[a-f0-9]{40}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const timeout = 15_000;

const defaultRunner = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });

const hasNormalExitMetadata = (error, status) =>
  error instanceof Error &&
  error.status === status &&
  error.signal === null &&
  error.killed !== true &&
  Number.isSafeInteger(error.pid) &&
  error.pid > 0;

const proveMissingLocalRef = (runner, root, ref) => {
  try {
    (runner ?? defaultRunner)(
      'git',
      ['-C', root, 'show-ref', '--verify', '--quiet', ref],
      { timeout },
    );
  } catch (error) {
    if (hasNormalExitMetadata(error, 1)) return;
    throw new TypeError(
      `completed cleanup could not prove local branch absence: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  throw new TypeError('completed cleanup must delete the local issue branch.');
};

const proveMissingOriginBranch = (runner, root, branch) => {
  try {
    (runner ?? defaultRunner)(
      'git',
      ['-C', root, 'ls-remote', '--exit-code', '--heads', 'origin', branch],
      { timeout },
    );
  } catch (error) {
    if (hasNormalExitMetadata(error, 2)) return;
    throw new TypeError(
      `completed cleanup could not prove live origin branch absence: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  throw new TypeError('completed cleanup must delete the live origin issue branch.');
};

export const runTrustedCommand = (runner, command, args, options = {}) => {
  if (
    typeof command !== 'string' ||
    command.length === 0 ||
    !Array.isArray(args) ||
    args.some((argument) => typeof argument !== 'string')
  ) {
    throw new TypeError('trusted command must use an executable and exact string arguments.');
  }
  let output;
  try {
    output = (runner ?? defaultRunner)(command, [...args], { ...options, timeout });
  } catch (error) {
    throw new TypeError(
      `trusted command failed: ${command} ${args.join(' ')}${
        error instanceof Error && error.message.length > 0 ? `: ${error.message}` : ''
      }`,
    );
  }
  if (typeof output !== 'string' && !Buffer.isBuffer(output)) {
    throw new TypeError('trusted command runner must return stdout text.');
  }
  return String(output);
};

const realDirectory = (path, name) => {
  if (typeof path !== 'string' || !existsSync(path)) {
    throw new TypeError(`${name} must exist.`);
  }
  const canonical = resolve(path);
  const stat = lstatSync(canonical);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(canonical) !== canonical) {
    throw new TypeError(`${name} must be a real canonical directory.`);
  }
  return canonical;
};

const git = (runner, cwd, args) =>
  runTrustedCommand(runner, 'git', ['-C', cwd, ...args]).trim();

const requireCommit = (runner, worktree, commit, name) => {
  if (!sha.test(commit ?? '')) {
    throw new TypeError(`${name} must be a full Git commit SHA.`);
  }
  git(runner, worktree, ['cat-file', '-e', `${commit}^{commit}`]);
  return commit;
};

export const assertCanonicalGitState = ({
  repository_root: repositoryRoot,
  worktree,
  branch,
  expected_head: expectedHead,
  commits = [],
  command_runner: runner,
  allow_untracked: allowUntracked = false,
}) => {
  const root = realDirectory(repositoryRoot, 'canonical repository root');
  const canonicalWorktree = realDirectory(
    resolve(root, worktree),
    'canonical issue worktree',
  );
  if (git(runner, root, ['rev-parse', '--show-toplevel']) !== root) {
    throw new TypeError('canonical repository root is not the live Git toplevel.');
  }
  if (git(runner, canonicalWorktree, ['rev-parse', '--show-toplevel']) !== canonicalWorktree) {
    throw new TypeError('canonical issue worktree is not a real Git worktree.');
  }
  const actualBranch = git(runner, canonicalWorktree, ['symbolic-ref', '--short', 'HEAD']);
  if (actualBranch !== branch) {
    throw new TypeError('canonical issue worktree is on the wrong branch.');
  }
  const listing = `${runTrustedCommand(runner, 'git', ['-C', root, 'worktree', 'list', '--porcelain'])}\n`;
  if (
    !listing.includes(`worktree ${canonicalWorktree}\n`) ||
    !listing.includes(`branch refs/heads/${branch}\n`)
  ) {
    throw new TypeError('canonical issue path is not registered as the expected Git worktree.');
  }
  requireCommit(runner, canonicalWorktree, expectedHead, 'expected worktree head');
  for (const commit of commits) requireCommit(runner, canonicalWorktree, commit, 'bound Git head');
  const actualHead = git(runner, canonicalWorktree, ['rev-parse', 'HEAD']);
  if (actualHead !== expectedHead) {
    throw new TypeError('canonical issue worktree HEAD is stale or does not match supervisor state.');
  }
  const dirty = runTrustedCommand(runner, 'git', [
    '-C',
    canonicalWorktree,
    'status',
    '--porcelain=v1',
    allowUntracked ? '--untracked-files=no' : '--untracked-files=all',
  ]).trim();
  if (dirty.length > 0) {
    throw new TypeError('canonical issue worktree and index must be clean at the bound head.');
  }
  return { repository_root: root, worktree: canonicalWorktree, branch, head_sha: actualHead };
};

export const assertCanonicalOriginBranchAbsent = ({
  repository_root: repositoryRoot,
  branch,
  command_runner: runner,
}) => {
  const root = realDirectory(repositoryRoot, 'canonical repository root');
  if (git(runner, root, ['rev-parse', '--show-toplevel']) !== root) {
    throw new TypeError('canonical repository root is not the live Git toplevel.');
  }
  proveMissingOriginBranch(runner, root, branch);
  return { repository_root: root, branch };
};

export const assertCanonicalCleanupGitState = ({
  repository_root: repositoryRoot,
  worktree,
  branch,
  expected_head: expectedHead,
  command_runner: runner,
}) => {
  const root = realDirectory(repositoryRoot, 'canonical repository root');
  const canonicalWorktree = resolve(root, worktree);
  if (existsSync(canonicalWorktree)) {
    throw new TypeError('completed cleanup must leave the canonical issue worktree absent.');
  }
  const listing = `${runTrustedCommand(runner, 'git', ['-C', root, 'worktree', 'list', '--porcelain'])}\n`;
  if (listing.includes(`worktree ${canonicalWorktree}\n`) || listing.includes(`branch refs/heads/${branch}\n`)) {
    throw new TypeError('completed cleanup must unregister the issue worktree and branch.');
  }
  requireCommit(runner, root, expectedHead, 'cleaned reviewed head');
  proveMissingLocalRef(runner, root, `refs/heads/${branch}`);
  assertCanonicalOriginBranchAbsent({
    repository_root: root,
    branch,
    command_runner: runner,
  });
  return { repository_root: root, worktree: canonicalWorktree, branch, head_sha: expectedHead };
};

const normalizeOrigin = (origin) => {
  const value = origin.trim().replace(/\.git$/u, '');
  const ssh = /^git@github\.com:([^/]+\/[^/]+)$/u.exec(value);
  const https = /^https:\/\/github\.com\/([^/]+\/[^/]+)$/u.exec(value);
  const sshUrl = /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+)$/u.exec(value);
  const repository = ssh?.[1] ?? https?.[1] ?? sshUrl?.[1];
  if (repository === undefined) {
    throw new TypeError('canonical origin must identify a GitHub repository.');
  }
  return { origin: origin.trim(), github_repository: repository };
};

const fenceTransition = (line, fence) => {
  const match = /^(?: {0,3})(`{3,}|~{3,})(?:[^`]*)$/u.exec(line);
  if (match === null) return fence;
  const marker = match[1][0];
  if (fence === null) return { marker, length: match[1].length };
  return marker === fence.marker && match[1].length >= fence.length &&
      new RegExp(`^ {0,3}${marker}{${String(fence.length)},}\\s*$`, 'u').test(line)
    ? null
    : fence;
};

export const parseAcceptanceCriteria = (body) => {
  const lines = body.replace(/\r\n?/gu, '\n').split('\n');
  let heading = -1;
  let scanFence = null;
  for (const [index, line] of lines.entries()) {
    const before = scanFence;
    scanFence = fenceTransition(line, scanFence);
    if (before === null && scanFence === null && /^ {0,3}#{1,6}\s+acceptance criteria\s*#*\s*$/iu.test(line)) {
      heading = index;
      break;
    }
  }
  if (heading === -1) {
    throw new TypeError('live issue contract must contain an explicit Acceptance Criteria section.');
  }
  const item = /^(\s*)(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)\S/u;
  const criteria = [];
  let current = null;
  let criterionIndent = null;
  let fence = null;
  for (const line of lines.slice(heading + 1)) {
    const before = fence;
    fence = fenceTransition(line, fence);
    if (before === null && fence === null && /^ {0,3}#{1,6}\s+/u.test(line)) break;
    const match = before === null && fence === null ? item.exec(line) : null;
    if (match !== null && (criterionIndent === null || match[1].length === criterionIndent)) {
      if (current !== null) criteria.push(current);
      criterionIndent ??= match[1].length;
      current = [line];
    } else if (current !== null) {
      current.push(line);
    }
  }
  if (current !== null) criteria.push(current);
  const normalized = criteria.map((block) => {
    while (block.at(-1) === '') block.pop();
    return block.join('\n');
  }).filter(Boolean);
  if (normalized.length === 0) {
    throw new TypeError('live issue contract must contain explicit acceptance criteria.');
  }
  return normalized;
};

const acceptanceLines = parseAcceptanceCriteria;

const issueSnapshotValue = (value) => ({
  version: 1,
  repository: value.repository,
  issue: value.issue,
  acceptance_criteria: value.acceptance_criteria,
  observation_receipt: value.observation_receipt,
});

export const assertLiveIssueContract = (value) => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    value.version !== 1 ||
    typeof value.repository?.root !== 'string' ||
    typeof value.repository?.origin !== 'string' ||
    typeof value.repository?.github_repository !== 'string' ||
    !Number.isSafeInteger(value.issue?.number) ||
    typeof value.issue?.url !== 'string' ||
    typeof value.issue?.title !== 'string' ||
    typeof value.issue?.body !== 'string' ||
    typeof value.issue?.updated_at !== 'string' ||
    !Array.isArray(value.acceptance_criteria) ||
    value.acceptance_criteria.length === 0 ||
    value.acceptance_criteria.some(
      (criterion) =>
        typeof criterion?.id !== 'string' ||
        criterion.id.length === 0 ||
        typeof criterion.content !== 'string' ||
        criterion.content.length === 0 ||
        !sha256.test(criterion.content_sha256 ?? '') ||
        criterion.content_sha256 !== payloadDigest({ content: criterion.content }),
    ) ||
    new Set(value.acceptance_criteria.map(({ id }) => id)).size !== value.acceptance_criteria.length ||
    value.observation_receipt?.authority !== 'trusted-lead' ||
    value.observation_receipt?.command !== 'gh' ||
    !Array.isArray(value.observation_receipt?.args) ||
    !sha256.test(value.observation_receipt?.stdout_sha256 ?? '') ||
    value.observation_receipt?.observed_revision !== value.issue.updated_at ||
    !sha256.test(value.sha256 ?? '') ||
    value.sha256 !== payloadDigest(issueSnapshotValue(value))
  ) {
    throw new TypeError('live issue contract snapshot is malformed or has been tampered with.');
  }
  return value;
};

export const observeLiveIssueContract = ({
  repository_root: repositoryRoot,
  issue_number: issueNumber,
  command_runner: runner,
}) => {
  const root = realDirectory(repositoryRoot, 'canonical repository root');
  if (git(runner, root, ['rev-parse', '--show-toplevel']) !== root) {
    throw new TypeError('canonical repository root is not the live Git toplevel.');
  }
  const repository = normalizeOrigin(git(runner, root, ['remote', 'get-url', 'origin']));
  const args = [
    'issue',
    'view',
    String(issueNumber),
    '--repo',
    repository.github_repository,
    '--json',
    'number,url,title,body,updatedAt',
  ];
  const stdout = runTrustedCommand(runner, 'gh', args, { cwd: root });
  let observed;
  try {
    observed = JSON.parse(stdout);
  } catch {
    throw new TypeError('live GitHub issue observation must be valid JSON.');
  }
  if (
    observed?.number !== issueNumber ||
    observed.url !== `https://github.com/${repository.github_repository}/issues/${String(issueNumber)}` ||
    typeof observed.title !== 'string' ||
    observed.title.length === 0 ||
    typeof observed.body !== 'string' ||
    typeof observed.updatedAt !== 'string'
  ) {
    throw new TypeError('live GitHub issue observation does not match the requested issue.');
  }
  const criteria = acceptanceLines(observed.body).map((content, index) => {
    const contentSha256 = payloadDigest({ content });
    return {
      id: `issue:${String(issueNumber)}:acceptance:${String(index + 1)}:${contentSha256.slice(0, 16)}`,
      content,
      content_sha256: contentSha256,
    };
  });
  const snapshot = {
    version: 1,
    repository: { root, ...repository },
    issue: {
      number: observed.number,
      url: observed.url,
      title: observed.title,
      body: observed.body,
      updated_at: observed.updatedAt,
    },
    acceptance_criteria: criteria,
    observation_receipt: {
      authority: 'trusted-lead',
      command: 'gh',
      args,
      stdout_sha256: createHash('sha256').update(stdout).digest('hex'),
      observed_revision: observed.updatedAt,
    },
  };
  return assertLiveIssueContract({ ...snapshot, sha256: payloadDigest(snapshot) });
};

export const assertLiveIssueContractCurrent = (expected, options = {}) => {
  const accepted = assertLiveIssueContract(expected);
  const actual = observeLiveIssueContract({
    repository_root: accepted.repository.root,
    issue_number: accepted.issue.number,
    command_runner: options.command_runner,
  });
  if (payloadDigest(actual) !== payloadDigest(accepted)) {
    throw new TypeError('live issue contract snapshot is stale or does not match GitHub.');
  }
  return accepted;
};

const digestOutput = (output) => createHash('sha256').update(output).digest('hex');

const canonicalPatch = (diff) =>
  diff
    .replace(/^index [^\n]*\n/gmu, '')
    .replace(/^similarity index [^\n]*\n/gmu, '')
    .replace(/^dissimilarity index [^\n]*\n/gmu, '');

const nulFields = (value) => value.split('\0').filter(Boolean);
const changedEntries = (runner, cwd, left, right) => {
  const fields = nulFields(runTrustedCommand(runner, 'git', [
    '-C', cwd, 'diff', '--name-status', '-z', '--no-renames', left, right, '--',
  ]));
  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    entries.push({ status: fields[index], path: fields[index + 1] });
  }
  return entries.sort((leftEntry, rightEntry) => leftEntry.path.localeCompare(rightEntry.path));
};

const allAxes = ['contract', 'code', 'verification'];
const authorityAutomationPath = (path) =>
  /^\.agents(?:\/|$)/u.test(path) ||
  /^\.github(?:\/|$)/u.test(path) ||
  /(?:^|\/)(?:tooling|scripts?)\/(?:release|publish|permissions?|governance|workflows?|automation)(?:\/|$)/iu.test(path) ||
  /(?:^|\/)(?:release|publish|permissions?|governance)[^/]*\.(?:ya?ml|json|[cm]?[jt]s)$/iu.test(path);
const contractPath = (path) =>
  /(?:^|\/)(?:docs?|rfcs?|api|public|contracts?|schemas?|dependencies|exports?)(?:\/|$)/iu.test(path) ||
  /^\.agents\/workflow-contracts\//u.test(path) ||
  /^packages\/[^/]+\/src\/.*\.[cm]?[jt]sx?$/u.test(path) ||
  /(?:^|\/)(?:manifest|schema|contract)(?:\.[^/]*)?$/iu.test(path) ||
  /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|package-lock\.json|bun\.lockb?|npm-shrinkwrap\.json)$/iu.test(path) ||
  /(?:^|\/)(?:exports?|public-api|entrypoints?|build-config)(?:\.[^/]*)?$/iu.test(path) ||
  /(?:\.schema\.json|\.d\.[cm]?ts|openapi|swagger|README(?:\.[^/]*)?\.md$)/iu.test(path);
const verificationPath = (path) =>
  /(?:^|\/)(?:tests?|__tests__|fixtures?|build|config|\.github)(?:\/|$)/iu.test(path) ||
  /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|tsconfig[^/]*\.json|biome\.json|vitest[^/]*|.*\.(?:test|spec)\.[^/]*)$/iu.test(path);
const implementationPath = (path) =>
  /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|rb|php|css|scss|html|vue|svelte)$/iu.test(path);

export const classifyConflictImpact = ({
  changed_paths: changedPathsValue,
  conflicting_paths: conflictingPaths,
  diff_shapes: diffShapes = [],
}) => {
  const paths = [...new Set([...(changedPathsValue ?? []), ...(conflictingPaths ?? [])])].sort();
  if (
    paths.length === 0 ||
    paths.some((path) => typeof path !== 'string' || path.length === 0) ||
    diffShapes.some((shape) => !['A', 'D', 'M'].includes(shape?.status) || !paths.includes(shape?.path))
  ) {
    return { category: 'unknown', minimum_affected_axes: allAxes, paths };
  }
  if (paths.some(authorityAutomationPath)) return { category: 'contract', minimum_affected_axes: allAxes, paths };
  if (paths.some(contractPath)) return { category: 'contract', minimum_affected_axes: allAxes, paths };
  const categories = new Set(paths.map((path) =>
    verificationPath(path) ? 'verification' : implementationPath(path) ? 'implementation' : 'unknown'));
  if (categories.size > 1) {
    return { category: 'cross-cutting', minimum_affected_axes: allAxes, paths };
  }
  if (categories.has('unknown')) {
    return { category: 'unknown', minimum_affected_axes: allAxes, paths };
  }
  return categories.has('implementation')
    ? { category: 'implementation', minimum_affected_axes: ['code', 'verification'], paths }
    : { category: 'verification', minimum_affected_axes: ['verification'], paths };
};

export const computeConflictGitEvidence = ({
  repository_root: repositoryRoot,
  worktree,
  previously_reviewed_head: oldHead,
  upstream_head: upstreamHead,
  resolved_head: resolvedHead,
  command_runner: runner,
}) => {
  const cwd = realDirectory(resolve(repositoryRoot, worktree), 'canonical issue worktree');
  for (const [name, commit] of [
    ['previously reviewed head', oldHead],
    ['upstream head', upstreamHead],
    ['resolved head', resolvedHead],
  ]) requireCommit(runner, cwd, commit, name);
  const tree = (head) => runTrustedCommand(runner, 'git', ['-C', cwd, 'ls-tree', '-r', '-z', '--full-tree', head]);
  const diff = (left, right) =>
    runTrustedCommand(runner, 'git', ['-C', cwd, 'diff', '--binary', '--no-ext-diff', left, right, '--']);
  const oldBase = git(runner, cwd, ['merge-base', oldHead, upstreamHead]);
  requireCommit(runner, cwd, oldBase, 'previous review base');
  const oldUpstream = diff(oldHead, upstreamHead);
  const oldResolved = diff(oldHead, resolvedHead);
  const upstreamResolved = diff(upstreamHead, resolvedHead);
  const reviewedPatch = diff(oldBase, oldHead);
  const resolvedPatch = diff(upstreamHead, resolvedHead);
  const reviewedShapes = changedEntries(runner, cwd, oldBase, oldHead);
  const upstreamShapes = changedEntries(runner, cwd, oldBase, upstreamHead);
  const resolvedShapes = changedEntries(runner, cwd, upstreamHead, resolvedHead);
  const reviewedPaths = reviewedShapes.map(({ path }) => path);
  const upstreamPaths = upstreamShapes.map(({ path }) => path);
  const resolvedPaths = resolvedShapes.map(({ path }) => path);
  const conflictingPaths = reviewedPaths.filter((path) => upstreamPaths.includes(path));
  const patchEquivalent = canonicalPatch(reviewedPatch) === canonicalPatch(resolvedPatch);
  const classifier = classifyConflictImpact({
    changed_paths: resolvedPaths,
    conflicting_paths: conflictingPaths,
    diff_shapes: resolvedShapes,
  });
  const digests = {
    old_content_sha256: digestOutput(tree(oldHead)),
    upstream_content_sha256: digestOutput(tree(upstreamHead)),
    resolved_content_sha256: digestOutput(tree(resolvedHead)),
    old_upstream_diff_sha256: digestOutput(oldUpstream),
    old_resolved_diff_sha256: digestOutput(oldResolved),
    upstream_resolved_diff_sha256: digestOutput(upstreamResolved),
  };
  return {
    old_base: oldBase,
    digests,
    patch_digests: {
      reviewed_patch_sha256: digestOutput(canonicalPatch(reviewedPatch)),
      resolved_patch_sha256: digestOutput(canonicalPatch(resolvedPatch)),
    },
    patch_equivalent: patchEquivalent,
    upstream_overlap: conflictingPaths.length > 0,
    mechanical_inheritance_eligible: patchEquivalent && conflictingPaths.length === 0,
    reviewed_paths: reviewedPaths,
    upstream_paths: upstreamPaths,
    resolved_paths: resolvedPaths,
    conflicting_paths: conflictingPaths,
    diff_shapes: {
      reviewed: reviewedShapes,
      upstream: upstreamShapes,
      resolved: resolvedShapes,
    },
    classifier,
    diffs: { old_upstream: oldUpstream, old_resolved: oldResolved, upstream_resolved: upstreamResolved },
  };
};

export const assertCanonicalAdditionalSource = (source, repositoryRoot, options = {}) => {
  if (
    typeof source?.source !== 'string' ||
    !/^(?:docs|rfcs|security)\//u.test(source.source) && !/^SECURITY(?:\.[A-Za-z0-9_-]+)?\.md$/u.test(source.source) ||
    !sha.test(source.revision ?? '') ||
    !sha256.test(source.content_sha256 ?? '')
  ) {
    throw new TypeError('additional approved source must be a canonical docs/RFC/security revision and digest.');
  }
  const root = resolve(repositoryRoot);
  const path = resolve(root, source.source);
  if (!path.startsWith(`${root}/`) || !existsSync(path) || lstatSync(path).isSymbolicLink()) {
    throw new TypeError('additional approved source must be a real canonical repository file.');
  }
  const live = readFileSync(path);
  const committed = runTrustedCommand(
    options.command_runner,
    'git',
    ['-C', root, 'show', `${source.revision}:${source.source}`],
  );
  if (digestOutput(live) !== source.content_sha256 || digestOutput(committed) !== source.content_sha256) {
    throw new TypeError('additional approved source content or revision is stale.');
  }
  return source;
};
