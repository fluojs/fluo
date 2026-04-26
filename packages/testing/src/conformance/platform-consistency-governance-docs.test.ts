import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDirectory, '..', '..', '..', '..');

const ssotPairs: Array<[englishPath: string, koreanPath: string]> = [
  ['docs/architecture/platform-consistency-design.md', 'docs/architecture/platform-consistency-design.ko.md'],
  ['docs/contracts/behavioral-contract-policy.md', 'docs/contracts/behavioral-contract-policy.ko.md'],
  ['docs/contracts/public-export-tsdoc-baseline.md', 'docs/contracts/public-export-tsdoc-baseline.ko.md'],
  ['docs/contracts/release-governance.md', 'docs/contracts/release-governance.ko.md'],
  ['docs/contracts/platform-conformance-authoring-checklist.md', 'docs/contracts/platform-conformance-authoring-checklist.ko.md'],
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

function requireWorkflowStepIndex(workflow: string, stepName: string): number {
  const index = workflow.indexOf(`- name: ${stepName}`);

  expect(index, `Expected workflow step "${stepName}" to exist`).toBeGreaterThanOrEqual(0);

  return index;
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
  });

  it('verifies CI-only Changesets release runbook discoverability', () => {
    const releaseGovernance = readFileSync(resolve(repoRoot, 'docs/contracts/release-governance.md'), 'utf8');
    const releaseGovernanceKo = readFileSync(resolve(repoRoot, 'docs/contracts/release-governance.ko.md'), 'utf8');

    expect(releaseGovernance).toContain('.github/workflows/release.yml');
    expect(releaseGovernanceKo).toContain('.github/workflows/release.yml');
    expect(releaseGovernance).toContain('Version Packages PR');
    expect(releaseGovernanceKo).toContain('Version Packages PR');
    expect(releaseGovernance).toContain('pnpm changeset status --since=main');
    expect(releaseGovernanceKo).toContain('pnpm changeset status --since=main');
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

  it('keeps PR CI governance-gated while reserving release-readiness for main pushes', () => {
    const ciWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    const vitestConfig = readFileSync(resolve(repoRoot, 'vitest.config.ts'), 'utf8');

    expect(ciWorkflow).toContain('resolve-pr-verification-scope:');
    expect(ciWorkflow).toContain('run: node tooling/ci/detect-pr-verification-scope.mjs');
    expect(ciWorkflow).toContain("if: github.event_name == 'pull_request' && needs.resolve-pr-verification-scope.outputs.mode == 'scoped'");
    expect(ciWorkflow).toContain(
      'run: pnpm vitest run $' + '{{ needs.resolve-pr-verification-scope.outputs.test_paths }}',
    );
    expect(ciWorkflow).toContain("if: github.event_name != 'pull_request' || needs.resolve-pr-verification-scope.outputs.mode != 'scoped'");
    expect(ciWorkflow).toContain('run: pnpm vitest run --project packages');
    expect(ciWorkflow).toContain('run: pnpm vitest run --project apps');
    expect(ciWorkflow).toContain('run: pnpm vitest run --project examples');
    expect(ciWorkflow).toContain('run: pnpm vitest run --project tooling');
    expect(ciWorkflow).toContain('FLUO_VITEST_SHUTDOWN_DEBUG_DIR: .artifacts/vitest-shutdown-debug/packages');
    expect(ciWorkflow).toContain('FLUO_VITEST_SHUTDOWN_DEBUG_DIR: .artifacts/vitest-shutdown-debug/tooling');
    expect(ciWorkflow).toContain("hashFiles('.artifacts/vitest-shutdown-debug/**/*.json') != ''");
    expect(vitestConfig).toContain('passWithNoTests: true');
    expect(ciWorkflow).toContain('build-and-typecheck:');
    expect(ciWorkflow).toContain("if: github.event_name == 'pull_request'");
    expect(ciWorkflow).toContain('verify-platform-consistency-governance');
    expect(ciWorkflow).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(ciWorkflow).toContain('run: pnpm verify:release-readiness');
  });

  it('keeps Changesets release automation bound to main pushes and OIDC npm publish', () => {
    const releaseWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8');

    expect(releaseWorkflow).toContain('name: Changesets Release');
    expect(releaseWorkflow).toContain('push:');
    expect(releaseWorkflow).toContain('- main');
    expect(releaseWorkflow).toContain('id-token: write');
    expect(releaseWorkflow).toContain('registry-url: https://registry.npmjs.org');
    expect(releaseWorkflow).toContain('uses: changesets/action@v1');
    expect(releaseWorkflow).toContain('version: pnpm version-packages');
    expect(releaseWorkflow).toContain('publish: pnpm publish-packages');
    expect(releaseWorkflow).toContain('createGithubReleases: true');
    expect(releaseWorkflow).toContain('run: pnpm verify:release-readiness');
    expect(releaseWorkflow).toContain('NPM_CONFIG_PROVENANCE: true');
    expect(releaseWorkflow).toContain('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}');
  });

  it('keeps Changesets release safety gates before versioning or publish', () => {
    const releaseWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8');

    const checkout = requireWorkflowStepIndex(releaseWorkflow, 'Checkout');
    const installPnpm = requireWorkflowStepIndex(releaseWorkflow, 'Install pnpm');
    const setupNode = requireWorkflowStepIndex(releaseWorkflow, 'Setup Node.js');
    const installDependencies = requireWorkflowStepIndex(releaseWorkflow, 'Install dependencies');
    const buildPackages = requireWorkflowStepIndex(releaseWorkflow, 'Build packages');
    const verifyReleaseReadiness = requireWorkflowStepIndex(releaseWorkflow, 'Verify release readiness');
    const releaseStep = requireWorkflowStepIndex(releaseWorkflow, 'Create Release Pull Request or Publish to npm');

    expect(releaseWorkflow).toContain('fetch-depth: 0');
    expect(releaseWorkflow).toContain('pnpm install --frozen-lockfile');
    expect(releaseWorkflow).toContain('run: pnpm build');
    expect(releaseWorkflow).toContain('run: pnpm verify:release-readiness');

    expect(checkout).toBeLessThan(installPnpm);
    expect(installPnpm).toBeLessThan(setupNode);
    expect(setupNode).toBeLessThan(installDependencies);
    expect(installDependencies).toBeLessThan(buildPackages);
    expect(buildPackages).toBeLessThan(verifyReleaseReadiness);
    expect(verifyReleaseReadiness).toBeLessThan(releaseStep);
  });

  it('keeps the legacy single-package workflow disabled for publish authority', () => {
    const legacyReleaseWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/release-single-package.yml'), 'utf8');

    expect(legacyReleaseWorkflow).toContain('name: Deprecated single-package release');
    expect(legacyReleaseWorkflow).toContain('This workflow is deprecated and cannot publish packages');
    expect(legacyReleaseWorkflow).toContain('exit 1');
    expect(legacyReleaseWorkflow).not.toContain('pnpm publish');
    expect(legacyReleaseWorkflow).not.toContain('gh release create');
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
