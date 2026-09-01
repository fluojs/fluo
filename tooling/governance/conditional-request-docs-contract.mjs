import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const conditionalRequestDocumentationRequirements = [
  [
    'docs/architecture/http-runtime.md',
    [
      '{ exists: false }',
      '{ exists: true, validators? }',
      'middleware, and guards',
      'independent route',
      'framework-managed response writing suppresses its body',
      'custom response writers own body emission',
    ],
  ],
  [
    'docs/architecture/http-runtime.ko.md',
    [
      '{ exists: false }',
      '{ exists: true, validators? }',
      'application/module middleware, guard 뒤',
      '독립 route',
      'framework-managed response writing이 body를 suppress',
      'custom response writer는 body emission을 소유',
    ],
  ],
  ['packages/http/README.md', ['ConditionalRequestOptions', 'ConditionalRequestResolver']],
  ['packages/http/README.ko.md', ['ConditionalRequestOptions', 'ConditionalRequestResolver']],
  ['packages/runtime/README.md', ['BootstrapApplicationOptions.conditionalRequest']],
  ['packages/runtime/README.ko.md', ['BootstrapApplicationOptions.conditionalRequest']],
  [
    'packages/testing/README.md',
    ['assertSupportsConditionalRequests()', 'createConditionalRequestBootstrapOptions'],
  ],
  [
    'packages/testing/README.ko.md',
    ['assertSupportsConditionalRequests()', 'createConditionalRequestBootstrapOptions'],
  ],
];

export function enforceConditionalRequestDocsContract(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of conditionalRequestDocumentationRequirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    if (missingMarkers.length > 0) {
      throw new Error(
        `Conditional request documentation contract check failed: ${relativePath} is missing ${missingMarkers.join(', ')}.`,
      );
    }
  }
}
