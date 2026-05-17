import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDirectory, '..', '..', '..', '..');

const ssotPairs: Array<[englishPath: string, koreanPath: string]> = [
  ['docs/CONTEXT.md', 'docs/CONTEXT.ko.md'],
  ['docs/architecture/platform-consistency-design.md', 'docs/architecture/platform-consistency-design.ko.md'],
  ['docs/contracts/behavioral-contract-policy.md', 'docs/contracts/behavioral-contract-policy.ko.md'],
  ['docs/contracts/public-export-tsdoc-baseline.md', 'docs/contracts/public-export-tsdoc-baseline.ko.md'],
  ['docs/contracts/release-governance.md', 'docs/contracts/release-governance.ko.md'],
  ['docs/contracts/platform-conformance-authoring-checklist.md', 'docs/contracts/platform-conformance-authoring-checklist.ko.md'],
];

function headingLevels(relativePath: string): number[] {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('#'))
    .map((line) => line.match(/^#+/)?.[0].length ?? 0);
}

function parsePackageListFromSection(markdown: string, sectionTitle: string): string[] {
  const lines = markdown.split('\n');
  const normalizeSectionHeading = (value: string) =>
    value
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/[()]/g, ' ')
      .replace(/\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/[^a-z0-9\-\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const normalizedSectionTitle = normalizeSectionHeading(sectionTitle);
  const start = lines.findIndex((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('## ')) {
      return false;
    }

    const normalizedHeading = normalizeSectionHeading(trimmed.replace(/^##\s*/, ''));

    return normalizedHeading === normalizedSectionTitle;
  });

  if (start < 0) {
    return [];
  }

  const packages: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? '';

    if (line.startsWith('## ')) {
      break;
    }

    const match = line.match(/^- `(@fluojs\/[^`]+)`$/);
    if (match?.[1]) {
      packages.push(match[1]);
    }
  }

  return packages.sort((left, right) => left.localeCompare(right));
}

function parsePackageNamesFromFamilyTable(markdown: string, sectionTitle: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${sectionTitle}`);

  if (start < 0) {
    return [];
  }

  const packages = new Set<string>();

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? '';

    if (line.startsWith('## ')) {
      break;
    }

    for (const match of line.matchAll(/`(@fluojs\/[^`]+)`/g)) {
      if (match[1]) {
        packages.add(match[1]);
      }
    }
  }

  return [...packages].sort((left, right) => left.localeCompare(right));
}

describe('platform consistency governance docs', () => {
  it('keeps SSOT English/Korean heading structures synchronized', () => {
    for (const [englishPath, koreanPath] of ssotPairs) {
      expect(headingLevels(englishPath)).toEqual(headingLevels(koreanPath));
    }
  });

  it('keeps contract-governing docs discoverable from docs index in both languages', () => {
    const docsContext = readFileSync(resolve(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const docsContextKo = readFileSync(resolve(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');

    expect(docsContext).toContain('docs/contracts/behavioral-contract-policy.md');
    expect(docsContextKo).toContain('docs/contracts/behavioral-contract-policy.md');
    expect(docsContext).toContain('docs/contracts/release-governance.md');
    expect(docsContextKo).toContain('docs/contracts/release-governance.md');
    expect(docsContext).toContain('docs/contracts/public-export-tsdoc-baseline.md');
    expect(docsContextKo).toContain('docs/contracts/public-export-tsdoc-baseline.md');
    expect(docsContext).toContain('docs/contracts/testing-guide.md');
    expect(docsContextKo).toContain('docs/contracts/testing-guide.md');
  });

  it('verifies CI-only Changesets release runbook discoverability', () => {
    const releaseGovernance = readFileSync(resolve(repoRoot, 'docs/contracts/release-governance.md'), 'utf8');
    const releaseGovernanceKo = readFileSync(resolve(repoRoot, 'docs/contracts/release-governance.ko.md'), 'utf8');
    const contributing = readFileSync(resolve(repoRoot, 'CONTRIBUTING.md'), 'utf8');
    const contributingKo = readFileSync(resolve(repoRoot, 'CONTRIBUTING.ko.md'), 'utf8');

    expect(releaseGovernance).toContain('.github/workflows/release.yml');
    expect(releaseGovernanceKo).toContain('.github/workflows/release.yml');
    expect(releaseGovernance).toContain('Version Packages PR');
    expect(releaseGovernanceKo).toContain('Version Packages PR');
    expect(releaseGovernance).toContain('pnpm changeset status --since=main');
    expect(releaseGovernanceKo).toContain('pnpm changeset status --since=main');
    expect(contributing).toContain('Version Packages PR');
    expect(contributingKo).toContain('Version Packages PR');
    expect(contributing).toContain('.changeset/*.md');
    expect(contributingKo).toContain('.changeset/*.md');
    expect(contributing).not.toContain('.github/workflows/release-single-package.yml');
    expect(contributingKo).not.toContain('.github/workflows/release-single-package.yml');
  });

  it('keeps intended publish surface synchronized between English and Korean release-governance docs', () => {
    const releaseGovernance = readFileSync(resolve(repoRoot, 'docs/contracts/release-governance.md'), 'utf8');
    const releaseGovernanceKo = readFileSync(resolve(repoRoot, 'docs/contracts/release-governance.ko.md'), 'utf8');

    const englishPublishSurface = parsePackageListFromSection(releaseGovernance, 'intended publish surface');
    const koreanPublishSurface = parsePackageListFromSection(releaseGovernanceKo, 'intended publish surface');

    expect(englishPublishSurface.length).toBeGreaterThan(0);
    expect(koreanPublishSurface.length).toBeGreaterThan(0);
    expect(koreanPublishSurface).toEqual(englishPublishSurface);
    expect(releaseGovernance).toContain('pnpm verify:platform-consistency-governance');
    expect(releaseGovernanceKo).toContain('pnpm verify:platform-consistency-governance');
  });

  it('keeps canonical package-surface inventory synchronized with release-governance in both languages', () => {
    const releaseGovernance = readFileSync(resolve(repoRoot, 'docs/contracts/release-governance.md'), 'utf8');
    const packageSurface = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const packageSurfaceKo = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');

    const intendedPublishSurface = parsePackageListFromSection(releaseGovernance, 'intended publish surface');
    const englishPackageSurface = parsePackageNamesFromFamilyTable(packageSurface, 'public package families');
    const koreanPackageSurface = parsePackageNamesFromFamilyTable(packageSurfaceKo, '공개 패키지 패밀리');

    expect(englishPackageSurface.length).toBeGreaterThan(0);
    expect(koreanPackageSurface.length).toBeGreaterThan(0);
    expect(englishPackageSurface).toEqual(intendedPublishSurface);
    expect(koreanPackageSurface).toEqual(englishPackageSurface);
    expect(englishPackageSurface).toEqual(expect.arrayContaining(['@fluojs/notifications', '@fluojs/email', '@fluojs/slack', '@fluojs/discord']));
    expect(englishPackageSurface).not.toContain('@fluojs/email/node');
  });

  it('keeps the node-only email subpath discoverable outside the top-level package inventory', () => {
    const packageSurface = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const packageSurfaceKo = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const packageChooser = readFileSync(resolve(repoRoot, 'docs/reference/package-chooser.md'), 'utf8');
    const packageChooserKo = readFileSync(resolve(repoRoot, 'docs/reference/package-chooser.ko.md'), 'utf8');

    expect(packageSurface).toContain('@fluojs/email/node');
    expect(packageSurfaceKo).toContain('@fluojs/email/node');
    expect(packageChooser).toContain('@fluojs/email/node');
    expect(packageChooserKo).toContain('@fluojs/email/node');
  });

  it('keeps the i18n package discoverable from task-based package chooser guidance', () => {
    const packageSurface = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
    const packageSurfaceKo = readFileSync(resolve(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
    const packageChooser = readFileSync(resolve(repoRoot, 'docs/reference/package-chooser.md'), 'utf8');
    const packageChooserKo = readFileSync(resolve(repoRoot, 'docs/reference/package-chooser.ko.md'), 'utf8');
    const docsContext = readFileSync(resolve(repoRoot, 'docs/CONTEXT.md'), 'utf8');
    const docsContextKo = readFileSync(resolve(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');

    expect(packageSurface).toContain('@fluojs/i18n');
    expect(packageSurfaceKo).toContain('@fluojs/i18n');
    expect(packageChooser).toContain('@fluojs/i18n');
    expect(packageChooser).toContain('localization');
    expect(packageChooserKo).toContain('@fluojs/i18n');
    expect(packageChooserKo).toContain('localization');
    expect(docsContext).toContain('docs/reference/package-chooser.md');
    expect(docsContext).toContain('@fluojs/i18n');
    expect(docsContext).toContain('HTTP locale policy');
    expect(docsContext).toContain('loader/cache');
    expect(docsContextKo).toContain('docs/reference/package-chooser.md');
    expect(docsContextKo).toContain('@fluojs/i18n');
    expect(docsContextKo).toContain('HTTP locale policy');
    expect(docsContextKo).toContain('loader/cache');
  });

});
