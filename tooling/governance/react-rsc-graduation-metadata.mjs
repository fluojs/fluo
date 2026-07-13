import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const approvalRecordPath = 'tooling/governance/react-rsc-graduation-approval.json';
const authorityMetadataPath = '.github/CODEOWNERS';
const policyContracts = [
  {
    headings: [
      '## Graduation Checklist',
      '### React and Renderer Stability',
      '### Manifest and Server Function Transport',
      '### Rendering, Hydration, and Data Safety',
      '### Routing and Navigation Ownership',
      '### Tests and Runtime Evidence',
      '### Documentation and Release Evidence',
      '## Stable Subpath Activation',
      '## Deprecation Window and Migration',
      '## Semver and Roadmap Labels',
      '## Known Limitations That Remain Stable',
    ],
    path: 'docs/contracts/react-rsc-graduation.md',
  },
  {
    headings: [
      '## Graduation Checklist',
      '### React 및 Renderer Stability',
      '### Manifest 및 Server Function Transport',
      '### Rendering, Hydration 및 Data Safety',
      '### Routing 및 Navigation Ownership',
      '### Test 및 Runtime Evidence',
      '### Documentation 및 Release Evidence',
      '## Stable Subpath 활성화',
      '## Deprecation Window 및 Migration',
      '## Semver 및 Roadmap Label',
      '## 안정적으로 유지할 Known Limitation',
    ],
    path: 'docs/contracts/react-rsc-graduation.ko.md',
  },
];
const policyInvariantTerms = [
  '@fluojs/react/rsc',
  '@fluojs/react/experimental/rsc',
  'react@19.2.6',
  'manifest',
  'Server Function',
  'SSR',
  'CSR',
  'prerendering',
  'hydration mismatch',
  'safe transfer',
  'browser/server',
  '#2506',
  'deprecation window',
  'Changesets',
  'roadmap phase',
  'no stable root RSC export',
  '.github/CODEOWNERS',
  'ancestor of HEAD',
  'observable runtime result',
  './dist/index.js',
  'minor',
  'major',
];
const bumpRank = { major: 2, minor: 1, patch: 0 };

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function gitSucceeds(args) {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).status === 0;
}

export const repositoryGitProbe = {
  commitExists(commit) {
    return gitSucceeds(['cat-file', '-e', `${commit}^{commit}`]);
  },
  isAncestorOfHead(commit) {
    return gitSucceeds(['merge-base', '--is-ancestor', commit, 'HEAD']);
  },
};

function codeOwnerLogins(source) {
  const owners = new Set();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const [pattern, ...lineOwners] = line.split(/\s+/u);
    if (pattern !== '*') {
      continue;
    }
    for (const owner of lineOwners) {
      if (/^@[A-Za-z0-9-]+$/u.test(owner)) {
        owners.add(owner.slice(1));
      }
    }
  }
  return owners;
}

export function readReactRscGraduationRecord(readText) {
  const record = JSON.parse(readText(approvalRecordPath));
  assert(record?.schemaVersion === 1, `${approvalRecordPath} must use schemaVersion 1.`);
  assert(record.issue === 2502, `${approvalRecordPath} must govern issue #2502.`);
  assert(record.status === 'blocked' || record.status === 'approved', `${approvalRecordPath} has an invalid status.`);
  if (record.status === 'blocked') {
    assert(record.approval === null, `${approvalRecordPath} must keep approval null while blocked.`);
    return record;
  }
  assert(record.approval && typeof record.approval === 'object', `${approvalRecordPath} must include approval.`);
  assert(
    typeof record.approval.maintainer === 'string' && record.approval.maintainer.length > 0,
    `${approvalRecordPath} approval must name a maintainer login.`,
  );
  assert(
    typeof record.approval.evidenceCommit === 'string' && /^[0-9a-f]{40}$/u.test(record.approval.evidenceCommit),
    `${approvalRecordPath} approval must pin a 40-character evidence commit SHA.`,
  );
  return record;
}

export function enforceReactRscApprovalProvenance(record, context) {
  if (record.status !== 'approved') {
    return;
  }
  const { changedFiles, gitProbe, readText } = context;
  assert(
    !changedFiles.includes(authorityMetadataPath),
    `${authorityMetadataPath} must remain pre-existing authority outside the graduation change set.`,
  );
  const maintainers = codeOwnerLogins(readText(authorityMetadataPath));
  assert(
    maintainers.has(record.approval.maintainer),
    `${approvalRecordPath} approval must name a trusted maintainer authorized by ${authorityMetadataPath}.`,
  );
  assert(
    gitProbe.commitExists(record.approval.evidenceCommit),
    `React RSC approval evidence commit ${record.approval.evidenceCommit} does not exist.`,
  );
  assert(
    gitProbe.isAncestorOfHead(record.approval.evidenceCommit),
    `React RSC approval evidence commit ${record.approval.evidenceCommit} must be an ancestor of HEAD.`,
  );
}

function policyStatus(policy, policyPath) {
  const statuses = [
    ['blocked', 'Status: Policy defined; graduation blocked.'],
    ['approved', 'Status: Graduation approved.'],
  ].filter(([, marker]) => policy.includes(marker));
  assert(statuses.length === 1, `${policyPath} must declare exactly one React RSC graduation status.`);
  return statuses[0][0];
}

export function enforceReactRscPolicyStatus(status, readText) {
  for (const { path } of policyContracts) {
    assert(
      policyStatus(readText(path), path) === status,
      `${path} status must match the repository-owned React RSC approval record.`,
    );
  }
}

export function enforceReactRscPolicyInvariants(readText) {
  for (const { headings, path } of policyContracts) {
    const policy = readText(path);
    for (const heading of headings) {
      assert(policy.includes(heading), `${path} must preserve ${heading}.`);
    }
    for (const term of policyInvariantTerms) {
      assert(policy.includes(term), `${path} must preserve React RSC policy invariant ${term}.`);
    }
  }
}

function parseChangesetIntents(contents, changesetPath) {
  const normalized = contents.replace(/^\uFEFF/u, '');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(normalized);
  assert(frontmatter, `${changesetPath} must contain Changesets YAML frontmatter.`);
  const intents = [];
  for (const rawLine of frontmatter[1].split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const intent = /^['"]?([^'"]+)['"]?\s*:\s*['"]?(patch|minor|major)['"]?\s*(?:#.*)?$/u.exec(line);
    assert(intent, `${changesetPath} has unsupported frontmatter line: ${rawLine}`);
    intents.push({ bump: intent[2], packageName: intent[1].trim() });
  }
  assert(intents.length > 0, `${changesetPath} must declare at least one package bump intent.`);
  return intents;
}

export function enforceReactRscAggregateMinorChangeset(changedFiles, readText) {
  const changesetPaths = changedFiles.filter(
    (relativePath) =>
      relativePath.startsWith('.changeset/') && relativePath.endsWith('.md') && relativePath !== '.changeset/README.md',
  );
  const reactIntents = changesetPaths
    .flatMap((changesetPath) => parseChangesetIntents(readText(changesetPath), changesetPath))
    .filter((intent) => intent.packageName === '@fluojs/react');
  assert(
    reactIntents.length > 0,
    'Stable React RSC graduation must include an @fluojs/react changeset whose aggregate bump is exactly minor.',
  );
  const effectiveBump = reactIntents.reduce(
    (highest, intent) => (bumpRank[intent.bump] > bumpRank[highest] ? intent.bump : highest),
    'patch',
  );
  assert(
    effectiveBump === 'minor',
    `The aggregate @fluojs/react Changesets bump must be exactly minor; received ${effectiveBump}.`,
  );
}
