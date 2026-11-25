#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, mkdirSync, readFileSync, readlinkSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, delimiter, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { publicWorkspacePackageNames } from '../../../../tooling/release/release-intents.mjs';
import { verifyChangesetReleaseLane } from '../../../../tooling/release/verify-changeset-release-lane.mjs';
import { contractDigest, createPreflight, evaluatePreflight, validatePreflight } from '../../issue-preflight/scripts/contracts.mjs';
import { assertIssueImplementIdentity, assertIssueImplementInput, assertIssueImplementResult } from '../../issue-implement/scripts/contracts.mjs';
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

/** Existing sidecars retain their exact digest when caller_searches is absent. */
export function prepareSourceFootprint(root, input) {
  exact(input, ['version', 'issue', 'issue_sha256', 'base_sha', 'categories',
    ...(Object.hasOwn(input ?? {}, 'caller_searches') ? ['caller_searches'] : [])], 'source footprint');
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
  if (Object.hasOwn(input, 'caller_searches')) {
    requireInput(Array.isArray(input.caller_searches) && input.caller_searches.length > 0,
      'caller_searches: complete symbol searches required');
    const symbols = new Set();
    for (const search of input.caller_searches) {
      exact(search, ['symbol', 'command', 'matches'], 'caller search');
      requireInput(typeof search.symbol === 'string' && search.symbol.trim()
        && !/[\x00-\x1f]/u.test(search.symbol) && !symbols.has(search.symbol), 'caller search: invalid/duplicate symbol');
      symbols.add(search.symbol);
      const quoted = /^[a-zA-Z0-9_.-]+$/u.test(search.symbol) ? search.symbol
        : `'${search.symbol.replaceAll("'", "'\\''")}'`;
      requireInput(search.command === `git grep -n -w -F -e ${quoted} ${input.base_sha} --`,
        'caller search: command must search the complete pinned repository');
      requireInput(Array.isArray(search.matches), 'caller search: matches must be complete');
      for (const match of search.matches) {
        exact(match, ['path', 'line', 'text'], 'caller match');
        requireInput(pathSafe(match.path) && Number.isSafeInteger(match.line) && match.line > 0
          && typeof match.text === 'string', 'caller search: invalid match');
      }
      let output;
      try {
        output = execFileSync('git', ['grep', '-n', '-z', '-w', '-F', '-e', search.symbol, input.base_sha, '--'],
          { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        requireInput(error.status === 1 && error.signal === null && !error.stdout?.length
          && !error.stderr?.length, `caller search: incomplete search for ${search.symbol}: ${error.message}`);
        output = '';
      }
      // NUL delimiters preserve Git paths independently of quoting and colons.
      const matches = [];
      const record = /([^\0]+)\0([1-9][0-9]*)\0([^\n]*)\n/guy;
      let offset = 0;
      while (offset < output.length) {
        const match = record.exec(output);
        requireInput(match !== null && match[1].startsWith(`${input.base_sha}:`),
          'caller search: incomplete Git output');
        matches.push({ path: match[1].slice(input.base_sha.length + 1), line: Number(match[2]), text: match[3] });
        offset = record.lastIndex;
      }
      requireInput(isDeepStrictEqual(matches, search.matches), `caller search: incomplete or altered matches for ${search.symbol}`);
    }
  }
  return { ...input, sha256: contractDigest(input) };
}

function authenticatedFootprint(root, value) {
  const keys = ['version', 'issue', 'issue_sha256', 'base_sha', 'categories', 'sha256'];
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'caller_searches')) keys.push('caller_searches');
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), keys.sort())) {
    const error = new WorkflowPreparationError('invalid source footprint: supply the raw footprint object from prepared.footprint, not the preparation wrapper');
    error.code = 'invalid-source-footprint';
    throw error;
  }
  const { sha256: expected, ...input } = value;
  const footprint = prepareSourceFootprint(root, input);
  requireInput(footprint.sha256 === expected, 'review preparation: stale source footprint binding');
  return footprint;
}

function finalizePreflight(input) {
  exact(input, ['version', 'stage', 'root', 'footprint', 'contract_input'], 'preflight finalization');
  requireInput(input.version === 1 && input.stage === 'finalize-preflight'
    && typeof input.root === 'string' && isAbsolute(input.root), 'preflight finalization: invalid stage/root');
  const footprint = authenticatedFootprint(input.root, input.footprint);
  requireInput(Object.hasOwn(footprint, 'caller_searches'), 'preflight finalization: caller_searches required');
  const contractInput = input.contract_input;
  requireInput(contractInput && typeof contractInput === 'object' && !Array.isArray(contractInput)
    && ['sha256', 'dispatch', 'agent'].every((key) => !Object.hasOwn(contractInput, key))
    && Object.hasOwn(contractInput, 'validation_requirements'), 'preflight finalization: digest-free contract_input and complete validation_requirements required');
  requireInput(contractInput.issue === footprint.issue && contractInput.issue_sha256 === footprint.issue_sha256
    && contractInput.base_sha === footprint.base_sha, 'preflight finalization: issue/base binding mismatch');
  const contract = createPreflight(contractInput);
  validatePreflight(contract);
  return { status: 'prepared', kind: 'preflight-contract', contract };
}

// Classify literal shell words without evaluating assignments or substitutions.
function changesPath(source, simpleCommand = false) {
  let context = 'command';
  const words = /(?:'[^']*'|"(?:\\.|[^"\\])*"|\\[\s\S]|[^\s;&|(){}'"\\])+|[;&|(){}\n]/gu;
  for (const [raw] of source.matchAll(words)) {
    if (/^[;&|(){}\n]$/u.test(raw)) {
      if (simpleCommand) return true;
      context = 'command';
      continue;
    }
    const word = raw.replace(/'([^']*)'|"((?:\\.|[^"\\])*)"|\\([\s\S])/gu,
      (_match, single, double, escaped) => single ?? (double === undefined
        ? escaped : double.replace(/\\([$`"\\\n])/gu, '$1')));
    if (/^PATH(?:\+)?=/u.test(word)
      && (context !== 'arguments' || /^PATH(?:\+)?=/u.test(raw))) return true;
    if (context === 'environment') {
      if (['--ignore-environment', '-', '--unset=PATH'].includes(word)) return true;
      if (word === '--unset') {
        context = 'environment-unset';
        continue;
      }
      if (word.startsWith('--') && !word.startsWith('--unset=')) return true;
      if (/^-[^-]/u.test(word)) {
        for (let offset = 1; offset < word.length; offset += 1) {
          const option = word[offset];
          if (option === 'i') return true;
          if (option === 'u') {
            const target = word.slice(offset + 1);
            if (target === 'PATH') return true;
            if (!target) context = 'environment-unset';
            break;
          }
          if (option !== 'v' && option !== '0') return true;
        }
        continue;
      }
    }
    switch (context) {
      case 'arguments':
      case 'assignment':
        break;
      case 'unset':
        if (word === 'PATH') return true;
        break;
      case 'environment-unset':
        if (word === 'PATH') return true;
        context = 'environment';
        break;
      case 'shell':
        if (changesPath(word)) return true;
        break;
      case 'environment':
      case 'command':
        if (/^-|^[a-zA-Z_][a-zA-Z0-9_]*=/u.test(word)) break;
        switch (basename(word)) {
          case 'command': case 'builtin': case 'exec': case 'nohup':
            context = 'command'; break;
          case 'env':
            context = 'environment'; break;
          case 'export': case 'readonly': case 'declare': case 'typeset': case 'local':
            context = 'assignment'; break;
          case 'unset':
            context = 'unset'; break;
          case 'sh': case 'bash': case 'dash': case 'zsh': case 'ksh': case 'eval':
            context = 'shell'; break;
          default:
            context = 'arguments';
        }
        break;
    }
  }
  return false;
}

// Read only the supported leading PATH assignment, never evaluate shell code.
function commandPath(command) {
  const assignment = /^\s*(export[ \t]+)?PATH=/u.exec(command);
  const unsupported = () => {
    throw new WorkflowPreparationError(`implement preparation: unsupported command PATH: ${command}`);
  };
  if (!assignment) {
    if (changesPath(command)) unsupported();
    return null;
  }
  let value = '';
  let quote = null;
  let offset = assignment[0].length;
  for (; offset < command.length; offset += 1) {
    const character = command[offset];
    if (quote === "'") {
      if (character === "'") quote = null;
      else value += character;
      continue;
    }
    if (character === quote) {
      quote = null;
      continue;
    }
    if (!quote && (character === "'" || character === '"')) {
      quote = character;
      continue;
    }
    if (!quote && /[\s;]/u.test(character)) break;
    if (character === '$') {
      const expansion = /^(?:\$PATH(?![a-zA-Z0-9_])|\$\{PATH\})/u.exec(command.slice(offset));
      if (!expansion) unsupported();
      value += process.env.PATH ?? '';
      offset += expansion[0].length - 1;
      continue;
    }
    if (character === '`' || character === '\\' || /[\x00-\x1f]/u.test(character)
      || (!quote && !/[a-zA-Z0-9_/:.,+@%=-]/u.test(character))) unsupported();
    value += character;
  }
  if (quote !== null) unsupported();
  const remainder = command.slice(offset);
  const next = assignment[1] ? /^[ \t]*;[ \t]*(\S[\s\S]*)$/u.exec(remainder)
    : /^[ \t]+([^;&|][\s\S]*)$/u.exec(remainder);
  if (!next || changesPath(next[1], !assignment[1])) unsupported();
  return value.split(delimiter);
}

function prepareImplement(input) {
  exact(input, ['version', 'stage', 'root', 'accepted_contract_path', 'contract', 'input'], 'implement preparation');
  requireInput(input.version === 1 && input.stage === 'implement'
    && typeof input.root === 'string' && isAbsolute(input.root)
    && typeof input.accepted_contract_path === 'string' && isAbsolute(input.accepted_contract_path),
  'implement preparation: invalid stage/root/accepted contract path');
  assertIssueImplementInput(input.input);
  validatePreflight(input.contract);
  const accepted = JSON.parse(readFileSync(input.accepted_contract_path, 'utf8'));
  requireInput(isDeepStrictEqual(accepted, input.contract), 'implement preparation: stale accepted contract');
  const assignment = input.input;
  requireInput(accepted.issue === assignment.issue_number && accepted.sha256 === assignment.preflight_sha256,
    'implement preparation: issue/preflight binding mismatch');
  const root = realpathSync(input.root);
  const worktree = realpathSync(resolve(root, assignment.worktree));
  requireInput(relative(root, worktree) === assignment.worktree, 'implement preparation: wrong worktree realpath');
  requireInput(realpathSync(resolve(root, text(root, 'rev-parse', '--git-common-dir')))
    === realpathSync(resolve(worktree, text(worktree, 'rev-parse', '--git-common-dir'))),
  'implement preparation: wrong repository checkout');
  assertIssueImplementIdentity(assignment, {
    branch: assignment.branch, worktree: relative(root, worktree),
    checked_out_branch: text(worktree, 'branch', '--show-current'),
    head_sha: text(worktree, 'rev-parse', 'HEAD'), pr: assignment.existing_pr,
  });
  requireInput(text(worktree, 'status', '--porcelain=v1') === '', 'implement preparation: dirty checkout');
  const prerequisites = { status: Object.hasOwn(accepted, 'validation_requirements') ? 'checked' : 'undeclared',
    local: [], ci_only: [] };
  const missing = [];
  for (const requirement of accepted.validation_requirements ?? []) {
    if (requirement.kind === 'ci-only') {
      prerequisites.ci_only.push(requirement);
      continue;
    }
    const commandDirectories = commandPath(requirement.command);
    const tools = requirement.prerequisites.tools.map((tool) => {
      const directories = commandDirectories ?? [...tool.path_dirs, ...(process.env.PATH ?? '').split(delimiter)];
      const path = directories.map((directory) => resolve(worktree, directory, tool.name)).find((candidate) => {
        try { accessSync(candidate, constants.X_OK); return statSync(candidate).isFile(); }
        catch (error) {
          if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) return false;
          throw error;
        }
      });
      if (!path) missing.push({ command: requirement.command, tool: tool.name });
      return { ...tool, path };
    });
    const artifacts = requirement.prerequisites.artifacts.map((artifact) => {
      let available = false;
      try {
        const path = realpathSync(resolve(worktree, artifact.path));
        const inside = relative(worktree, path);
        const stat = statSync(path);
        available = inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)
          && (artifact.kind === 'file' ? stat.isFile() : stat.isDirectory());
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      }
      if (!available) missing.push({ command: requirement.command, artifact });
      return { ...artifact, available };
    });
    prerequisites.local.push({ validation: requirement.validation, command: requirement.command, tools, artifacts });
  }
  requireInput(missing.length === 0, `implement preparation: missing prerequisites ${JSON.stringify(missing)}`);
  return { status: 'prepared', kind: 'implement-input',
    dispatch: registeredDispatch(root, dispatchFor(assignment.mode)), input: assignment, contract: accepted, prerequisites };
}

// Cwd roots are observed for this effective user; the system-wide parent table
// also attributes their descendants, even after a descendant changes directory.
function observeImplementProcesses(worktree) {
  requireInput(['darwin', 'linux'].includes(process.platform) && typeof process.geteuid === 'function',
    'process observation: unsupported platform');
  const run = (command, args, statuses = [0]) => {
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    requireInput(!result.error && statuses.includes(result.status) && result.signal === null && !result.stderr,
      `process observation: ${command} failed: exit=${result.status} ${result.error?.message ?? result.stderr}`);
    return result.stdout;
  };
  const table = () => run('ps', ['-axo', 'pid=,ppid=,uid=,stat=,command=']).trim().split('\n').map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/u.exec(line);
    requireInput(match !== null, 'process observation: malformed ps output');
    return { pid: Number(match[1]), ppid: Number(match[2]), uid: Number(match[3]),
      state: match[4], command: match[5] };
  }).filter((entry) => !entry.state.startsWith('Z') && entry.pid !== process.pid);
  const entries = table();
  const owned = entries.filter((entry) => entry.uid === process.geteuid());
  const directories = new Map();
  if (process.platform === 'darwin' && owned.length) {
    // lsof returns 1 when any selected pid has exited. Missing cwd entries
    // still fail below unless the second ps observation confirms their exit.
    const output = run('lsof', ['-nP', '-a', '-p', owned.map((entry) => entry.pid).join(','), '-d', 'cwd', '-F0pn'], [0, 1]);
    let pid;
    for (const field of output.split('\0')) {
      const value = field.replace(/^\n/u, '');
      if (value.startsWith('p')) pid = Number(value.slice(1));
      if (value.startsWith('n')) {
        requireInput(Number.isSafeInteger(pid) && isAbsolute(value.slice(1)),
          'process observation: malformed lsof cwd');
        directories.set(pid, value.slice(1));
      }
    }
  }
  if (process.platform === 'linux') {
    for (const entry of owned) {
      try { directories.set(entry.pid, readlinkSync(`/proc/${entry.pid}/cwd`)); }
      catch (error) {
        // Disappearing processes are checked against a second live table below.
        requireInput(error.code === 'ENOENT', `process observation: cwd ${entry.pid}: ${error.message}`);
      }
    }
  }
  const missing = owned.filter((entry) => !directories.has(entry.pid));
  if (missing.length) {
    const alive = new Set(table().map((entry) => entry.pid));
    requireInput(missing.every((entry) => !alive.has(entry.pid)),
      `process observation: cwd unavailable for live pids ${missing.filter((entry) => alive.has(entry.pid)).map((entry) => entry.pid).join(',')}`);
  }
  const attributed = new Map();
  for (const entry of owned) {
    const cwd = directories.get(entry.pid);
    if (cwd === undefined) continue;
    const inside = relative(worktree, cwd);
    if (inside === '' || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))) {
      attributed.set(entry.pid, { pid: entry.pid, ppid: entry.ppid, command: entry.command,
        attribution: { kind: 'cwd', path: cwd } });
    }
  }
  for (let added = true; added;) {
    added = false;
    for (const entry of entries) {
      if (!attributed.has(entry.pid) && attributed.has(entry.ppid)) {
        attributed.set(entry.pid, { pid: entry.pid, ppid: entry.ppid, command: entry.command,
          attribution: { kind: 'descendant', ancestor_pid: entry.ppid } });
        added = true;
      }
    }
  }
  return [...attributed.values()].sort((a, b) => a.pid - b.pid);
}

/** Read-only completion admission, separate from the exact version 1 Result. */
export function prepareImplementResult(input) {
  exact(input, ['version', 'stage', 'root', 'accepted_contract_path', 'contract', 'input', 'result'],
    'implement result');
  requireInput(input.version === 1 && input.stage === 'implement-result'
    && typeof input.root === 'string' && isAbsolute(input.root)
    && typeof input.accepted_contract_path === 'string' && isAbsolute(input.accepted_contract_path),
  'implement result: invalid stage/root/accepted contract path');
  try {
    assertIssueImplementInput(input.input);
    validatePreflight(input.contract);
    const accepted = JSON.parse(readFileSync(input.accepted_contract_path, 'utf8'));
    requireInput(isDeepStrictEqual(accepted, input.contract), 'implement result: stale accepted contract');
    const assignment = input.input;
    requireInput(accepted.issue === assignment.issue_number && accepted.sha256 === assignment.preflight_sha256,
      'implement result: issue/preflight binding mismatch');
    const root = realpathSync(input.root);
    const worktree = realpathSync(resolve(root, assignment.worktree));
    requireInput(relative(root, worktree) === assignment.worktree, 'implement result: wrong worktree realpath');
    requireInput(realpathSync(resolve(root, text(root, 'rev-parse', '--git-common-dir')))
      === realpathSync(resolve(worktree, text(worktree, 'rev-parse', '--git-common-dir'))),
    'implement result: wrong repository checkout');
    const branch = text(worktree, 'branch', '--show-current');
    const head = text(worktree, 'rev-parse', 'HEAD');
    requireInput(branch === assignment.branch, 'implement result: branch mismatch');
    git(worktree, 'merge-base', '--is-ancestor', assignment.starting_head_sha, head);
    const paths = (...args) => git(worktree, ...args).toString().split('\0').filter(Boolean);
    const changedFiles = paths('diff', '--name-only', '--no-renames', '-z', assignment.starting_head_sha, head);
    requireInput(changedFiles.every((path) => pathSafe(path)
      && accepted.scope.some((scope) => path === scope || (scope.endsWith('/') && path.startsWith(scope)))
      && !accepted.non_scope.some((scope) => path === scope || (scope.endsWith('/') && path.startsWith(scope)))),
    'implement result: committed diff outside approved scope');
    const changes = {
      staged: paths('diff', '--cached', '--name-only', '-z'),
      unstaged: paths('diff', '--name-only', '-z'),
      untracked: paths('ls-files', '--others', '--exclude-standard', '-z'),
    };
    const result = { present: input.result !== null, valid: false, error: null };
    if (result.present) {
      if (input.result && typeof input.result === 'object' && !Array.isArray(input.result)) {
        const bindings = { mode: assignment.mode, lane_id: assignment.lane_id,
          issue_number: assignment.issue_number, branch: assignment.branch, worktree: assignment.worktree,
          preflight_sha256: assignment.preflight_sha256, previous_head_sha: assignment.starting_head_sha,
          pr: assignment.existing_pr };
        requireInput(Object.entries(bindings).every(([key, value]) => !Object.hasOwn(input.result, key)
          || isDeepStrictEqual(input.result[key], value)), 'implement result: result identity binding mismatch');
      }
      try { assertIssueImplementResult(assignment, input.result); result.valid = true; }
      catch (error) {
        if (!(error instanceof TypeError)) throw error;
        result.error = error.message;
      }
    }
    if (result.valid) {
      requireInput(input.result.head_sha === head && input.result.commit_sha === head,
        'implement result: reported HEAD mismatch');
      requireInput(isDeepStrictEqual([...input.result.changed_files].sort(), [...changedFiles].sort()),
        'implement result: reported changed_files mismatch');
    }
    const processes = observeImplementProcesses(worktree);
    requireInput(text(worktree, 'rev-parse', 'HEAD') === head
      && text(worktree, 'branch', '--show-current') === branch
      && isDeepStrictEqual(changes, {
        staged: paths('diff', '--cached', '--name-only', '-z'),
        unstaged: paths('diff', '--name-only', '-z'),
        untracked: paths('ls-files', '--others', '--exclude-standard', '-z'),
      })
      && isDeepStrictEqual(JSON.parse(readFileSync(input.accepted_contract_path, 'utf8')), accepted),
    'implement result: observation changed during admission');
    const reasons = [];
    if (!result.present) reasons.push('missing-result');
    else if (!result.valid) reasons.push('invalid-result');
    if (processes.length) reasons.push('running-processes');
    if (head === assignment.starting_head_sha) reasons.push('unchanged-head');
    else if (changedFiles.length === 0) reasons.push('empty-diff');
    if (Object.values(changes).some((paths) => paths.length)) reasons.push('dirty-worktree');
    if (reasons.length) {
      return { version: 1, status: 'incomplete', kind: 'incomplete-run',
        lane_id: assignment.lane_id, issue_number: assignment.issue_number, mode: assignment.mode,
        preflight_sha256: assignment.preflight_sha256, worktree, starting_head_sha: assignment.starting_head_sha,
        current_head_sha: head, branch, changes, result, processes, reasons };
    }
    return { status: 'accepted', kind: 'implement-result', result: input.result };
  } catch (error) {
    if (error instanceof WorkflowPreparationError) throw error;
    throw new WorkflowPreparationError(`implement result: observation/binding failed: ${error.message}`);
  }
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

const authenticateFixBackReleaseMetadata = (input, baseHead, trees) => {
  const { previous_head_sha: previous, head_sha: head } = input.implementation;
  const readGit = (...args) => git(input.root, '--no-replace-objects', ...args);
  const { previousTree, tree } = trees;
  requireInput(readGit('rev-parse', `${previous}^{tree}`, `${head}^{tree}`).toString().trim()
    === `${previousTree}\n${tree}`, 'fix-back release metadata: rebound Git trees');
  readGit('merge-base', '--is-ancestor', previous, head);
  const delta = readGit('diff', '--raw', '--no-abbrev', '--no-renames', '--ignore-submodules=none',
    '-z', previous, head).toString();
  // Match @changesets/read's modern filename filter before checking the committed contents.
  const added = /^:000000 100(?:644|755) 0{40} ([a-f0-9]{40}) A\0(\.changeset\/(?!\.)[^/\0]+\.md)\0$/u.exec(delta);
  requireInput(added && pathSafe(added[2]) && !/^README\.md$/i.test(basename(added[2]))
    && input.changed_paths.includes(added[2])
    && readGit('--literal-pathspecs', 'ls-tree', '-z', previous, '--', added[2]).length === 0,
  'fix-back release metadata: expected exactly one new authored top-level regular Changeset addition');
  const [, blob, path] = added;
  const bytes = readGit('cat-file', 'blob', blob);

  const previousBase = readGit('merge-base', baseHead, previous).toString().trim();
  const authored = new Set(readGit('diff', '--name-only', '--no-renames', '-z', previousBase, previous)
    .toString().split('\0'));
  const owners = [...authored].filter((file) => /^packages\/[^/]+\/README\.md$/u.test(file)
    && pathSafe(file) && authored.has(`${dirname(file)}/README.ko.md`));
  requireInput(owners.length === 1, 'fix-back release metadata: expected one authored package-root README pair');
  const packageRoot = dirname(owners[0]);
  const readmes = [owners[0], `${packageRoot}/README.ko.md`];
  const manifestPath = `${packageRoot}/package.json`;
  const entries = readGit('--literal-pathspecs', 'ls-tree', '-z', previous, '--', ...readmes, manifestPath)
    .toString().split('\0').filter(Boolean);
  requireInput(entries.length === 3 && entries.every((entry) => /^100(?:644|755) blob [a-f0-9]{40}\t/u.test(entry)),
    'fix-back release metadata: README pair and public package manifest must be regular committed files');
  let owner;
  try {
    const manifest = JSON.parse(readGit('cat-file', 'blob', `${previous}:${manifestPath}`));
    requireInput(manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest)
      && typeof manifest.name === 'string' && /^@fluojs\/[a-z0-9][a-z0-9._-]*$/u.test(manifest.name)
      && (manifest.private === undefined || manifest.private === false),
    'fix-back release metadata: invalid public package manifest');
    [owner] = publicWorkspacePackageNames([{ manifest }]);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new WorkflowPreparationError(`fix-back release metadata: invalid public package manifest: ${error.message}`);
  }
  requireInput(owner, 'fix-back release metadata: README owner is not a public package');

  const contents = bytes.toString('utf8');
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(contents);
  const declarations = frontmatter?.[1].split(/\r?\n/u).map((line) => line.trim())
    .filter((line) => line.length && !line.startsWith('#'));
  const syntax = /^(["']?)(@fluojs\/[a-z0-9][a-z0-9._-]*)\1[ \t]*:[ \t]+(["']?)patch\3(?:[ \t]+#.*)?$/u;
  requireInput(Buffer.from(contents).equals(bytes) && !contents.includes('\0') && frontmatter?.[2].trim()
    && declarations?.length === 1 && syntax.exec(declarations[0])?.[2] === owner,
  'fix-back release metadata: expected one valid stable patch intent for the README owner');
  try {
    verifyChangesetReleaseLane({ lane: 'stable', changesetDirectory: '.changeset' }, {
      existsSync: () => true,
      readdirSync: () => [basename(path)],
      readFileSync: () => contents,
      readCliReadme: () => readGit('cat-file', 'blob', `${previous}:${readmes[0]}`).toString(),
      // The complete fix-back delta proves there are no version or engine changes in this projection.
      collectPackageVersionDeltas: () => [],
      collectStableNodeEngineRangeNarrowings: () => [],
    });
    // Resolve lazily through the CLI's dependency chain, even under isolated installs.
    const require = createRequire(import.meta.url);
    const cliRequire = createRequire(require.resolve('@changesets/cli'));
    const readRequire = createRequire(cliRequire.resolve('@changesets/read'));
    const { default: parseChangeset } = readRequire('@changesets/parse');
    requireInput(isDeepStrictEqual(parseChangeset(contents).releases, [{ name: owner, type: 'patch' }]),
      'fix-back release metadata: Changesets parser did not return exactly one patch intent for the README owner');
  } catch (error) {
    if (!(error instanceof Error) || error instanceof WorkflowPreparationError) throw error;
    throw new WorkflowPreparationError(`fix-back release metadata: invalid stable patch intent: ${error.message}`);
  }
  return { version: 1, kind: 'release-metadata', issue: input.issue, contract_sha256: input.contract.sha256,
    previous_head_sha: previous, previous_tree_sha: previousTree, head_sha: head, tree_sha: tree,
    previous_authored_merge_base_sha: previousBase,
    changeset: { path, blob_sha: blob, sha256: sha256(bytes), bytes: bytes.length },
    package: { name: owner, root: packageRoot }, intent: { lane: 'stable', bump: 'patch' } };
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
  const footprint = authenticatedFootprint(input.root, input.footprint);
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
  const hasRed = Object.hasOwn(input, 'fix_back_red');
  if (hasRed) {
    requireInput(input.implementation.mode === 'fix-back', 'RED receipt is only valid for fix-back');
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
  requireInput(footprint.issue === input.issue
    && footprint.issue_sha256 === input.issue_sha256 && footprint.base_sha === pinned,
  'review preparation: stale source footprint binding');
  requireInput(list(input.required_checks) && input.required_checks.length > 0
    && Array.isArray(input.evidence) && input.evidence.length === input.required_checks.length,
  'review preparation: missing required focused evidence inventory');
  const tree = text(checkout, 'rev-parse', 'HEAD^{tree}');
  const releaseMetadata = input.implementation.mode === 'fix-back' && !hasRed
    ? authenticateFixBackReleaseMetadata(input, baseHead, { previousTree, tree }) : undefined;
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
    ...(releaseMetadata === undefined ? {} : { fix_back_release_metadata: releaseMetadata }),
    ...(retention === undefined ? {} : { retention, fresh_axes: freshAxes }) };
  return { status: 'prepared', kind: 'review-input', common,
    reviewers: freshAxes.map((reviewer) => ({
      reviewer, dispatch: registeredDispatch(root, reviewerTargets[reviewer]), input: common,
    })) };
}

// Bounds apply to serialized UTF-8 files, including JSON escaping and wrappers.
export const reviewTransferLimits = Object.freeze({
  unit_bytes: 49999, unit_lines: 1500, prepared_bytes: 2 * 1024 * 1024,
  total_bytes: 8 * 1024 * 1024, chunk_bytes: 16000, max_units: 132,
});
const boundedReviewUnit = (bytes) => requireInput(bytes.length <= reviewTransferLimits.unit_bytes
  && bytes.toString('utf8').split('\n').length <= reviewTransferLimits.unit_lines,
'review transfer: unit exceeds byte/line limit');
const reviewBinding = (prepared) => ({
  issue: prepared.common.issue, head_sha: prepared.common.head_sha, tree_sha: prepared.common.tree_sha,
  contract_sha256: prepared.common.contract_sha256, policy_sha256: prepared.common.preflight_sha256,
  axes: prepared.reviewers.map(({ reviewer }) => reviewer),
});

/** Authenticate the complete transfer before returning any reconstructed input. */
function consumeReviewTransfer(root, transfer) {
  exact(transfer, ['version', 'manifest', 'prepared', 'binding'], 'review transfer');
  requireInput(transfer.version === 1, 'review transfer: unsupported version');
  exact(transfer.prepared, ['bytes', 'sha256'], 'review transfer prepared');
  requireInput(Number.isSafeInteger(transfer.prepared.bytes) && transfer.prepared.bytes > 0
    && transfer.prepared.bytes <= reviewTransferLimits.prepared_bytes && digest(transfer.prepared.sha256),
  'review transfer: prepared size/digest invalid');
  requireInput(transfer.manifest?.bytes <= reviewTransferLimits.unit_bytes,
    'review transfer: manifest exceeds byte limit');
  const manifestBytes = readPreparationArtifact(root, transfer.manifest, 'review transfer manifest');
  boundedReviewUnit(manifestBytes);
  let manifest;
  try { manifest = JSON.parse(manifestBytes); }
  catch (error) { throw new WorkflowPreparationError(`review transfer: unreadable manifest JSON: ${error.message}`); }
  exact(manifest, ['version', 'binding', 'prepared', 'limits', 'total_bytes', 'units'], 'review transfer manifest');
  requireInput(manifest.version === 1 && isDeepStrictEqual(manifest.binding, transfer.binding)
    && isDeepStrictEqual(manifest.prepared, transfer.prepared)
    && isDeepStrictEqual(manifest.limits, reviewTransferLimits),
  'review transfer: manifest binding mismatch');
  requireInput(Array.isArray(manifest.units) && manifest.units.length > 0
    && manifest.units.length <= reviewTransferLimits.max_units,
  'review transfer: incomplete unit inventory');
  requireInput(Number.isSafeInteger(manifest.total_bytes) && manifest.total_bytes > 0
    && manifest.total_bytes <= reviewTransferLimits.total_bytes,
  'review transfer: total exceeds limit');
  let offset = 0;
  let total = manifestBytes.length;
  const paths = new Set([transfer.manifest.path]);
  const units = manifest.units.map((entry, index) => {
    exact(entry, ['index', 'offset', 'content_bytes', 'lines', 'reference'], 'review transfer unit entry');
    requireInput(entry.index === index && entry.offset === offset
      && Number.isSafeInteger(entry.content_bytes) && entry.content_bytes > 0
      && entry.content_bytes <= reviewTransferLimits.chunk_bytes
      && entry.lines === 1 && entry.reference?.bytes <= reviewTransferLimits.unit_bytes
      && !paths.has(entry.reference?.path),
    'review transfer: duplicate, reordered or invalid unit');
    paths.add(entry.reference.path);
    const bytes = readPreparationArtifact(root, entry.reference, 'review transfer unit');
    boundedReviewUnit(bytes);
    requireInput(bytes.toString('utf8').split('\n').length === entry.lines,
      'review transfer: wrong unit line count');
    let unit;
    try { unit = JSON.parse(bytes); }
    catch (error) { throw new WorkflowPreparationError(`review transfer: unreadable unit JSON: ${error.message}`); }
    exact(unit, ['version', 'index', 'offset', 'text'], 'review transfer unit');
    requireInput(unit.version === 1 && unit.index === index && unit.offset === offset
      && typeof unit.text === 'string' && Buffer.byteLength(unit.text) === entry.content_bytes,
    'review transfer: unit length/position mismatch');
    offset += entry.content_bytes;
    total += bytes.length;
    requireInput(total <= reviewTransferLimits.total_bytes, 'review transfer: total exceeds limit');
    return unit;
  });
  requireInput(total === manifest.total_bytes && offset === transfer.prepared.bytes,
    'review transfer: incomplete total length');
  const bytes = Buffer.from(units.map(({ text }) => text).join(''));
  requireInput(sha256(bytes) === transfer.prepared.sha256, 'review transfer: prepared digest mismatch');
  let prepared;
  try { prepared = JSON.parse(bytes); }
  catch (error) { throw new WorkflowPreparationError(`review transfer: unreadable prepared JSON: ${error.message}`); }
  requireInput(prepared?.status === 'prepared' && prepared.kind === 'review-input'
    && Array.isArray(prepared.reviewers) && prepared.common
    && isDeepStrictEqual(reviewBinding(prepared), transfer.binding)
    && prepared.reviewers.every(({ reviewer, dispatch, input }) =>
      isDeepStrictEqual(input, prepared.common) && isDeepStrictEqual(dispatch, reviewerTargets[reviewer])),
  'review transfer: reconstructed binding mismatch');
  return { prepared, manifest, units };
}

export function readReviewTransfer(root, transfer) {
  try { return consumeReviewTransfer(root, transfer).prepared; }
  catch (error) {
    if (error instanceof WorkflowPreparationError) throw error;
    throw new WorkflowPreparationError(`review transfer: unreadable input: ${error.message}`);
  }
}

/** Keep small CLI results unchanged; retain large results as bounded authenticated files. */
export function prepareReviewTransfer(input) {
  const prepared = prepareReviewInput(input);
  const inline = Buffer.from(`${JSON.stringify(prepared, null, 2)}\n`);
  if (inline.length <= reviewTransferLimits.unit_bytes
    && inline.toString('utf8').split('\n').length <= reviewTransferLimits.unit_lines) return prepared;
  const serialized = JSON.stringify(prepared);
  const bytes = Buffer.from(serialized);
  requireInput(bytes.length <= reviewTransferLimits.prepared_bytes,
    'review transfer: prepared size exceeds total allowance');
  const binding = reviewBinding(prepared);
  const content = { bytes: bytes.length, sha256: sha256(bytes) };
  const directory = `review-transfer-${content.sha256}`;
  const store = (path, value) => {
    const data = Buffer.from(JSON.stringify(value));
    boundedReviewUnit(data);
    return { data, reference: { path: `${directory}/${path}`, bytes: data.length, sha256: sha256(data) } };
  };
  const files = [];
  let fragment = '';
  let size = 0;
  let offset = 0;
  const flush = () => {
    const index = files.length;
    const stored = store(`unit-${index}.json`, { version: 1, index, offset, text: fragment });
    files.push({ ...stored, entry: { index, offset, content_bytes: size, lines: 1, reference: stored.reference } });
    offset += size;
    fragment = '';
    size = 0;
  };
  for (const character of serialized) {
    const length = Buffer.byteLength(character);
    if (size + length > reviewTransferLimits.chunk_bytes) flush();
    fragment += character;
    size += length;
  }
  if (size) flush();
  requireInput(files.length <= reviewTransferLimits.max_units, 'review transfer: too many units');
  const manifest = { version: 1, binding, prepared: content, limits: reviewTransferLimits,
    total_bytes: 0, units: files.map(({ entry }) => entry) };
  const unitBytes = files.reduce((sum, { data }) => sum + data.length, 0);
  // Account for the decimal total's own serialized width.
  let manifestFile = store('manifest.json', manifest);
  while (manifest.total_bytes !== unitBytes + manifestFile.data.length) {
    manifest.total_bytes = unitBytes + manifestFile.data.length;
    manifestFile = store('manifest.json', manifest);
  }
  requireInput(manifest.total_bytes <= reviewTransferLimits.total_bytes, 'review transfer: total exceeds limit');
  const transfer = { version: 1, manifest: manifestFile.reference, prepared: content, binding };
  const result = { status: 'prepared', kind: 'review-transfer', artifact_root: input.artifact_root, transfer,
    reviewers: prepared.reviewers.map(({ reviewer, dispatch }) => ({ reviewer, dispatch, transfer })) };
  boundedReviewUnit(Buffer.from(`${JSON.stringify(result, null, 2)}\n`));
  try {
    mkdirSync(resolve(input.artifact_root, directory), { recursive: true });
    requireInput(realpathSync(resolve(input.artifact_root, directory))
      === resolve(realpathSync(input.artifact_root), directory), 'review transfer: directory escaped artifact root');
    for (const file of [...files, manifestFile]) {
      try { writeFileSync(resolve(input.artifact_root, file.reference.path), file.data, { flag: 'wx' }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        readPreparationArtifact(input.artifact_root, file.reference, 'retained review transfer');
      }
    }
  } catch (error) {
    throw new WorkflowPreparationError(`review transfer: cannot retain complete transfer: ${error.message}`);
  }
  readReviewTransfer(input.artifact_root, transfer);
  requireInput(text(input.checkout, 'rev-parse', 'HEAD') === input.head_sha
    && text(input.checkout, 'status', '--porcelain=v1') === ''
    && text(input.root, 'rev-parse', `${input.base_ref}^{commit}`) === prepared.common.base_head_sha
    && isDeepStrictEqual(JSON.parse(readFileSync(input.accepted_contract_path, 'utf8')), input.contract),
  'review transfer: observation changed during transfer');
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [stage, path] = process.argv.slice(2);
    requireInput(['preflight', 'finalize-preflight', 'implement', 'implement-result', 'review', 'review-read', 'fix-back-red'].includes(stage) && path && process.argv.length === 4,
      'Usage: node workflow-preparation.mjs <preflight|finalize-preflight|implement|implement-result|review|review-read|fix-back-red> <input.json>');
    const input = JSON.parse(readFileSync(path, 'utf8'));
    if (stage === 'preflight') {
      exact(input, ['version', 'stage', 'root', 'footprint'], 'preflight preparation');
      requireInput(input.version === 1 && input.stage === 'preflight' && isAbsolute(input.root),
        'preflight preparation: invalid stage/root');
      requireInput(Object.hasOwn(input.footprint ?? {}, 'caller_searches'), 'preflight preparation: caller_searches required');
    }
    let result;
    switch (stage) {
      case 'review': result = prepareReviewTransfer(input); break;
      case 'review-read': {
        exact(input, ['version', 'stage', 'artifact_root', 'transfer', 'index'], 'review transfer read');
        requireInput(input.version === 1 && input.stage === stage && typeof input.artifact_root === 'string'
          && isAbsolute(input.artifact_root), 'review transfer read: invalid version/stage/root');
        const { manifest, units } = consumeReviewTransfer(input.artifact_root, input.transfer);
        requireInput(input.index === null || (Number.isSafeInteger(input.index) && input.index >= 0
          && input.index < units.length), 'review transfer read: invalid unit index');
        result = input.index === null ? manifest : units[input.index];
        // The authenticated file's compact representation is the bounded reader output.
        const output = Buffer.from(JSON.stringify(result));
        boundedReviewUnit(output);
        process.stdout.write(output);
        break;
      }
      case 'finalize-preflight': result = finalizePreflight(input); break;
      case 'implement': result = prepareImplement(input); break;
      case 'implement-result': result = prepareImplementResult(input); break;
      case 'fix-back-red': result = captureFixBackRed(input); break;
      case 'preflight':
        result = { status: 'prepared', kind: 'preflight-input',
          dispatch: registeredDispatch(input.root, dispatchFor('preflight')),
          footprint: prepareSourceFootprint(input.root, input.footprint) };
        break;
    }
    if (stage === 'review-read') {
      // Output was already bounded above; pretty-printing can exceed its line bound.
    } else if (result.kind === 'incomplete-run') {
      process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = 2;
    } else {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'blocked', kind: 'input-preparation',
      fix_back_eligible: false, error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error instanceof DispatchPreparationError ? { subagent_type: error.subagent_type } : {}) })}\n`);
    process.exitCode = 1;
  }
}
