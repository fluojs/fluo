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

  it('verifies CI-only single-package release runbook discoverability', () => {
    const releaseGovernance = readFileSync(resolve(repoRoot, 'docs/contracts/release-governance.md'), 'utf8');
    const releaseGovernanceKo = readFileSync(resolve(repoRoot, 'docs/contracts/release-governance.ko.md'), 'utf8');

    expect(releaseGovernance).toContain('.github/workflows/release-single-package.yml');
    expect(releaseGovernanceKo).toContain('.github/workflows/release-single-package.yml');
    expect(releaseGovernance).toContain('pnpm verify:release-readiness --target-package ... --target-version ... --dist-tag ...');
    expect(releaseGovernanceKo).toContain('pnpm verify:release-readiness --target-package ... --target-version ... --dist-tag ...');
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

  it('keeps single-package release automation bound to the canonical preflight and post-publish release creation', () => {
    const releaseWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/release-single-package.yml'), 'utf8');

    expect(releaseWorkflow).toContain('workflow_dispatch:');
    expect(releaseWorkflow).toContain('package_name:');
    expect(releaseWorkflow).toContain('package_version:');
    expect(releaseWorkflow).toContain('dist_tag:');
    expect(releaseWorkflow).toContain('release_prerelease:');
    expect(releaseWorkflow).toContain('release_intent_file:');
    expect(releaseWorkflow).toContain('Optional committed release-intent JSON record; required by release-readiness for 1.0.0-beta.2+ publishes');
    expect(releaseWorkflow).toContain('required: false');
    expect(releaseWorkflow).not.toContain('default: tooling/release/intents/release-intent.json');
    expect(releaseWorkflow).toContain('RELEASE_INTENT_FILE: ${{ inputs.release_intent_file }}');
    expect(releaseWorkflow).toContain('id-token: write');
    expect(releaseWorkflow).toContain('registry-url: https://registry.npmjs.org');
    expect(releaseWorkflow).toContain('pnpm verify:release-readiness --target-package "$TARGET_PACKAGE" --target-version "$TARGET_VERSION" --dist-tag "$DIST_TAG" --release-intent-file "$RELEASE_INTENT_FILE" --write-summary --summary-output-dir "$RUNNER_TEMP/release-readiness"');
    expect(releaseWorkflow).toContain('pnpm --dir "${{ steps.resolve.outputs.package_dir }}" publish --access public --tag "$DIST_TAG" --provenance --no-git-checks');
    expect(releaseWorkflow).toContain('node tooling/release/prepare-github-release.mjs "${{ steps.resolve.outputs.release_tag }}"');
    expect(releaseWorkflow).toContain('git tag "${{ steps.resolve.outputs.release_tag }}"');
    expect(releaseWorkflow).toContain('gh release create "${{ steps.resolve.outputs.release_tag }}"');
    expect(releaseWorkflow).toContain('"$RUNNER_TEMP/release-readiness/release-readiness-summary.md#release-readiness-summary.md"');
    expect(requireWorkflowStepIndex(releaseWorkflow, 'Canonical release-readiness preflight')).toBeLessThan(
      requireWorkflowStepIndex(releaseWorkflow, 'Publish package to npm'),
    );
    expect(requireWorkflowStepIndex(releaseWorkflow, 'Publish package to npm')).toBeLessThan(
      requireWorkflowStepIndex(releaseWorkflow, 'Create and push git tag'),
    );
    expect(requireWorkflowStepIndex(releaseWorkflow, 'Create and push git tag')).toBeLessThan(
      requireWorkflowStepIndex(releaseWorkflow, 'Create GitHub Release'),
    );
  });

  it('keeps single-package release safety gates before publish in the intended resolve/preflight/notes/tag/readiness/publish/release order', () => {
    const releaseWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/release-single-package.yml'), 'utf8');

    const mainBranchGuard = requireWorkflowStepIndex(releaseWorkflow, 'Require main branch dispatch');
    const resolveTarget = requireWorkflowStepIndex(releaseWorkflow, 'Resolve single-package release target');
    const validatePackageVersionDistTag = requireWorkflowStepIndex(releaseWorkflow, 'Canonical release-readiness preflight');
    const validatePackageSpecificNotes = requireWorkflowStepIndex(releaseWorkflow, 'Prepare GitHub Release notes');
    const validateTargetTagAbsence = requireWorkflowStepIndex(releaseWorkflow, 'Validate target git tag is absent');
    const publishPackage = requireWorkflowStepIndex(releaseWorkflow, 'Publish package to npm');
    const createTag = requireWorkflowStepIndex(releaseWorkflow, 'Create and push git tag');
    const createGitHubRelease = requireWorkflowStepIndex(releaseWorkflow, 'Create GitHub Release');

    expect(releaseWorkflow).toContain("if [ \"$GITHUB_REF\" != 'refs/heads/main' ]; then");
    expect(releaseWorkflow).toContain('Single-package release workflow must run from refs/heads/main.');
    expect(releaseWorkflow).toContain('node tooling/release/prepare-github-release.mjs "${{ steps.resolve.outputs.release_tag }}"');
    expect(releaseWorkflow).toContain('git rev-parse --verify --quiet "refs/tags/${{ steps.resolve.outputs.release_tag }}"');
    expect(releaseWorkflow).toContain('pnpm verify:release-readiness --target-package "$TARGET_PACKAGE" --target-version "$TARGET_VERSION" --dist-tag "$DIST_TAG" --release-intent-file "$RELEASE_INTENT_FILE" --write-summary --summary-output-dir "$RUNNER_TEMP/release-readiness"');

    expect(mainBranchGuard).toBeLessThan(resolveTarget);
    expect(resolveTarget).toBeLessThan(validatePackageVersionDistTag);
    expect(validatePackageVersionDistTag).toBeLessThan(validatePackageSpecificNotes);
    expect(validatePackageSpecificNotes).toBeLessThan(validateTargetTagAbsence);
    expect(validateTargetTagAbsence).toBeLessThan(publishPackage);
    expect(validatePackageVersionDistTag).toBeLessThan(publishPackage);
    expect(publishPackage).toBeLessThan(createTag);
    expect(createTag).toBeLessThan(createGitHubRelease);
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
