import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const reactPackageManifestPath = 'packages/react/package.json';
const stableRscSubpath = './rsc';
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
  'tooling/governance/react-rsc-discoverability.test.ts',
  'tooling/governance/react-rsc-graduation-policy.mjs',
];

function read(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

export function enforceReactRscGraduationEvidenceUpdates(changedFiles, readText = read) {
  if (!changedFiles.includes(reactPackageManifestPath)) {
    return;
  }

  const packageManifest = JSON.parse(readText(reactPackageManifestPath));
  if (stableRscExportKeys(packageManifest).length === 0) {
    return;
  }

  for (const requiredPath of requiredGraduationEvidencePaths) {
    assert(
      changedFiles.includes(requiredPath),
      `A stable React RSC export-map change must include ${requiredPath} graduation evidence.`,
    );
  }
  assert(
    changedFiles.some((relativePath) => relativePath.startsWith('.changeset/') && relativePath.endsWith('.md')),
    'A stable React RSC export-map change must include .changeset/*.md release evidence.',
  );
}

export function enforceReactRscGraduationPolicy(readText = read) {
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

  for (const relativePath of [
    'packages/react/README.md',
    'packages/react/README.ko.md',
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
    'docs/reference/package-surface.md',
    'docs/reference/package-surface.ko.md',
    'docs/reference/package-chooser.md',
    'docs/reference/package-chooser.ko.md',
  ]) {
    assert(
      readText(relativePath).includes('react-rsc-graduation'),
      `${relativePath} must link the React RSC graduation policy.`,
    );
  }
  for (const [relativePath, localizedTarget] of [
    ['docs/README.md', './contracts/react-rsc-graduation.md'],
    ['docs/README.ko.md', './contracts/react-rsc-graduation.ko.md'],
  ]) {
    assert(
      readText(relativePath).includes(localizedTarget),
      `${relativePath} must link the localized React RSC graduation policy target ${localizedTarget}.`,
    );
  }
}
