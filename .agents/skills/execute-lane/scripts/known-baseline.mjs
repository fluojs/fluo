import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireValue = (condition, message) => {
  if (!condition) throw new TypeError(`known-baseline: ${message}`);
};
const exact = (value, keys) => {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)),
  `expected keys ${keys.join(',')}`);
};
const text = (value) => typeof value === 'string' && value.trim().length > 0 && value === value.trim();
const sha = (value, size) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${size}}$`, 'u').test(value);
const pathIsRelative = (path) => text(path) && !isAbsolute(path)
  && !path.includes('\\') && path.split('/').every(part => part !== '..' && part !== '.' && part !== '');
const reference = (value) => {
  exact(value, ['path', 'sha256']);
  requireValue(pathIsRelative(value.path) && sha(value.sha256, 64), 'invalid path/digest reference');
};
const git = (root, args) => execFileSync('git', args, {
  cwd: root, timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
});
const sourceDigest = (root, head, path) => digest(git(root, ['show', `${head}:${path}`]));
const artifact = (root, ref) => {
  reference(ref);
  const path = realpathSync(resolve(root, ref.path));
  const within = relative(realpathSync(root), path);
  requireValue(!isAbsolute(within) && !within.startsWith('../'), 'artifact escapes root');
  const bytes = readFileSync(path);
  requireValue(bytes.length > 0 && digest(bytes) === ref.sha256, `artifact digest mismatch: ${ref.path}`);
  return bytes;
};
const snapshots = (root, head, values) => {
  requireValue(Array.isArray(values) && values.length > 0, 'missing source/conditions');
  requireValue(new Set(values.map(item => item.path)).size === values.length, 'duplicate source/conditions');
  for (const ref of values) {
    reference(ref);
    requireValue(sourceDigest(root, head, ref.path) === ref.sha256, `source digest mismatch: ${head}:${ref.path}`);
  }
};
const same = (left, right) => left.length === right.length && left.every(ref =>
  right.some(other => other.path === ref.path && other.sha256 === ref.sha256));

const validateCheck = (root, check, status) => {
  exact(check, ['head', 'command', 'sources', 'conditions', 'test_source', 'log', 'receipt']);
  requireValue(sha(check.head, 40) && text(check.command), 'invalid check identity');
  requireValue(git(root, ['rev-parse', '--verify', `${check.head}^{commit}`]).toString().trim() === check.head,
    'head must name an exact commit');
  snapshots(root, check.head, check.sources);
  snapshots(root, check.head, check.conditions);
  snapshots(root, check.head, [check.test_source]);
  artifact(root, check.log);
  const receipt = JSON.parse(artifact(root, check.receipt));
  exact(receipt, ['version', 'head', 'command', 'completed', 'signal', 'status', 'exit_code', 'log_sha256', 'source_sha256']);
  requireValue(receipt.version === 1 && receipt.head === check.head && receipt.command === check.command
    && receipt.completed === true && receipt.signal === null && receipt.status === status
    && Number.isSafeInteger(receipt.exit_code)
    && (status === 'failed' ? receipt.exit_code > 0 : receipt.exit_code === 0)
    && receipt.log_sha256 === check.log.sha256
    && receipt.source_sha256 === digest(JSON.stringify({
      sources: check.sources, conditions: check.conditions, test_source: check.test_source,
    })), 'completed check/source/log binding mismatch');
};

/** Authenticate lead-admitted evidence without executing tests or integrating code. */
export const validateKnownBaseline = (root, record, members) => {
  exact(record, ['version', 'id', 'issues', 'failure', 'companion', 'adjudication']);
  requireValue(record.version === 1 && text(record.id), 'invalid record identity');
  requireValue(Array.isArray(record.issues) && record.issues.length > 0
    && new Set(record.issues).size === record.issues.length
    && record.issues.every(issue => Number.isSafeInteger(issue) && issue > 0 && members.includes(issue)),
  'related issues must be confirmed lane members');
  const adjudication = record.adjudication;
  exact(adjudication, ['authority', 'cause', 'failure_head', 'companion_head', 'reason']);
  requireValue(adjudication.authority === 'lead' && adjudication.cause === 'confirmed-common-baseline'
    && text(adjudication.reason) && adjudication.failure_head === record.failure?.head
    && adjudication.companion_head === record.companion?.head, 'missing confirmed lead adjudication');
  validateCheck(root, record.failure, 'failed');
  validateCheck(root, record.companion, 'passed');
  requireValue(record.failure.command === record.companion.command
    && record.failure.head !== record.companion.head
    && same(record.failure.conditions, record.companion.conditions)
    && same([record.failure.test_source], [record.companion.test_source])
    && record.failure.sources.length === record.companion.sources.length
    && record.failure.sources.every(ref => record.companion.sources.some(other => other.path === ref.path))
    && !same(record.failure.sources, record.companion.sources), 'companion check/source/conditions mismatch');
  requireValue(![...record.failure.conditions, record.failure.test_source]
    .some(ref => record.failure.sources.some(source => source.path === ref.path)),
  'source and immutable condition/test paths must be disjoint');
  return structuredClone(record);
};

/** Compare committed bytes at the fresh issue head; missing admitted proof fails closed. */
export const observeKnownBaseline = (root, record, { issue, head, members }) => {
  const result = { id: record?.id ?? null, head, companionHead: record?.companion?.head ?? null };
  try {
    validateKnownBaseline(root, record, members);
    requireValue(record.issues.includes(issue), 'record does not apply to issue');
    requireValue(sha(head, 40), 'missing issue head');
    const current = (refs) => refs.map(ref => ({ path: ref.path, sha256: sourceDigest(root, head, ref.path) }));
    const sources = current(record.failure.sources);
    const conditions = current(record.failure.conditions);
    const testSource = current([record.failure.test_source]);
    const evidence = { sources, conditions, test_source: testSource[0],
      failureHead: record.failure.head, companionHead: record.companion.head };
    if (!same(conditions, record.failure.conditions) || !same(testSource, [record.failure.test_source])) {
      return { ...result, status: 'different-source-or-conditions', evidence };
    }
    const status = same(sources, record.failure.sources) ? 'still-failing'
      : same(sources, record.companion.sources) ? 'fixed' : 'different-source-or-conditions';
    return { ...result, status, evidence };
  } catch (error) {
    return { ...result, status: 'insufficient-evidence', evidence: error.message };
  }
};
