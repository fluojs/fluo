import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enforceReactRscExecutableEvidence } from './react-rsc-executable-evidence.mjs';
import {
  enforceReactRscAggregateMinorChangeset,
  enforceReactRscApprovalProvenance,
  enforceReactRscPolicyInvariants,
  enforceReactRscPolicyStatus,
  readReactRscGraduationRecord,
  repositoryGitProbe,
} from './react-rsc-graduation-metadata.mjs';
import {
  enforceReactPackageRootIsolation,
} from './react-rsc-graduation-source-analysis.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const reactPackageManifestPath = 'packages/react/package.json';
const stableRscSubpath = './rsc';
const stableRscEntrypointPath = 'packages/react/src/rsc.ts';
const experimentalRscEntrypointPath = 'packages/react/src/experimental/rsc.ts';
const approvalRecordPath = 'tooling/governance/react-rsc-graduation-approval.json';
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
  'tooling/governance/react-rsc-graduation-hardening.test.ts',
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

function enforceLiteralStableRscExport(packageManifest) {
  const packageExports = packageManifest?.exports;
  const hasLiteralStableExport = Object.hasOwn(packageExports ?? {}, stableRscSubpath);
  const stableRscExport = hasLiteralStableExport ? packageExports[stableRscSubpath] : undefined;
  const targetKeys = stableRscExport && typeof stableRscExport === 'object' ? Object.keys(stableRscExport).sort() : [];
  assert(
    hasLiteralStableExport &&
      targetKeys.join(',') === 'import,types' &&
      stableRscExport.types === './dist/rsc.d.ts' &&
      stableRscExport.import === './dist/rsc.js',
    'Approved React RSC graduation requires a literal ./rsc export with exact types and import targets.',
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

export function enforceReactRscGraduationEvidenceUpdates(
  changedFiles,
  readText = read,
  gitProbe = repositoryGitProbe,
) {
  if (!changedFiles.includes(reactPackageManifestPath)) {
    return;
  }

  const packageManifest = JSON.parse(readText(reactPackageManifestPath));
  if (stableRscExportKeys(packageManifest).length === 0) {
    return;
  }

  const approvalRecord = readReactRscGraduationRecord(readText);
  assert(approvalRecord.status === 'approved', 'The React RSC graduation approval record must be approved.');
  enforceReactRscPolicyStatus('approved', readText);
  enforceReactRscPolicyInvariants(readText);
  enforceReactRscApprovalProvenance(approvalRecord, { changedFiles, gitProbe, readText });
  enforceLiteralStableRscExport(packageManifest);
  enforceReactPackageRootIsolation(packageManifest, readText);

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
  enforceReactRscAggregateMinorChangeset(changedFiles, readText);
  enforceGovernedPolicyLinks(readText);
}

export function enforceReactRscGraduationPolicy(readText = read) {
  const approvalRecord = readReactRscGraduationRecord(readText);
  assert(approvalRecord.status === 'blocked', 'The React RSC graduation approval record must remain blocked.');
  enforceReactRscPolicyStatus('blocked', readText);
  enforceReactRscPolicyInvariants(readText);

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
  enforceReactPackageRootIsolation(packageManifest, readText);

  enforceGovernedPolicyLinks(readText);
}

export function enforceReactRscGraduationGovernance(
  changedFiles,
  readText = read,
  gitProbe = repositoryGitProbe,
) {
  const approvalRecord = readReactRscGraduationRecord(readText);

  if (approvalRecord.status === 'approved') {
    assert(
      changedFiles.includes(reactPackageManifestPath),
      `An approved React RSC graduation must include ${reactPackageManifestPath}.`,
    );
    const packageManifest = JSON.parse(readText(reactPackageManifestPath));
    enforceLiteralStableRscExport(packageManifest);
    enforceReactRscGraduationEvidenceUpdates(changedFiles, readText, gitProbe);
    return;
  }

  enforceReactRscGraduationPolicy(readText);
}
