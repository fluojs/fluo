import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDirectory, '..', '..', '..');

const ssotPairs: Array<[englishPath: string, koreanPath: string]> = [
  ['docs/concepts/platform-consistency-design.md', 'docs/concepts/platform-consistency-design.ko.md'],
  ['docs/operations/behavioral-contract-policy.md', 'docs/operations/behavioral-contract-policy.ko.md'],
  ['docs/operations/release-governance.md', 'docs/operations/release-governance.ko.md'],
  ['docs/operations/platform-conformance-authoring-checklist.md', 'docs/operations/platform-conformance-authoring-checklist.ko.md'],
];

const removedRuntimeModuleFactoryNames = [
  'createMicroservicesModule',
  'createCqrsModule',
  'createEventBusModule',
  'createRedisModule',
] as const;

function headingLevels(relativePath: string): number[] {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('#'))
    .map((line) => line.match(/^#+/)?.[0].length ?? 0);
}

function parsePackageListFromSection(markdown: string, sectionTitle: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${sectionTitle}`);

  if (start < 0) {
    return [];
  }

  const packages: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? '';

    if (line.startsWith('## ')) {
      break;
    }

    const match = line.match(/^- `(@konekti\/[^`]+)`$/);
    if (match?.[1]) {
      packages.push(match[1]);
    }
  }

  return packages.sort((left, right) => left.localeCompare(right));
}

function collectMarkdownFiles(relativeRoot: string): string[] {
  const absoluteRoot = resolve(repoRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  const stack = [absoluteRoot];
  const markdownFiles: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.name.endsWith('.md')) {
        markdownFiles.push(fullPath);
      }
    }
  }

  return markdownFiles;
}

describe('platform consistency governance docs', () => {
  it('keeps SSOT English/Korean heading structures synchronized', () => {
    for (const [englishPath, koreanPath] of ssotPairs) {
      expect(headingLevels(englishPath)).toEqual(headingLevels(koreanPath));
    }
  });

  it('keeps contract-governing docs discoverable from docs index in both languages', () => {
    const docsReadme = readFileSync(resolve(repoRoot, 'docs/README.md'), 'utf8');
    const docsReadmeKo = readFileSync(resolve(repoRoot, 'docs/README.ko.md'), 'utf8');

    expect(docsReadme).toContain('operations/behavioral-contract-policy.md');
    expect(docsReadmeKo).toContain('operations/behavioral-contract-policy.ko.md');
    expect(docsReadme).toContain('operations/release-governance.md');
    expect(docsReadmeKo).toContain('operations/release-governance.ko.md');
  });

  it('keeps intended publish surface synchronized between English and Korean release-governance docs', () => {
    const releaseGovernance = readFileSync(resolve(repoRoot, 'docs/operations/release-governance.md'), 'utf8');
    const releaseGovernanceKo = readFileSync(resolve(repoRoot, 'docs/operations/release-governance.ko.md'), 'utf8');

    const englishPublishSurface = parsePackageListFromSection(releaseGovernance, 'intended publish surface');
    const koreanPublishSurface = parsePackageListFromSection(releaseGovernanceKo, 'intended publish surface');

    expect(englishPublishSurface.length).toBeGreaterThan(0);
    expect(koreanPublishSurface.length).toBeGreaterThan(0);
    expect(koreanPublishSurface).toEqual(englishPublishSurface);
  });

  it('keeps PR CI governance-gated while reserving release-readiness for main pushes', () => {
    const ciWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8');

    expect(ciWorkflow).toContain('resolve-pr-verification-scope:');
    expect(ciWorkflow).toContain('run: node tooling/ci/detect-pr-verification-scope.mjs');
    expect(ciWorkflow).toContain("if: github.event_name == 'pull_request' && needs.resolve-pr-verification-scope.outputs.mode == 'scoped'");
    expect(ciWorkflow).toContain(
      'run: pnpm vitest run $' + '{{ needs.resolve-pr-verification-scope.outputs.test_paths }}',
    );
    expect(ciWorkflow).toContain("if: github.event_name != 'pull_request' || needs.resolve-pr-verification-scope.outputs.mode != 'scoped'");
    expect(ciWorkflow).toContain('build-and-typecheck:');
    expect(ciWorkflow).toContain("if: github.event_name == 'pull_request'");
    expect(ciWorkflow).toContain('verify-platform-consistency-governance');
    expect(ciWorkflow).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(ciWorkflow).toContain('run: pnpm verify:release-readiness');
  });

  it('blocks removed runtime module factory names from docs/prose surfaces', () => {
    const markdownFiles = [
      ...collectMarkdownFiles('docs'),
      ...collectMarkdownFiles('packages'),
      ...collectMarkdownFiles('examples'),
    ];

    for (const markdownFile of markdownFiles) {
      const content = readFileSync(markdownFile, 'utf8');
      for (const removedName of removedRuntimeModuleFactoryNames) {
        expect(content).not.toContain(removedName);
      }
    }
  });
});
