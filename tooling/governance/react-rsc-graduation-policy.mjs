import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function enforceReactRscGraduationPolicy() {
  const policies = [read('docs/contracts/react-rsc-graduation.md'), read('docs/contracts/react-rsc-graduation.ko.md')];
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

  const packageManifest = JSON.parse(read('packages/react/package.json'));
  assert(
    packageManifest.exports?.['./experimental/rsc']?.import === './dist/experimental/rsc.js',
    'The experimental RSC export must remain available while graduation is blocked.',
  );
  assert(
    packageManifest.exports?.['./rsc'] === undefined,
    'The stable @fluojs/react/rsc export must stay absent until every graduation gate has approved evidence.',
  );

  for (const relativePath of [
    'packages/react/README.md',
    'packages/react/README.ko.md',
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
    'docs/README.md',
    'docs/reference/package-surface.md',
    'docs/reference/package-surface.ko.md',
    'docs/reference/package-chooser.md',
    'docs/reference/package-chooser.ko.md',
  ]) {
    assert(read(relativePath).includes('react-rsc-graduation'), `${relativePath} must link the React RSC graduation policy.`);
  }
}
