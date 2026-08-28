import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { payloadDigest } from '../../../workflow-contracts/contracts.mjs';
import { currentCoordinatorSessionId } from './issue-supervisor-contracts.mjs';
import { loadIssueSupervisorStore } from './issue-supervisor-store.mjs';
import { canonicalLaneRuntimeRoot } from './lane-runtime-paths.mjs';
import { withGlobalCanonicalVerificationLease } from './review-loop-policy.mjs';
import { assertCanonicalGitState } from './trusted-evidence.mjs';

let anonymousInvocation = 0;

export class CanonicalVerificationSignal extends Error {
  constructor(signal) {
    super(`canonical verification terminated by ${signal}.`);
    this.name = 'CanonicalVerificationSignal';
    this.signal = signal;
  }
}

const splitWrapperArguments = (args) => {
  const separator = args.indexOf('--');
  if (separator === -1 || separator === args.length - 1) throw new TypeError(usage);
  return { wrapper: args.slice(0, separator), child: args.slice(separator + 1) };
};
const valueAfter = (args, flag) => {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) throw new TypeError(`Missing ${flag}.`);
  return args[index + 1];
};

const requireWorktree = (path) => {
  if (typeof path !== 'string' || path !== resolve(path)) {
    throw new TypeError('canonical verification cwd must be an absolute canonical path.');
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(path) !== path) {
    throw new TypeError('canonical verification cwd must be a real canonical directory.');
  }
  return path;
};

const fileIdentity = (path, relativePath, kind = 'tracked') => {
  const stat = lstatSync(path, { bigint: true });
  const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(path), 'utf8') : readFileSync(path);
  return {
    kind, path: relativePath, dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode),
    size: String(stat.size), mtime_ns: String(stat.mtimeNs), ctime_ns: String(stat.ctimeNs),
    content_sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};

const gitOutput = (cwd, args, options = {}) => execFileSync('git', ['-C', cwd, ...args], {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30_000, ...options,
});

const authoritySnapshot = (worktree) => {
  const tracked = gitOutput(worktree, ['ls-files', '-z']).split('\0').filter(Boolean).sort();
  const files = tracked.map((path) => fileIdentity(resolve(worktree, path), path));
  const branch = gitOutput(worktree, ['symbolic-ref', '--short', 'HEAD']).trim();
  const gitPaths = [['HEAD', 'git-head'], ['logs/HEAD', 'git-head-log'], [`refs/heads/${branch}`, 'git-branch-ref'], [`logs/refs/heads/${branch}`, 'git-branch-log']];
  for (const [name, kind] of gitPaths) {
    const candidate = gitOutput(worktree, ['rev-parse', '--git-path', name]).trim();
    const path = resolve(worktree, candidate);
    if (existsSync(path)) files.push(fileIdentity(path, name, kind));
  }
  const canonical = { version: 1, files };
  return { canonical, sha256: payloadDigest(canonical) };
};

const assertUnchangedAuthority = (before, worktree) => {
  const after = authoritySnapshot(worktree);
  if (payloadDigest(after.canonical) !== payloadDigest(before.canonical)) {
    throw new TypeError('canonical verification tracked authority changed during candidate-controlled verification.');
  }
  return before.sha256;
};

const requireBoundWorktree = ({ repositoryRoot, runtimeRoot, laneId, issueNumber, cwd, headSha, preflightSha256 }) => {
  const supervisor = loadIssueSupervisorStore(runtimeRoot, laneId, issueNumber, { allow_untracked: true });
  if (supervisor === null) throw new TypeError('canonical verification requires a persisted lane issue supervisor.');
  const expected = resolve(repositoryRoot, supervisor.snapshot.worktree);
  const canonicalHead = headSha ?? supervisor.snapshot.head_sha;
  const canonicalWorktree = requireWorktree(cwd);
  if (canonicalWorktree !== requireWorktree(expected)) {
    throw new TypeError('canonical verification cwd must match its persisted lane issue supervisor.');
  }
  if (supervisor.snapshot.head_sha !== canonicalHead) {
    throw new TypeError('canonical verification head must match its persisted lane issue supervisor.');
  }
  if (!/^[a-f0-9]{64}$/u.test(preflightSha256 ?? '') || supervisor.snapshot.review_preflight?.sha256 !== preflightSha256) {
    throw new TypeError('canonical verification preflight digest must match its authoritative supervisor.');
  }
  return { canonicalWorktree, canonicalHead, supervisor };
};

export const resolveTrustedPnpmStore = (
  repositoryRoot,
  worktree,
  runtimeRoot,
  { execute = execFileSync } = {},
) => {
  const output = resolve(runtimeRoot, 'pnpm-store');
  mkdirSync(output, { recursive: true });
  const outputStat = lstatSync(output);
  if (
    outputStat.isSymbolicLink() ||
    !outputStat.isDirectory() ||
    realpathSync(output) !== output
  ) {
    throw new TypeError(
      'trusted host pnpm store must be a real canonical directory.',
    );
  }
  const lockfilePath = resolve(worktree, 'pnpm-lock.yaml');
  const lockfileStat = lstatSync(lockfilePath);
  if (lockfileStat.isSymbolicLink() || !lockfileStat.isFile()) {
    throw new TypeError('canonical verification requires a real pnpm lockfile.');
  }
  const lockfileSha256 = createHash('sha256')
    .update(readFileSync(lockfilePath))
    .digest('hex');
  const markerPath = resolve(output, `.fluo-fetch-${lockfileSha256}.ready`);
  if (!existsSync(markerPath)) {
    const bootstrapRoot = realpathSync(
      mkdtempSync(
        resolve(runtimeRoot, '.canonical-store-bootstrap-'),
      ),
    );
    try {
      const npmrcPath = resolve(bootstrapRoot, 'empty-npmrc');
      const packageManager =
        JSON.parse(
          readFileSync(
            resolve(repositoryRoot, 'package.json'),
            'utf8',
          ),
        ).packageManager;
      writeFileSync(
        resolve(bootstrapRoot, 'pnpm-lock.yaml'),
        readFileSync(lockfilePath),
        { flag: 'wx' },
      );
      writeFileSync(
        resolve(bootstrapRoot, 'package.json'),
        `${JSON.stringify({ private: true, packageManager })}\n`,
        { flag: 'wx' },
      );
      writeFileSync(npmrcPath, '', { flag: 'wx' });
      execute(
        'pnpm',
        [
          'fetch',
          '--force',
          '--frozen-lockfile',
          '--ignore-scripts',
          '--ignore-pnpmfile',
          '--store-dir',
          output,
        ],
        {
          cwd: bootstrapRoot,
          encoding: 'utf8',
          timeout: 30 * 60_000,
          env: {
            ...process.env,
            HOME: bootstrapRoot,
            XDG_CACHE_HOME: resolve(bootstrapRoot, 'cache'),
            XDG_CONFIG_HOME: resolve(bootstrapRoot, 'config'),
            XDG_DATA_HOME: resolve(bootstrapRoot, 'data'),
            NPM_CONFIG_USERCONFIG: npmrcPath,
            npm_config_globalconfig: '/dev/null',
          },
        },
      );
    } finally {
      rmSync(bootstrapRoot, { recursive: true, force: true });
    }
    try {
      writeFileSync(markerPath, `${lockfileSha256}\n`, { flag: 'wx' });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  const stat = lstatSync(output);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(output) !== output) {
    throw new TypeError('trusted host pnpm store must be a real canonical directory.');
  }
  const markerStat = lstatSync(markerPath);
  if (
    markerStat.isSymbolicLink() ||
    !markerStat.isFile() ||
    readFileSync(markerPath, 'utf8').trim() !== lockfileSha256
  ) {
    throw new TypeError('trusted host pnpm store readiness marker is invalid.');
  }
  return {
    path: output,
    lockfile_sha256: lockfileSha256,
  };
};

const disposableInput = (worktree, head, store) => {
  const tree = gitOutput(worktree, ['rev-parse', `${head}^{tree}`]).trim();
  const entries = gitOutput(worktree, ['ls-tree', '-r', '-z', '--full-tree', head]);
  return {
    tree_sha: tree,
    input_sha256: payloadDigest({
      version: 2,
      head_sha: head,
      tree_sha: tree,
      entries,
      pnpm_store_path: store.path,
      lockfile_sha256: store.lockfile_sha256,
    }),
  };
};

export const verificationRuntimePrefix = (runtimeRoot, phase) => {
  if (
    typeof runtimeRoot !== 'string' ||
    runtimeRoot !== resolve(runtimeRoot) ||
    !['install', 'verify'].includes(phase)
  ) {
    throw new TypeError('canonical verification runtime prefix is invalid.');
  }
  return resolve(runtimeRoot, `.canonical-verification-${phase}-`);
};

const prepareDisposableWorktree = (
  repositoryRoot,
  canonicalWorktree,
  head,
  store,
  runtimeRoot,
) => {
  const parent = resolve(repositoryRoot, '.worktrees');
  mkdirSync(parent, { recursive: true });
  const path = realpathSync(mkdtempSync(resolve(parent, '.canonical-verify-')));
  rmSync(path, { recursive: true });
  try {
    gitOutput(canonicalWorktree, ['worktree', 'add', '--quiet', '--detach', path, head]);
    if (gitOutput(path, ['status', '--porcelain=v1', '--untracked-files=all']).length !== 0 ||
        gitOutput(path, ['rev-parse', 'HEAD']).trim() !== head) {
      throw new TypeError('disposable canonical verification worktree is not clean at the exact reviewed head.');
    }
    const input = disposableInput(path, head, store);
    const installStatus = containedRun(path, 'install', store, runtimeRoot);
    if (installStatus !== 0) {
      throw new TypeError(`disposable canonical verification dependency installation failed with status ${String(installStatus)}.`);
    }
    return { path, ...input };
  } catch (error) {
    try { gitOutput(canonicalWorktree, ['worktree', 'remove', '--force', path]); } catch { rmSync(path, { recursive: true, force: true }); }
    throw error;
  }
};

const removeDisposableWorktree = (canonicalWorktree, path) => {
  try {
    gitOutput(canonicalWorktree, ['worktree', 'remove', '--force', path]);
  } finally {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  }
};

const containedRun = (disposableRoot, phase, store, canonicalRuntimeRoot) => {
  const runtimeRoot = realpathSync(
    mkdtempSync(verificationRuntimePrefix(canonicalRuntimeRoot, phase)),
  );
  try {
    const requestPath = resolve(runtimeRoot, `request-${randomUUID()}.json`);
    writeFileSync(requestPath, `${JSON.stringify({
      disposable_root: disposableRoot,
      runtime_root: runtimeRoot,
      phase,
      pnpm_store_path: store.path,
      lockfile_sha256: store.lockfile_sha256,
    })}\n`, { flag: 'wx' });
    const helper = resolve(import.meta.dirname, 'verification-containment.mjs');
    const result = spawnSync(process.execPath, [helper, requestPath], {
      cwd: disposableRoot,
      shell: false,
      stdio: 'inherit',
    });
    if (result.error !== undefined) throw result.error;
    if (result.signal !== null) throw new CanonicalVerificationSignal(result.signal);
    return result.status ?? 1;
  } finally {
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
};

const realDirectory = (path, name) => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(path) !== path) {
    throw new TypeError(`${name} must be a real canonical directory.`);
  }
  return path;
};

export const publishCanonicalVerificationReceipt = (runtimeRoot, laneId, issueNumber, taskId, receipt) => {
  realDirectory(runtimeRoot, 'canonical verification runtime root');
  const laneRoot = realDirectory(resolve(runtimeRoot, laneId), 'canonical verification lane directory');
  const issuesRoot = realDirectory(resolve(laneRoot, 'issues'), 'canonical verification issues directory');
  const issueRoot = realDirectory(resolve(issuesRoot, String(issueNumber)), 'canonical verification issue directory');
  if (!issueRoot.startsWith(`${issuesRoot}${sep}`)) {
    throw new TypeError('canonical verification issue directory escaped containment.');
  }
  const receiptRoot = resolve(issueRoot, 'canonical-verification');
  if (!existsSync(receiptRoot)) {
    try {
      mkdirSync(receiptRoot);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  realDirectory(receiptRoot, 'canonical verification receipt directory');
  if (!receiptRoot.startsWith(`${issueRoot}${sep}`) || realpathSync(receiptRoot) !== receiptRoot) {
    throw new TypeError('canonical verification receipt directory escaped issue containment.');
  }
  const receiptPath = resolve(receiptRoot, `${taskId}.json`);
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  const receiptStat = lstatSync(receiptPath);
  realDirectory(issueRoot, 'canonical verification issue directory');
  realDirectory(receiptRoot, 'canonical verification receipt directory');
  if (receiptStat.isSymbolicLink() || !receiptStat.isFile() || !receiptPath.startsWith(`${realpathSync(receiptRoot)}${sep}`)) {
    throw new TypeError('canonical verification receipt publication escaped containment.');
  }
};

export const runCanonicalVerification = ({
  repository_root: repositoryRoot,
  runtime_root: requestedRuntimeRoot,
  lane_id: laneId,
  issue_number: issueNumber,
  cwd,
  head_sha: headSha,
  task_id: taskId,
  parent_session_id: parentSessionId,
  preflight_sha256: preflightSha256,
  command = 'pnpm',
  command_args: commandArgs = ['verify'],
}) => {
  if (typeof repositoryRoot !== 'string' || repositoryRoot !== resolve(repositoryRoot)) {
    throw new TypeError('canonical verification repository root must be an absolute canonical path.');
  }
  const runtimeRoot = canonicalLaneRuntimeRoot(repositoryRoot);
  if (typeof requestedRuntimeRoot !== 'string' || requestedRuntimeRoot !== runtimeRoot) {
    throw new TypeError('canonical verification runtime root must be the canonical lane runtime root.');
  }
  if (command !== 'pnpm' || JSON.stringify(commandArgs) !== JSON.stringify(['verify'])) {
    throw new TypeError('canonical verification command must be exactly pnpm verify.');
  }
  const { canonicalWorktree, canonicalHead, supervisor } = requireBoundWorktree({
    repositoryRoot, runtimeRoot, laneId, issueNumber, cwd, headSha, preflightSha256,
  });
  if (
    typeof parentSessionId !== 'string' ||
    parentSessionId.length === 0 ||
    parentSessionId !== currentCoordinatorSessionId(supervisor.snapshot)
  ) {
    throw new TypeError(
      'canonical verification parent session must match its issue supervisor.',
    );
  }
  const canonicalTaskId = taskId ?? `st_canonical_${String(process.pid)}_${String(++anonymousInvocation)}`;
  return withGlobalCanonicalVerificationLease(runtimeRoot, laneId, issueNumber, () => {
    if (typeof canonicalTaskId !== 'string' || !/^st_[A-Za-z0-9_-]+$/u.test(canonicalTaskId) || !/^[a-f0-9]{40}$/u.test(canonicalHead)) {
      throw new TypeError('canonical verification command is invalid.');
    }
    assertCanonicalGitState({
      repository_root: repositoryRoot, worktree: supervisor.snapshot.worktree, branch: supervisor.snapshot.branch,
      expected_head: canonicalHead, commits: [canonicalHead], allow_untracked: true,
    });
    const beforeAuthority = authoritySnapshot(canonicalWorktree);
    // Resolve host package authority before containment redirects HOME/XDG.
    const store = resolveTrustedPnpmStore(
      repositoryRoot,
      canonicalWorktree,
      runtimeRoot,
    );
    const disposable = prepareDisposableWorktree(
      repositoryRoot,
      canonicalWorktree,
      canonicalHead,
      store,
      runtimeRoot,
    );
    let status;
    try {
      status = containedRun(disposable.path, 'verify', store, runtimeRoot);
    } finally {
      removeDisposableWorktree(canonicalWorktree, disposable.path);
    }
    const current = loadIssueSupervisorStore(runtimeRoot, laneId, issueNumber, { allow_untracked: true });
    if (current === null || current.snapshot.head_sha !== canonicalHead || current.snapshot.review_preflight?.sha256 !== preflightSha256) {
      throw new TypeError('canonical verification authoritative state changed while verification ran.');
    }
    const postRunGitState = assertCanonicalGitState({
      repository_root: repositoryRoot, worktree: supervisor.snapshot.worktree, branch: supervisor.snapshot.branch,
      expected_head: canonicalHead, commits: [canonicalHead], allow_untracked: true,
    });
    assertUnchangedAuthority(beforeAuthority, canonicalWorktree);
    const receipt = {
      version: 2,
      task_id: canonicalTaskId,
      repository_root: repositoryRoot,
      runtime_root: runtimeRoot,
      lane_id: laneId,
      issue_number: issueNumber,
      parent_session_id: parentSessionId,
      worktree: canonicalWorktree,
      execution_worktree: disposable.path,
      head_sha: canonicalHead,
      tree_sha: disposable.tree_sha,
      input_sha256: disposable.input_sha256,
      pnpm_store_path: store.path,
      lockfile_sha256: store.lockfile_sha256,
      preflight_sha256: preflightSha256,
      authority_snapshot_sha256: beforeAuthority.sha256,
      post_run_git_state: postRunGitState,
      command: ['pnpm', 'verify'],
      containment_backend: process.platform === 'darwin' ? 'sandbox-exec' : 'bwrap-pid-namespace',
      status,
      result: status === 0 ? 'pass' : 'fail',
    };
    publishCanonicalVerificationReceipt(runtimeRoot, laneId, issueNumber, canonicalTaskId, receipt);
    payloadDigest(receipt);
    return status;
  });
};

const isCli = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
const usage = 'usage: canonical-verification.mjs --root <repository> --runtime-root <repository>/.omo/lane-runs --lane <id> --issue <number> --parent-session <session-id> --cwd <path> --head <sha> --preflight <sha256> --task <task-id> -- pnpm verify';
if (isCli) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') process.stdout.write(`${usage}\n`);
  else {
    const { wrapper, child } = splitWrapperArguments(args);
    if (wrapper.includes('--help')) process.stdout.write(`${usage}\n`);
    else {
      try {
        const status = runCanonicalVerification({
          repository_root: valueAfter(wrapper, '--root'), runtime_root: valueAfter(wrapper, '--runtime-root'),
          lane_id: valueAfter(wrapper, '--lane'), issue_number: Number(valueAfter(wrapper, '--issue')),
          parent_session_id: valueAfter(wrapper, '--parent-session'),
          cwd: valueAfter(wrapper, '--cwd'), head_sha: valueAfter(wrapper, '--head'),
          task_id: valueAfter(wrapper, '--task'), preflight_sha256: valueAfter(wrapper, '--preflight'),
          command: child[0], command_args: child.slice(1),
        });
        process.exitCode = status;
      } catch (error) {
        if (error instanceof CanonicalVerificationSignal) process.kill(process.pid, error.signal);
        throw error;
      }
    }
  }
}
