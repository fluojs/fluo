import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDirectory, '..', '..', '..');

const ssotPairs: Array<[englishPath: string, koreanPath: string]> = [
  ['docs/concepts/platform-consistency-design.md', 'docs/concepts/platform-consistency-design.ko.md'],
  ['docs/operations/release-governance.md', 'docs/operations/release-governance.ko.md'],
  ['docs/operations/platform-conformance-authoring-checklist.md', 'docs/operations/platform-conformance-authoring-checklist.ko.md'],
];

function headingLevels(relativePath: string): number[] {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('#'))
    .map((line) => line.match(/^#+/)?.[0].length ?? 0);
}

describe('platform consistency governance docs', () => {
  it('keeps SSOT English/Korean heading structures synchronized', () => {
    for (const [englishPath, koreanPath] of ssotPairs) {
      expect(headingLevels(englishPath)).toEqual(headingLevels(koreanPath));
    }
  });

  it('keeps release governance discoverable from docs index in both languages', () => {
    const docsReadme = readFileSync(resolve(repoRoot, 'docs/README.md'), 'utf8');
    const docsReadmeKo = readFileSync(resolve(repoRoot, 'docs/README.ko.md'), 'utf8');

    expect(docsReadme).toContain('operations/release-governance.md');
    expect(docsReadmeKo).toContain('operations/release-governance.ko.md');
  });
});
