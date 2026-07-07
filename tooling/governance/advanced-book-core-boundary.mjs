import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');

const advancedBookCoreBoundaryPairs = [
  {
    englishPath: 'book/advanced/ch02-metadata.md',
    koreanPath: 'book/advanced/ch02-metadata.ko.md',
    requiredEnglishSnippets: ['global polyfill'],
    requiredKoreanSnippets: ['전역 polyfill'],
    requiredSharedSnippets: [
      '@fluojs/core/request-pipeline',
      '@fluojs/core/internal',
      '@fluojs/core',
      'ensureMetadataSymbol()',
    ],
  },
  {
    englishPath: 'book/advanced/ch03-custom-decorators.md',
    koreanPath: 'book/advanced/ch03-custom-decorators.ko.md',
    requiredEnglishSnippets: ['consumer custom code'],
    requiredKoreanSnippets: ['소비자 커스텀 코드'],
    requiredSharedSnippets: [
      '@fluojs/core/request-pipeline',
      '@fluojs/core/internal',
      'context.metadata',
      'ensureMetadataSymbol()',
    ],
  },
];

const advancedBookCoreBoundaryRegressionPaths = new Set([
  'packages/core/src/public-api.test.ts',
  'packages/core/src/request-pipeline-public-api.test.ts',
  'tooling/governance/verify-platform-consistency-governance.test.ts',
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Platform consistency governance check failed: ${message}`);
  }
}

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function hasChanged(changedFiles, path) {
  return changedFiles.includes(path);
}

function includesAny(changedFiles, predicate) {
  return changedFiles.some(predicate);
}

export function enforceAdvancedBookCoreBoundaryCompanions(changedFiles) {
  const touchedPairs = advancedBookCoreBoundaryPairs.filter(
    ({ englishPath, koreanPath }) => hasChanged(changedFiles, englishPath) || hasChanged(changedFiles, koreanPath),
  );

  if (touchedPairs.length === 0) {
    return;
  }

  for (const { englishPath, koreanPath, requiredEnglishSnippets, requiredKoreanSnippets, requiredSharedSnippets } of touchedPairs) {
    assert(
      hasChanged(changedFiles, englishPath) && hasChanged(changedFiles, koreanPath),
      `${englishPath} and ${koreanPath} must change together so advanced-book core boundary guidance preserves EN/KO companion scope.`,
    );

    const englishMarkdown = read(englishPath);
    const koreanMarkdown = read(koreanPath);

    for (const snippet of requiredSharedSnippets) {
      assert(
        englishMarkdown.includes(snippet),
        `${englishPath} must keep ${snippet} discoverable for advanced-book core boundary guidance.`,
      );
      assert(
        koreanMarkdown.includes(snippet),
        `${koreanPath} must keep ${snippet} discoverable for advanced-book core boundary guidance.`,
      );
    }

    for (const snippet of requiredEnglishSnippets) {
      assert(englishMarkdown.includes(snippet), `${englishPath} must keep ${snippet} discoverable.`);
    }
    for (const snippet of requiredKoreanSnippets) {
      assert(koreanMarkdown.includes(snippet), `${koreanPath} must keep ${snippet} discoverable.`);
    }
  }

  assert(
    includesAny(changedFiles, (path) => advancedBookCoreBoundaryRegressionPaths.has(path)),
    'advanced-book core boundary guidance updates must include executable regression evidence in packages/core tests or the governance verifier test.',
  );
}
