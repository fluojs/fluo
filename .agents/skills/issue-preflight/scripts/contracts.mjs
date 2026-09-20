import { createHash } from 'node:crypto';

export const REVIEW_AXES = ['contract', 'code', 'verification'];
const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const canonical = (v) => Array.isArray(v) ? v.map(canonical)
  : record(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
export const contractDigest = (v) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export const issueDigest = ({ title, body }) => contractDigest({ title, body });
const fail = (reason) => { throw new TypeError(`issue-preflight: ${reason}`); };
const strings = (v, nonempty = true) => Array.isArray(v) && (!nonempty || v.length > 0)
  && v.every((s) => typeof s === 'string' && s.trim().length > 0) && new Set(v).size === v.length;
const safePath = (p) => typeof p === 'string' && p.length > 0 && !p.startsWith('/')
  && !p.includes('\\') && !/[\x00-\x1f*?\[\]]/u.test(p)
  && p.replace(/\/$/u, '').split('/').every((part) => part && part !== '.' && part !== '..');
const covers = (pattern, file) => pattern.endsWith('/') ? file.startsWith(pattern) : pattern === file;
const inScope = (value, file) => value.scope.some((p) => covers(p, file))
  && !value.non_scope.some((p) => covers(p, file));

// Enforcement and agent instruction surfaces never inherit a docs/test exemption.
export const classifyReviewAxes = (files) => {
  if (!strings(files) || files.some((p) => !safePath(p) || p.endsWith('/'))) return [...REVIEW_AXES];
  if (files.some((p) => /^(?:\.agents\/|\.github\/|\.claude\/|\.cursor\/|\.changeset\/|tooling\/(?:governance|ci|release)\/)/u.test(p)
    || /(?:^|\/)(?:AGENTS|CLAUDE|SKILL|CONTEXT|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|copilot-instructions)(?:\.[^/]*)?\.md$/u.test(p)
    || /\.instructions\.md$/u.test(p)
    || /(?:^|[/-])governance(?:[/.\-]|$)/u.test(p))) return [...REVIEW_AXES];
  // MDX executes JS/JSX; executable docs/examples cannot use a prose exemption.
  if (files.some((p) => /\.mdx$/u.test(p) || /^(?:docs|book)\/(?:.*\/)?examples?\/.*\.(?:[cm]?[jt]sx?|vue|svelte|sh)$/u.test(p))) return [...REVIEW_AXES];
  const isTest = (p) => /\.(?:test|spec|test-fixture)\.[cm]?[jt]sx?$/u.test(p)
    || /(?:^|\/)(?:__tests__|__fixtures__|tests?|fixtures|test-fixtures|test-types)\//u.test(p);
  if (files.every(isTest)) return ['code', 'verification'];
  if (files.every((p) => !isTest(p) && (/\.(?:md|rst)$/u.test(p)
    || /^(?:docs|book)\/.*\.txt$/u.test(p)
    || /(?:^|\/)(?:README|LICENSE|LICENCE)$/u.test(p)))) return ['contract'];
  return [...REVIEW_AXES];
};

const omissionsFor = (axes) => Object.fromEntries(REVIEW_AXES.filter((a) => !axes.includes(a))
  .map((a) => [a, 'No changed files in this review scope.']));

export const createPreflight = (input) => {
  const active_axes = input.active_axes ?? classifyReviewAxes(input.predicted_files);
  const value = { ...input, version: 1, active_axes, omitted_axes: input.omitted_axes ?? omissionsFor(active_axes) };
  delete value.sha256;
  value.sha256 = contractDigest(value);
  validatePreflight(value);
  return value;
};

export const validatePreflight = (value) => {
  const keys = ['version', 'issue', 'issue_sha256', 'base_sha', 'scope', 'non_scope', 'acceptance', 'validation', 'predicted_files', 'active_axes', 'omitted_axes', 'sha256'];
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some((k) => !Object.hasOwn(value, k))) fail('non-canonical contract');
  if (value.version !== 1 || !Number.isSafeInteger(value.issue) || value.issue < 1
    || typeof value.issue_sha256 !== 'string' || !DIGEST.test(value.issue_sha256)
    || typeof value.base_sha !== 'string' || !SHA.test(value.base_sha)) fail('invalid issue/base binding');
  if (!strings(value.scope) || !strings(value.non_scope, false)
    || [...value.scope, ...value.non_scope].some((p) => !safePath(p))) fail('scope and non_scope require repository paths (trailing / means prefix)');
  if (!strings(value.acceptance) || !strings(value.validation)) fail('acceptance and validation must be nonempty');
  if (!strings(value.predicted_files) || value.predicted_files.some((p) => !safePath(p) || p.endsWith('/') || !inScope(value, p))) fail('predicted_files must be files inside approved scope');
  const axes = value.active_axes;
  if (!strings(axes) || axes.some((a) => !REVIEW_AXES.includes(a))
    || classifyReviewAxes(value.predicted_files).some((a) => !axes.includes(a))) fail('active_axes cannot omit a required axis');
  const omitted = REVIEW_AXES.filter((a) => !axes.includes(a));
  if (!record(value.omitted_axes) || Object.keys(value.omitted_axes).length !== omitted.length
    || omitted.some((a) => typeof value.omitted_axes[a] !== 'string' || !value.omitted_axes[a].trim())) fail('every omitted axis requires a reason');
  const { sha256, ...contract } = value;
  if (!DIGEST.test(sha256) || sha256 !== contractDigest(contract)) fail('contract digest mismatch');
  return value;
};

// Head-independent contract, head-derived policy. Expansion never shrinks the
// approved axes; even an otherwise docs-only final diff retains approved axes.
export const evaluatePreflight = (value, obs) => {
  try { validatePreflight(value); } catch (error) { return { valid: false, reason: 'invalid-preflight', detail: error.message }; }
  if (value.issue !== obs.issue || value.issue_sha256 !== obs.issueSha256 || value.base_sha !== obs.baseSha) {
    return { valid: false, reason: 'stale-preflight-binding' };
  }
  if (!Array.isArray(obs.changedFiles) || obs.changedFiles.some((p) => !safePath(p) || p.endsWith('/'))) {
    return { valid: false, reason: 'diff-unavailable' };
  }
  const outside = obs.changedFiles.filter((p) => !inScope(value, p));
  if (outside.length) return { valid: false, reason: 'scope-expansion', files: outside };
  const required = obs.changedFiles.length ? classifyReviewAxes(obs.changedFiles) : [];
  // Accepted reviewer composition remains a floor across subsequent heads.
  // A child removing files cannot undo a lead-accepted policy expansion.
  const floor = Array.isArray(obs.reviewAxisFloor) ? obs.reviewAxisFloor : [];
  const active_axes = REVIEW_AXES.filter((a) => value.active_axes.includes(a) || required.includes(a) || floor.includes(a));
  const omitted_axes = Object.fromEntries(Object.entries(value.omitted_axes).filter(([a]) => !active_axes.includes(a)));
  const policy = { contract_sha256: value.sha256, active_axes, omitted_axes };
  return { valid: true, policy: { ...policy, sha256: contractDigest(policy) } };
};
