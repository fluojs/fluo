import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enforceReactRscExecutableEvidence } from './react-rsc-executable-evidence.mjs';
import {
  enforceReactRscStableSurfaceIsolation,
} from './react-rsc-graduation-source-analysis.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const reactPackageManifestPath = 'packages/react/package.json';
const stableRscSubpath = './rsc';
const stableRscEntrypointPath = 'packages/react/src/rsc.ts';
const experimentalRscEntrypointPath = 'packages/react/src/experimental/rsc.ts';
const approvalRecordPath = 'tooling/governance/react-rsc-graduation-approval.json';
const trustedMaintainers = new Set(['ayden94']);
const requiredGraduationEvidencePaths = [
  'docs/contracts/react-rsc-graduation.md',
  'docs/contracts/react-rsc-graduation.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
  'docs/README.md',
  'docs/README.ko.md',
  'docs/reference/package-chooser.md',
  'docs/reference/package-chooser.ko.md',
  'docs/reference/package-surface.md',
  'docs/reference/package-surface.ko.md',
  'packages/react/README.md',
  'packages/react/README.ko.md',
  stableRscEntrypointPath,
  experimentalRscEntrypointPath,
  'packages/react/src/rsc-dual-import.test.ts',
  'packages/react/src/rsc-dual-import.types.test.ts',
  'packages/react/src/rsc-hydration.test.ts',
  'packages/react/src/rsc-data-safety.test.ts',
  'packages/react/src/rsc-runtime-bundler-matrix.test.ts',
  'tooling/governance/react-rsc-discoverability.test.ts',
  'tooling/governance/react-rsc-graduation-evidence.test.ts',
  'tooling/governance/react-rsc-graduation-policy.mjs',
  approvalRecordPath,
];
const governedPolicyLinks = [
  ['packages/react/README.md', '../../docs/contracts/react-rsc-graduation.md'],
  ['packages/react/README.ko.md', '../../docs/contracts/react-rsc-graduation.ko.md'],
  ['docs/CONTEXT.md', './contracts/react-rsc-graduation.md'],
  ['docs/CONTEXT.ko.md', './contracts/react-rsc-graduation.ko.md'],
  ['docs/reference/package-surface.md', '../contracts/react-rsc-graduation.md'],
  ['docs/reference/package-surface.ko.md', '../contracts/react-rsc-graduation.ko.md'],
  ['docs/reference/package-chooser.md', '../contracts/react-rsc-graduation.md'],
  ['docs/reference/package-chooser.ko.md', '../contracts/react-rsc-graduation.ko.md'],
  ['docs/README.md', './contracts/react-rsc-graduation.md'],
  ['docs/README.ko.md', './contracts/react-rsc-graduation.ko.md'],
];

function read(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function markdownLinkTargets(markdown) {
  const targets = [];
  const inlineLinkPattern =
    /\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)]*\)))?\s*\)/gu;

  for (const match of markdown.matchAll(inlineLinkPattern)) {
    if (match.index > 0 && markdown[match.index - 1] === '!') {
      continue;
    }
    targets.push(match[1] ?? match[2]);
  }

  return targets;
}

function exportKeyCanResolveSubpath(exportKey, subpath) {
  const segments = exportKey.split('*');

  if (segments.length === 1) {
    return exportKey === subpath;
  }

  const prefix = segments[0];
  if (!subpath.startsWith(prefix)) {
    return false;
  }

  let cursor = prefix.length;
  for (const segment of segments.slice(1, -1)) {
    const segmentIndex = subpath.indexOf(segment, cursor);
    if (segmentIndex === -1) {
      return false;
    }
    cursor = segmentIndex + segment.length;
  }

  return subpath.slice(cursor).endsWith(segments.at(-1));
}

function stableRscExportKeys(packageManifest) {
  const packageExports = packageManifest?.exports;
  if (packageExports === null || typeof packageExports !== 'object' || Array.isArray(packageExports)) {
    return [];
  }

  return Object.keys(packageExports).filter((exportKey) => exportKeyCanResolveSubpath(exportKey, stableRscSubpath));
}

function readApprovalRecord(readText) {
  const record = JSON.parse(readText(approvalRecordPath));
  assert(record?.schemaVersion === 1, `${approvalRecordPath} must use schemaVersion 1.`);
  assert(record.issue === 2502, `${approvalRecordPath} must govern issue #2502.`);
  assert(record.status === 'blocked' || record.status === 'approved', `${approvalRecordPath} has an invalid status.`);

  if (record.status === 'blocked') {
    assert(record.approval === null, `${approvalRecordPath} must keep approval null while blocked.`);
    return record;
  }

  assert(record.approval && typeof record.approval === 'object', `${approvalRecordPath} must include approval.`);
  assert(trustedMaintainers.has(record.approval.maintainer), `${approvalRecordPath} approval must name a trusted maintainer.`);
  assert(
    /^[0-9a-f]{40}$/u.test(record.approval.evidenceCommit) && !/^0{40}$/u.test(record.approval.evidenceCommit),
    `${approvalRecordPath} approval must pin a nonzero evidence commit SHA.`,
  );
  return record;
}

function policyStatus(policy, policyPath) {
  const statuses = [
    ['blocked', 'Status: Policy defined; graduation blocked.'],
    ['approved', 'Status: Graduation approved.'],
  ].filter(([, marker]) => policy.includes(marker));
  assert(statuses.length === 1, `${policyPath} must declare exactly one React RSC graduation status.`);
  return statuses[0][0];
}

function enforcePolicyStatusMatches(status, readText) {
  for (const policyPath of ['docs/contracts/react-rsc-graduation.md', 'docs/contracts/react-rsc-graduation.ko.md']) {
    assert(
      policyStatus(readText(policyPath), policyPath) === status,
      `${policyPath} status must match the repository-owned React RSC approval record.`,
    );
  }
}

function enforceReactMinorChangeset(changedFiles, readText) {
  const changesetPaths = changedFiles.filter(
    (relativePath) => relativePath.startsWith('.changeset/') && relativePath.endsWith('.md'),
  );
  const intents = changesetPaths.flatMap((changesetPath) => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(readText(changesetPath));
    assert(match, `${changesetPath} must contain Changesets YAML frontmatter.`);
    return match[1]
      .split(/\r?\n/u)
      .map((line) => /^['"]?([^'"]+)['"]?\s*:\s*['"]?(patch|minor|major)['"]?\s*$/u.exec(line.trim()))
      .filter((intent) => intent !== null)
      .map((intent) => ({ bump: intent[2], packageName: intent[1].trim() }));
  });
  assert(
    intents.some((intent) => intent.packageName === '@fluojs/react' && intent.bump === 'minor'),
    'Stable React RSC graduation must include a changed @fluojs/react: minor changeset.',
  );
}

function enforceGovernedPolicyLinks(readText) {
  for (const [relativePath, localizedTarget] of governedPolicyLinks) {
    assert(
      markdownLinkTargets(readText(relativePath)).includes(localizedTarget),
      `${relativePath} must contain a Markdown link to localized React RSC graduation policy target ${localizedTarget}.`,
    );
  }
}

export function enforceReactRscGraduationEvidenceUpdates(changedFiles, readText = read) {
  if (!changedFiles.includes(reactPackageManifestPath)) {
    return;
  }

  const packageManifest = JSON.parse(readText(reactPackageManifestPath));
  if (stableRscExportKeys(packageManifest).length === 0) {
    return;
  }

  const approvalRecord = readApprovalRecord(readText);
  assert(approvalRecord.status === 'approved', 'The React RSC graduation approval record must be approved.');
  enforcePolicyStatusMatches('approved', readText);
  enforceReactRscStableSurfaceIsolation(readText);

  const stableRscExport = packageManifest.exports?.[stableRscSubpath];
  assert(
    stableRscExport?.types === './dist/rsc.d.ts' && stableRscExport?.import === './dist/rsc.js',
    'Stable React RSC graduation must expose ./rsc with ./dist/rsc.d.ts and ./dist/rsc.js targets.',
  );

  for (const requiredPath of requiredGraduationEvidencePaths) {
    assert(
      changedFiles.includes(requiredPath),
      `A stable React RSC export-map change must include ${requiredPath} graduation evidence.`,
    );
  }
  assert(
    /\bexport\s/u.test(readText(stableRscEntrypointPath)),
    'The stable RSC entrypoint must contain an implementation export.',
  );
  assert(
    /export\s+(?:\*|\{[^}]*\})\s+from\s+['"]\.\.\/rsc\.js['"]/u.test(readText(experimentalRscEntrypointPath)),
    'The experimental RSC entrypoint must directly re-export the stable entrypoint during the deprecation window.',
  );
  enforceReactRscExecutableEvidence(readText);
  enforceReactMinorChangeset(changedFiles, readText);
  enforceGovernedPolicyLinks(readText);
}

export function enforceReactRscGraduationPolicy(readText = read) {
  const approvalRecord = readApprovalRecord(readText);
  assert(approvalRecord.status === 'blocked', 'The React RSC graduation approval record must remain blocked.');
  enforcePolicyStatusMatches('blocked', readText);
  enforceReactRscStableSurfaceIsolation(readText);
  const policies = [
    readText('docs/contracts/react-rsc-graduation.md'),
    readText('docs/contracts/react-rsc-graduation.ko.md'),
  ];
  const requiredTerms = [
    'Status: Policy defined; graduation blocked',
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
  ];

  for (const policy of policies) {
    for (const term of requiredTerms) {
      assert(policy.includes(term), `React RSC graduation policy mirrors must document ${term}.`);
    }
  }

  const packageManifest = JSON.parse(readText(reactPackageManifestPath));
  assert(
    packageManifest.exports?.['./experimental/rsc']?.import === './dist/experimental/rsc.js',
    'The experimental RSC export must remain available while graduation is blocked.',
  );
  const matchingStableRscExportKeys = stableRscExportKeys(packageManifest);
  assert(
    matchingStableRscExportKeys.length === 0,
    `React package export-map key ${JSON.stringify(matchingStableRscExportKeys[0])} can resolve stable @fluojs/react/rsc while graduation is blocked.`,
  );

  enforceGovernedPolicyLinks(readText);
}

export function enforceReactRscGraduationGovernance(changedFiles, readText = read) {
  const approvalRecord = readApprovalRecord(readText);
  enforcePolicyStatusMatches(approvalRecord.status, readText);

  if (approvalRecord.status === 'approved') {
    assert(
      changedFiles.includes(reactPackageManifestPath),
      `An approved React RSC graduation must include ${reactPackageManifestPath}.`,
    );
    enforceReactRscGraduationEvidenceUpdates(changedFiles, readText);
    return;
  }

  enforceReactRscGraduationPolicy(readText);
}
