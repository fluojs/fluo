import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const directProcessEnvPattern = /\bprocess\s*(?:\?\.|\.)\s*env\b/g;

const ssotPairs = [
  ['docs/concepts/platform-consistency-design.md', 'docs/concepts/platform-consistency-design.ko.md'],
  ['docs/operations/behavioral-contract-policy.md', 'docs/operations/behavioral-contract-policy.ko.md'],
  ['docs/operations/public-export-tsdoc-baseline.md', 'docs/operations/public-export-tsdoc-baseline.ko.md'],
  ['docs/operations/release-governance.md', 'docs/operations/release-governance.ko.md'],
  ['docs/operations/platform-conformance-authoring-checklist.md', 'docs/operations/platform-conformance-authoring-checklist.ko.md'],
  ['docs/reference/package-surface.md', 'docs/reference/package-surface.ko.md'],
];

const contractGateTriggers = new Set([
  'docs/concepts/platform-consistency-design.md',
  'docs/concepts/platform-consistency-design.ko.md',
  'docs/operations/behavioral-contract-policy.md',
  'docs/operations/behavioral-contract-policy.ko.md',
  'docs/operations/public-export-tsdoc-baseline.md',
  'docs/operations/public-export-tsdoc-baseline.ko.md',
  'docs/operations/release-governance.md',
  'docs/operations/release-governance.ko.md',
  'docs/operations/platform-conformance-authoring-checklist.md',
  'docs/operations/platform-conformance-authoring-checklist.ko.md',
  'docs/reference/package-chooser.md',
  'docs/reference/package-chooser.ko.md',
  'docs/reference/package-surface.md',
  'docs/reference/package-surface.ko.md',
]);

const removedRuntimeModuleFactoryNames = [
  'createMicroservicesModule',
  'createCqrsModule',
  'createEventBusModule',
  'createRedisModule',
];

const officialTransportDocsPackages = [
  '@konekti/platform-fastify',
  '@konekti/platform-express',
  '@konekti/socket.io',
  '@konekti/platform-bun',
  '@konekti/platform-deno',
  '@konekti/platform-cloudflare-workers',
];

export function getOfficialTransportDocsPackages() {
  return [...officialTransportDocsPackages];
}

const packageSourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts']);

const directProcessEnvAllowedPackageSourcePaths = new Set([
  'packages/cli/src/cli.ts',
  'packages/cli/src/new/scaffold.ts',
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}.`);
  }

  return result;
}

function changedFilesFromGit() {
  const preferredBase = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
  const mergeBaseResult = run('git', ['merge-base', 'HEAD', preferredBase], { allowFailure: true });

  if (mergeBaseResult.status === 0 && mergeBaseResult.stdout.trim().length > 0) {
    const mergeBase = mergeBaseResult.stdout.trim();
    const diffResult = run('git', ['diff', '--name-only', `${mergeBase}...HEAD`]);
    return diffResult.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const fallbackDiff = run('git', ['diff', '--name-only', 'HEAD~1...HEAD'], { allowFailure: true });
  if (fallbackDiff.status === 0) {
    return fallbackDiff.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeHeading(line) {
  return line
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[^#a-z0-9\-\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHeadings(relativePath) {
  const content = readFileSync(join(repoRoot, relativePath), 'utf8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('#'))
    .map((line) => {
      const level = line.match(/^#+/)?.[0].length ?? 0;
      const text = line.replace(/^#+\s*/, '');
      return `${level}:${normalizeHeading(text)}`;
    });
}

function parsePackageListFromSection(markdown, sectionTitle) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${sectionTitle}`);

  if (start < 0) {
    return [];
  }

  const packages = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (line.startsWith('## ')) {
      break;
    }

    const match = line.match(/^- `(@konekti\/[^`]+)`$/);
    if (match) {
      packages.push(match[1]);
    }
  }

  return packages.sort((left, right) => left.localeCompare(right));
}

function areSameStringArrays(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

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

function collectPackageDirs() {
  const packagesRoot = join(repoRoot, 'packages');
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function enforcePackageDirectoriesHaveManifests() {
  const packagesRoot = join(repoRoot, 'packages');

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifestPath = join(packagesRoot, entry.name, 'package.json');
    assert(
      existsSync(manifestPath),
      `packages/${entry.name} must contain package.json so packages/* does not admit ghost workspace members.`,
    );
  }
}

function collectMarkdownFiles(relativeRoot) {
  const absoluteRoot = join(repoRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  const stack = [absoluteRoot];
  const markdownPaths = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absoluteEntry = join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(absoluteEntry);
        continue;
      }

      if (extname(entry.name) !== '.md') {
        continue;
      }

      markdownPaths.push(absoluteEntry);
    }
  }

  return markdownPaths;
}

function collectFiles(relativeRoot, predicate) {
  const absoluteRoot = join(repoRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  const stack = [absoluteRoot];
  const filePaths = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absoluteEntry = join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(absoluteEntry);
        continue;
      }

      const relativePath = absoluteEntry.replace(`${repoRoot}/`, '');
      if (!predicate(relativePath, entry.name)) {
        continue;
      }

      filePaths.push(relativePath);
    }
  }

  return filePaths.sort((left, right) => left.localeCompare(right));
}

export function isGovernedPackageSourcePath(relativePath) {
  if (!relativePath.startsWith('packages/')) {
    return false;
  }

  if (!relativePath.includes('/src/')) {
    return false;
  }

  if (relativePath.endsWith('.d.ts')) {
    return false;
  }

  if (/\.(test|spec)\.[^.]+$/.test(relativePath)) {
    return false;
  }

  if (directProcessEnvAllowedPackageSourcePaths.has(relativePath)) {
    return false;
  }

  return packageSourceExtensions.has(extname(relativePath));
}

function findLineNumberFromIndex(source, index) {
  let lineNumber = 1;

  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === '\n') {
      lineNumber += 1;
    }
  }

  return lineNumber;
}

export function collectDirectProcessEnvViolations(relativePaths, readSource) {
  const violations = [];

  for (const relativePath of relativePaths) {
    if (!isGovernedPackageSourcePath(relativePath)) {
      continue;
    }

    const source = readSource(relativePath);
    directProcessEnvPattern.lastIndex = 0;

    for (const match of source.matchAll(directProcessEnvPattern)) {
      const matchIndex = match.index ?? 0;
      const lineNumber = findLineNumberFromIndex(source, matchIndex);
      const excerpt = source.split('\n')[lineNumber - 1]?.trim() ?? 'process.env';

      violations.push({
        excerpt,
        line: lineNumber,
        path: relativePath,
      });
    }
  }

  return violations;
}

function collectGovernedPackageSourceFiles() {
  return collectFiles('packages', (relativePath) => isGovernedPackageSourcePath(relativePath));
}

export function enforceNoDirectProcessEnvInOrdinaryPackageSource(
  relativePaths = collectGovernedPackageSourceFiles(),
  readSource = read,
) {
  const violations = collectDirectProcessEnvViolations(relativePaths, readSource);
  assert(
    violations.length === 0,
    [
      'ordinary package source must not read process.env directly.',
      'Move env access to the application/bootstrap boundary and pass explicit parameters or typed config instead.',
      `Approved source exceptions: ${[...directProcessEnvAllowedPackageSourcePaths].join(', ')}.`,
      ...violations.map((violation) => `${violation.path}:${violation.line} ${violation.excerpt}`),
    ].join('\n'),
  );
}

function packageHasConformanceHarness(packageName) {
  const packageSource = join(repoRoot, 'packages', packageName, 'src');
  if (!existsSync(packageSource)) {
    return false;
  }
  const stack = [packageSource];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      const extension = extname(entry.name);
      if (!['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(extension)) {
        continue;
      }

      if (!entry.name.endsWith('.test.ts') && !entry.name.endsWith('.spec.ts')) {
        continue;
      }

      const source = readFileSync(fullPath, 'utf8');
      if (source.includes('createPlatformConformanceHarness') || source.includes('assertAll()')) {
        return true;
      }
    }
  }

  return false;
}

function enforceSsotMirrorStructure() {
  for (const [englishPath, koreanPath] of ssotPairs) {
    const englishHeadings = extractHeadings(englishPath);
    const koreanHeadings = extractHeadings(koreanPath);

    assert(
      englishHeadings.length === koreanHeadings.length,
      `${englishPath} and ${koreanPath} must keep the same heading count (${englishHeadings.length} != ${koreanHeadings.length}).`,
    );

    for (let index = 0; index < englishHeadings.length; index += 1) {
      const englishSignature = englishHeadings[index].split(':')[0];
      const koreanSignature = koreanHeadings[index].split(':')[0];
      assert(
        englishSignature === koreanSignature,
        `${englishPath} and ${koreanPath} diverged at heading index ${index + 1} (level ${englishSignature} != ${koreanSignature}).`,
      );
    }
  }
}

function enforceContractCompanionUpdates(changedFiles) {
  const touchedContractGate = changedFiles.some((path) => contractGateTriggers.has(path));

  if (!touchedContractGate) {
    return;
  }

  // Contract-governing docs must remain discoverable from the docs hub, and any
  // such discoverability updates should stay coupled to this governance rule so
  // future contract-boundary edits do not silently bypass the companion checks.

  assert(
    hasChanged(changedFiles, 'docs/README.md') && hasChanged(changedFiles, 'docs/README.ko.md'),
    'contract-governing doc updates must include docs/README.md and docs/README.ko.md discoverability updates.',
  );
  assert(
    includesAny(changedFiles, (path) => path.startsWith('.github/workflows/')) ||
      includesAny(changedFiles, (path) => path.startsWith('tooling/')),
    'contract-governing doc updates must include CI/tooling enforcement updates.',
  );
  assert(
    includesAny(changedFiles, (path) => path.endsWith('.test.ts') || path.endsWith('.spec.ts')),
    'contract-governing doc updates must include regression test updates for the changed contract surface.',
  );
}

function enforceAlignmentClaimsBackedByHarness(changedFiles) {
  const changedReadmes = changedFiles.filter((path) => /^packages\/[^/]+\/README(\.ko)?\.md$/.test(path));

  if (changedReadmes.length === 0) {
    return;
  }

  const packageDirs = new Set(collectPackageDirs());
  for (const readmePath of changedReadmes) {
    const packageName = readmePath.split('/')[1];
    if (!packageDirs.has(packageName)) {
      continue;
    }

    const markdown = readFileSync(join(repoRoot, readmePath), 'utf8').toLowerCase();
    const claimsAlignment =
      markdown.includes('platform consistency alignment') ||
      markdown.includes('platform-facing package') ||
      markdown.includes('platform conformance');

    if (!claimsAlignment) {
      continue;
    }

    assert(
      packageHasConformanceHarness(packageName),
      `${readmePath} claims platform alignment/conformance but packages/${packageName} lacks harness-backed conformance tests.`,
    );
  }
}

function enforceReleaseGovernancePublishSurfaceSync() {
  const releaseGovernance = readFileSync(join(repoRoot, 'docs/operations/release-governance.md'), 'utf8');
  const releaseGovernanceKo = readFileSync(join(repoRoot, 'docs/operations/release-governance.ko.md'), 'utf8');

  const englishPublishSurface = parsePackageListFromSection(releaseGovernance, 'intended publish surface');
  const koreanPublishSurface = parsePackageListFromSection(releaseGovernanceKo, 'intended publish surface');

  assert(englishPublishSurface.length > 0, 'release-governance.md must define an intended publish surface list.');
  assert(koreanPublishSurface.length > 0, 'release-governance.ko.md must define an intended publish surface list.');
  assert(
    areSameStringArrays(englishPublishSurface, koreanPublishSurface),
    'release-governance.md and release-governance.ko.md must declare the same intended publish surface package list.',
  );
}

function enforceDocsHubOfficialTransportLinks() {
  const docsReadme = readFileSync(join(repoRoot, 'docs/README.md'), 'utf8');
  const docsReadmeKo = readFileSync(join(repoRoot, 'docs/README.ko.md'), 'utf8');
  const packageSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');

  for (const packageName of officialTransportDocsPackages) {
    if (!packageSurface.includes(`- \`${packageName}\``)) {
      continue;
    }

    assert(
      docsReadme.includes(packageName),
      `docs/README.md must mention ${packageName} when it is part of the official transport package set.`,
    );
    assert(
      docsReadmeKo.includes(packageName),
      `docs/README.ko.md must mention ${packageName} when it is part of the official transport package set.`,
    );
  }
}

function enforceCanonicalRuntimeMatrixReferences() {
  const packageSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
  const packageSurfaceKo = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
  const packageChooser = readFileSync(join(repoRoot, 'docs/reference/package-chooser.md'), 'utf8');
  const packageChooserKo = readFileSync(join(repoRoot, 'docs/reference/package-chooser.ko.md'), 'utf8');
  const docsReadme = readFileSync(join(repoRoot, 'docs/README.md'), 'utf8');
  const docsReadmeKo = readFileSync(join(repoRoot, 'docs/README.ko.md'), 'utf8');
  const rootReadme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
  const rootReadmeKo = readFileSync(join(repoRoot, 'README.ko.md'), 'utf8');
  const cliReadme = readFileSync(join(repoRoot, 'packages/cli/README.md'), 'utf8');
  const cliReadmeKo = readFileSync(join(repoRoot, 'packages/cli/README.ko.md'), 'utf8');
  const toolchainMatrix = readFileSync(join(repoRoot, 'docs/reference/toolchain-contract-matrix.md'), 'utf8');
  const toolchainMatrixKo = readFileSync(join(repoRoot, 'docs/reference/toolchain-contract-matrix.ko.md'), 'utf8');

  assert(
    packageSurface.includes('## canonical runtime package matrix'),
    'docs/reference/package-surface.md must define the canonical runtime package matrix section.',
  );
  assert(
    packageSurfaceKo.includes('## canonical runtime package matrix'),
    'docs/reference/package-surface.ko.md must define the canonical runtime package matrix section.',
  );

  assert(
    packageChooser.includes('./package-surface.md#canonical-runtime-package-matrix'),
    'docs/reference/package-chooser.md must point to the canonical runtime package matrix anchor.',
  );
  assert(
    packageChooserKo.includes('./package-surface.ko.md#canonical-runtime-package-matrix'),
    'docs/reference/package-chooser.ko.md must point to the canonical runtime package matrix anchor.',
  );

  assert(
    docsReadme.includes('reference/package-surface.md'),
    'docs/README.md must point readers to the canonical runtime package matrix page.',
  );
  assert(
    docsReadmeKo.includes('reference/package-surface.ko.md'),
    'docs/README.ko.md must point readers to the canonical runtime package matrix page.',
  );
  assert(rootReadme.includes('docs/reference/package-surface.md'), 'README.md must point to the canonical runtime package matrix page.');
  assert(
    rootReadmeKo.includes('docs/reference/package-surface.ko.md'),
    'README.ko.md must point to the canonical runtime package matrix page.',
  );
  assert(
    cliReadme.includes('../../docs/reference/package-surface.md'),
    'packages/cli/README.md must point to the canonical runtime package matrix page.',
  );
  assert(
    cliReadmeKo.includes('../../docs/reference/package-surface.ko.md'),
    'packages/cli/README.ko.md must point to the canonical runtime package matrix page.',
  );
  assert(
    toolchainMatrix.includes('./package-surface.md'),
    'docs/reference/toolchain-contract-matrix.md must defer runtime matrix ownership to package-surface.md.',
  );
  assert(
    toolchainMatrixKo.includes('./package-surface.ko.md'),
    'docs/reference/toolchain-contract-matrix.ko.md must defer runtime matrix ownership to package-surface.ko.md.',
  );
}

function enforceRemovedRuntimeFactoryNamesNotUsedInDocs() {
  const markdownFiles = [
    ...collectMarkdownFiles('docs'),
    ...collectMarkdownFiles('packages'),
    ...collectMarkdownFiles('examples'),
  ];

  const violations = [];

  for (const markdownPath of markdownFiles) {
    const source = readFileSync(markdownPath, 'utf8');
    for (const removedName of removedRuntimeModuleFactoryNames) {
      if (source.includes(removedName)) {
        violations.push(`${markdownPath.replace(`${repoRoot}/`, '')}: ${removedName}`);
      }
    }
  }

  assert(
    violations.length === 0,
    `removed runtime module factory names must not appear in docs/prose:\n${violations.join('\n')}`,
  );
}

export function main() {
  const changedFiles = changedFilesFromGit();

  enforceSsotMirrorStructure();
  enforcePackageDirectoriesHaveManifests();
  enforceReleaseGovernancePublishSurfaceSync();
  enforceDocsHubOfficialTransportLinks();
  enforceCanonicalRuntimeMatrixReferences();
  enforceRemovedRuntimeFactoryNamesNotUsedInDocs();
  enforceNoDirectProcessEnvInOrdinaryPackageSource();
  enforceContractCompanionUpdates(changedFiles);
  enforceAlignmentClaimsBackedByHarness(changedFiles);

  console.log('Platform consistency governance checks passed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
