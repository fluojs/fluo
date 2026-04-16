import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const summaryPath = join(scriptDirectory, 'release-readiness-summary.md');
const summaryKoPath = join(scriptDirectory, 'release-readiness-summary.ko.md');
const changelogPath = join(repoRoot, 'CHANGELOG.md');
const releaseReadinessVitestProjects = ['packages', 'apps', 'examples', 'tooling'];
const releaseReadinessVerificationCommands = [
  '`pnpm build`',
  '`pnpm typecheck`',
  ...releaseReadinessVitestProjects.map((projectName) => `\`pnpm vitest run --project ${projectName}\``),
  '`pnpm --dir packages/cli sandbox:matrix`',
  '`pnpm verify:platform-consistency-governance`',
  '`pnpm verify:release-readiness`',
];

function resolveSummaryOutputPaths(outputDirectory = scriptDirectory) {
  return {
    summaryKoPath: join(outputDirectory, 'release-readiness-summary.ko.md'),
    summaryPath: join(outputDirectory, 'release-readiness-summary.md'),
  };
}

function parseCliOptions(argv = process.argv.slice(2)) {
  let writeDrafts = false;
  let writeSummary = false;
  let summaryOutputDirectory;
  let targetPackage;
  let targetVersion;
  let distTag;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--write-drafts') {
      writeDrafts = true;
      continue;
    }

    if (argument === '--write-summary') {
      writeSummary = true;
      continue;
    }

    if (argument === '--summary-output-dir') {
      summaryOutputDirectory = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--summary-output-dir=')) {
      summaryOutputDirectory = argument.slice('--summary-output-dir='.length);
      continue;
    }

    if (argument === '--target-package') {
      targetPackage = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--target-package=')) {
      targetPackage = argument.slice('--target-package='.length);
      continue;
    }

    if (argument === '--target-version') {
      targetVersion = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--target-version=')) {
      targetVersion = argument.slice('--target-version='.length);
      continue;
    }

    if (argument === '--dist-tag') {
      distTag = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--dist-tag=')) {
      distTag = argument.slice('--dist-tag='.length);
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  const preflightInputs = [targetPackage, targetVersion, distTag].filter((value) => typeof value === 'string');

  if (preflightInputs.length > 0 && preflightInputs.length < 3) {
    throw new Error(
      'Single-package release preflight requires --target-package, --target-version, and --dist-tag together.',
    );
  }

  return {
    distTag,
    summaryOutputDirectory,
    targetPackage,
    targetVersion,
    writeDrafts,
    writeSummary,
  };
}

function languageToggle(current) {
  const english = current === 'en' ? '<strong><kbd>English</kbd></strong>' : '<a href="./release-readiness-summary.md"><kbd>English</kbd></a>';
  const korean = current === 'ko' ? '<strong><kbd>한국어</kbd></strong>' : '<a href="./release-readiness-summary.ko.md"><kbd>한국어</kbd></a>';
  return `<p>${english} ${korean}</p>`;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}.`);
  }
}

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function runCanonicalReleaseReadinessVerificationCommands(runCommand) {
  runCommand('pnpm', ['build']);
  runCommand('pnpm', ['typecheck']);

  for (const projectName of releaseReadinessVitestProjects) {
    runCommand('pnpm', ['vitest', 'run', '--project', projectName]);
  }

  runCommand('pnpm', ['--dir', 'packages/cli', 'sandbox:matrix']);
}

function packageRelativePath(packageName) {
  return packageName.startsWith('@fluojs/') ? `packages/${packageName.slice('@fluojs/'.length)}` : null;
}

function workspaceManifestByName(packageManifests) {
  return new Map(packageManifests.map(({ manifest, packageJsonPath }) => [manifest.name, { manifest, packageJsonPath }]));
}

function isValidSemver(version) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    version,
  );
}

function isPrereleaseVersion(version) {
  return version.includes('-');
}

function isValidDistTag(distTag) {
  return /^[A-Za-z][A-Za-z0-9._-]*$/.test(distTag) && !isValidSemver(distTag);
}

function isPublishedVersion(packageName, version) {
  const result = spawnSync('npm', ['view', `${packageName}@${version}`, 'version', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0) {
    return true;
  }

  const stderr = `${result.stderr ?? ''}${result.stdout ?? ''}`;

  if (
    result.status === 1 &&
    (stderr.includes('E404') || stderr.includes('No match found for version') || stderr.includes('not in this registry'))
  ) {
    return false;
  }

  throw new Error(
    `Release readiness check failed: Unable to query npm for ${packageName}@${version}. ${stderr.trim() || 'npm view failed.'}`,
  );
}

function assertCheck(checks, label, condition, detail) {
  checks.push({ detail, label, pass: condition });

  if (!condition) {
    throw new Error(`Release readiness check failed: ${label}. ${detail}`);
  }
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

    const match = line.match(/^- `(@fluojs\/[^`]+)`$/);

    if (match) {
      packages.push(match[1]);
    }
  }

  return packages;
}

function parsePackageNamesFromFamilyTable(markdown, sectionTitle) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${sectionTitle}`);

  if (start < 0) {
    return [];
  }

  const packages = new Set();

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? '';

    if (line.startsWith('## ')) {
      break;
    }

    for (const match of line.matchAll(/`(@fluojs\/[^`]+)`/g)) {
      packages.add(match[1]);
    }
  }

  return [...packages].sort((left, right) => left.localeCompare(right));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function areSameStringArrays(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function workspacePackageNames() {
  const packagesDirectory = join(repoRoot, 'packages');
  const names = [];

  for (const entry of readdirSync(packagesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = join(packagesDirectory, entry.name, 'package.json');

    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

    if (typeof manifest.name === 'string') {
      names.push(manifest.name);
    }
  }

  return sorted(names);
}

function workspacePackageManifests() {
  const packagesDirectory = join(repoRoot, 'packages');
  const manifests = [];

  for (const entry of readdirSync(packagesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = join(packagesDirectory, entry.name, 'package.json');

    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

    if (typeof manifest.name === 'string') {
      manifests.push({
        manifest,
        packageJsonPath,
      });
    }
  }

  return manifests.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

function collectWorkspaceProtocolViolations(packageManifests, publicPackageNames) {
  const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];
  const publicPackageSet = new Set(publicPackageNames);
  const violations = [];
  const requiredRange = 'workspace:^';

  for (const { manifest, packageJsonPath } of packageManifests) {
    if (!publicPackageSet.has(manifest.name)) {
      continue;
    }

    for (const field of dependencyFields) {
      const dependencies = manifest[field];

      if (!dependencies || typeof dependencies !== 'object') {
        continue;
      }

      for (const [dependencyName, dependencyRange] of Object.entries(dependencies)) {
        if (
          dependencyName !== manifest.name &&
          publicPackageSet.has(dependencyName) &&
          dependencyRange !== requiredRange
        ) {
          violations.push(`${manifest.name} → ${dependencyName} in ${field}: ${String(dependencyRange)} (${packageJsonPath})`);
        }
      }
    }
  }

  return sorted(violations);
}

function collectSinglePackageDependencyShapeViolations(targetManifest, workspaceManifestMap, publicPackageNames) {
  const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies'];
  const publicPackageSet = new Set(publicPackageNames);
  const violations = [];

  for (const field of dependencyFields) {
    const dependencies = targetManifest[field];

    if (!dependencies || typeof dependencies !== 'object') {
      continue;
    }

    for (const [dependencyName, dependencyRange] of Object.entries(dependencies)) {
      if (!dependencyName.startsWith('@fluojs/')) {
        continue;
      }

      if (!workspaceManifestMap.has(dependencyName)) {
        violations.push(`${targetManifest.name} → ${dependencyName} in ${field}: not a workspace package name`);
        continue;
      }

      if (!publicPackageSet.has(dependencyName)) {
        violations.push(`${targetManifest.name} → ${dependencyName} in ${field}: dependency is outside the intended publish surface`);
        continue;
      }

      if (dependencyRange !== 'workspace:^') {
        violations.push(`${targetManifest.name} → ${dependencyName} in ${field}: expected workspace:^ but found ${String(dependencyRange)}`);
      }
    }
  }

  return sorted(violations);
}

function verifySinglePackageReleasePreflight(checks, options, packageManifests, publicPackageNames, dependencies = {}) {
  const { targetPackage, targetVersion, distTag } = options;

  if (!targetPackage && !targetVersion && !distTag) {
    return;
  }

  const manifestMap = workspaceManifestByName(packageManifests);
  const publicPackageSet = new Set(publicPackageNames);
  const registryVersionExists = dependencies.isPublishedVersion ?? isPublishedVersion;
  const targetPackageRecord = manifestMap.get(targetPackage);
  const targetPackagePath = packageRelativePath(targetPackage);
  const isPrerelease = isPrereleaseVersion(targetVersion);

  assertCheck(
    checks,
    'Single-package release target identity',
    typeof targetPackage === 'string' && targetPackage.length > 0,
    'Single-package release mode requires an explicit target package name.',
  );
  assertCheck(
    checks,
    'Single-package release target version',
    typeof targetVersion === 'string' && isValidSemver(targetVersion),
    'Single-package release mode requires a valid SemVer target version.',
  );
  assertCheck(
    checks,
    'Single-package release dist-tag',
    typeof distTag === 'string' && isValidDistTag(distTag),
    'Single-package release mode requires an npm dist-tag such as `latest`, `next`, `beta`, or `rc`.',
  );
  assertCheck(
    checks,
    'Single-package release prerelease alignment',
    (isPrerelease && distTag !== 'latest') || (!isPrerelease && distTag === 'latest'),
    isPrerelease
      ? 'Prerelease versions must publish under a non-`latest` dist-tag.'
      : 'Stable versions must publish under the `latest` dist-tag.',
  );
  assertCheck(
    checks,
    'Single-package release target workspace package',
    Boolean(targetPackageRecord) && Boolean(targetPackagePath),
    `The release target must match a workspace package manifest under packages/* (received ${targetPackage}).`,
  );
  assertCheck(
    checks,
    'Single-package release intended publish surface membership',
    Boolean(targetPackageRecord) && publicPackageSet.has(targetPackage),
    `${targetPackage} must be listed in docs/operations/release-governance.md intended publish surface before CI-only publish.`,
  );
  assertCheck(
    checks,
    'Single-package release public manifest contract',
    Boolean(targetPackageRecord) &&
      targetPackageRecord.manifest.private !== true &&
      targetPackageRecord.manifest.publishConfig?.access === 'public',
    `${targetPackage} must remain a public workspace package with publishConfig.access set to \`public\`.`,
  );
  assertCheck(
    checks,
    'Single-package release version publishability',
    !registryVersionExists(targetPackage, targetVersion),
    `${targetPackage}@${targetVersion} is already published on npm and cannot be republished.`,
  );

  const dependencyShapeViolations = targetPackageRecord
    ? collectSinglePackageDependencyShapeViolations(targetPackageRecord.manifest, manifestMap, publicPackageNames)
    : [];

  assertCheck(
    checks,
    'Single-package release internal dependency shape',
    dependencyShapeViolations.length === 0,
    dependencyShapeViolations.length === 0
      ? 'The target package only references intended public `@fluojs/*` packages through publish-safe `workspace:^` ranges.'
      : dependencyShapeViolations.join('; '),
  );
}

export function buildSummary(checks, sideEffectMode = 'none') {
  const sideEffects =
    sideEffectMode === 'drafts'
      ? '- Side effects: `CHANGELOG.md`, `tooling/release/release-readiness-summary.md`, and `tooling/release/release-readiness-summary.ko.md` updated'
      : sideEffectMode === 'summary'
        ? '- Side effects: current-run release-readiness summary artifacts generated without mutating `CHANGELOG.md`.'
        : '- Side effects: none by default; use `pnpm generate:release-readiness-drafts` to refresh draft artifacts explicitly.';
  const sideEffectsKo =
    sideEffectMode === 'drafts'
      ? '- 부수 효과: `CHANGELOG.md`, `tooling/release/release-readiness-summary.md`, `tooling/release/release-readiness-summary.ko.md` 갱신'
      : sideEffectMode === 'summary'
        ? '- 부수 효과: `CHANGELOG.md`를 변경하지 않고 현재 실행 기준의 release-readiness summary 산출물을 생성합니다.'
        : '- 부수 효과: 기본값은 없음; 초안 산출물을 갱신하려면 `pnpm generate:release-readiness-drafts`를 명시적으로 실행하세요.';
  const summary = [
    '# release readiness summary',
    '',
    languageToggle('en'),
    '',
    ...checks.map((check) => `- [${check.pass ? 'x' : ' '}] ${check.label} — ${check.detail}`),
    '',
    `- Commands executed: ${releaseReadinessVerificationCommands.join(', ')}`,
    sideEffects,
  ].join('\n');
  const summaryKo = [
    '# 릴리즈 준비도 검증 요약',
    '',
    languageToggle('ko'),
    '',
    ...checks.map((check) => `- [${check.pass ? 'x' : ' '}] ${check.label} — ${check.detail}`),
    '',
    `- 실행한 명령: ${releaseReadinessVerificationCommands.join(', ')}`,
    sideEffectsKo,
  ].join('\n');

  return { summary, summaryKo };
}

function writeSummary(checks, sideEffectMode, dependencies = {}) {
  const { mkdirSync: createDirectory = mkdirSync, writeFileSync: writeFile = writeFileSync } = dependencies;
  const outputDirectory = dependencies.outputDirectory ?? scriptDirectory;
  const { summaryPath: nextSummaryPath, summaryKoPath: nextSummaryKoPath } = resolveSummaryOutputPaths(outputDirectory);
  createDirectory(outputDirectory, { recursive: true });
  const { summary, summaryKo } = buildSummary(checks, sideEffectMode);
  writeFile(nextSummaryPath, `${summary}\n`, 'utf8');
  writeFile(nextSummaryKoPath, `${summaryKo}\n`, 'utf8');
}

export function withReleaseCandidateDraft(changelog, draftDate = new Date().toISOString().slice(0, 10)) {
  const startMarker = '<!-- release-readiness-draft:start -->';
  const endMarker = '<!-- release-readiness-draft:end -->';
  const draftBlock = [
    startMarker,
    `### Draft release readiness entry (${draftDate})`,
    '',
    '- Breaking changes:',
    '  - _Describe public contract changes and include migration notes._',
    '- New features by package:',
    '  - _List package-level additions (for example `@fluojs/http`, `@fluojs/cli`)._',
    '- Bug fixes:',
    '  - _List notable fixes by package._',
    '- Deprecations:',
    '  - _List newly deprecated APIs and removal timelines._',
    endMarker,
  ].join('\n');

  if (!changelog.includes('## [Unreleased]')) {
    throw new Error('Release readiness check failed: CHANGELOG.md must define an `## [Unreleased]` section.');
  }

  const blockRegex = /<!-- release-readiness-draft:start -->[\s\S]*?<!-- release-readiness-draft:end -->/;
  let next = changelog;

  if (blockRegex.test(changelog)) {
    next = changelog.replace(blockRegex, draftBlock);
  } else {
    next = changelog.replace('## [Unreleased]', `## [Unreleased]\n\n${draftBlock}`);
  }

  return next.endsWith('\n') ? next : `${next}\n`;
}

function upsertReleaseCandidateDraft(dependencies = {}) {
  const {
    existsSync: pathExists = existsSync,
    readFileSync: readFile = readFileSync,
    writeFileSync: writeFile = writeFileSync,
  } = dependencies;

  if (!pathExists(changelogPath)) {
    throw new Error('Release readiness check failed: CHANGELOG.md is missing at the repository root.');
  }

  const changelog = readFile(changelogPath, 'utf8');
  const next = withReleaseCandidateDraft(changelog);

  writeFile(changelogPath, next, 'utf8');
}

export function runReleaseReadinessVerification(options = {}, dependencies = {}) {
  const { distTag, summaryOutputDirectory, targetPackage, targetVersion, writeDrafts = false, writeSummary: shouldWriteSummary = false } = options;
  const {
    isPublishedVersion: registryVersionExists = isPublishedVersion,
    run: runCommand = run,
    read: readText = read,
    existsSync: pathExists = existsSync,
    workspacePackageNames: listWorkspacePackageNames = workspacePackageNames,
    workspacePackageManifests: listWorkspacePackageManifests = workspacePackageManifests,
    mkdirSync: createDirectory = mkdirSync,
    readFileSync: readFile = readFileSync,
    writeFileSync: writeFile = writeFileSync,
  } = dependencies;
  const checks = [];
  const packageManifests = listWorkspacePackageManifests();

  runCanonicalReleaseReadinessVerificationCommands(runCommand);

  const quickStart = readText('docs/getting-started/quick-start.md');
  const contributing = readText('CONTRIBUTING.md');
  const releaseGovernance = readText('docs/operations/release-governance.md');
  const packageSurface = readText('docs/reference/package-surface.md');
  const toolchainContract = readText('docs/reference/toolchain-contract-matrix.md');
  const cliReadme = readText('packages/cli/README.md');
  const scaffoldSource = readText('packages/cli/src/new/scaffold.ts');
  const cliPackage = JSON.parse(readText('packages/cli/package.json'));
  const changelog = readText('CHANGELOG.md');
  const governancePackageList = sorted(parsePackageListFromSection(releaseGovernance, 'intended publish surface'));
  const packageSurfaceList = parsePackageNamesFromFamilyTable(packageSurface, 'public package families');
  const workspacePackages = listWorkspacePackageNames();
  const publicWorkspaceProtocolViolations = collectWorkspaceProtocolViolations(
    packageManifests,
    governancePackageList,
  );

  assertCheck(
    checks,
    'Representative generated-project smoke suite',
    true,
    'Release readiness runs `pnpm --dir packages/cli sandbox:matrix` to verify install/build/test/generator flows for the default app, TCP microservice, and mixed starter baselines.',
  );
  assertCheck(
    checks,
    'Canonical bootstrap docs',
    quickStart.includes('pnpm add -g @fluojs/cli') &&
      quickStart.includes('fluo new my-fluo-app') &&
      quickStart.includes('The fluo CLI is your central tool for project scaffolding and component generation.'),
    'The quick start guide documents the public `pnpm add -g @fluojs/cli` + `fluo new` path.',
  );
  assertCheck(
    checks,
    'Repo-local smoke path docs',
    contributing.includes('pnpm sandbox:create') &&
      contributing.includes('pnpm sandbox:verify') &&
      contributing.includes('pnpm sandbox:test'),
    'The repo-local sandbox path is documented in CONTRIBUTING.md as monorepo verification support.',
  );
  assertCheck(
    checks,
    'Starter shape and runtime ownership',
    scaffoldSource.includes('const RuntimeHealthModule = createHealthModule();') &&
      scaffoldSource.includes('@Controller(\'/health-info\')') &&
      scaffoldSource.includes('const app = await FluoFactory.create(AppModule, {') &&
      scaffoldSource.includes('adapter: createFastifyAdapter({ port })') &&
      scaffoldSource.includes('await app.listen();') &&
      scaffoldSource.includes('createHealthModule') &&
      scaffoldSource.includes('createFastifyAdapter') &&
      !scaffoldSource.includes('MetricsModule.forRoot') &&
      !scaffoldSource.includes('OpenApiModule.forRoot') &&
      !scaffoldSource.includes('src/node-http-adapter.ts'),
    'The generated starter uses runtime-owned bootstrap helpers plus a starter-owned health module, without default metrics or OpenAPI surfaces.',
  );
  assertCheck(
    checks,
    'Generic-first bootstrap contract',
    !quickStart.includes('ORM') &&
      !quickStart.includes('Database') &&
      !scaffoldSource.includes('@fluojs/prisma') &&
      !scaffoldSource.includes('@fluojs/drizzle') &&
      !scaffoldSource.includes('@fluojs/mongoose') &&
      !scaffoldSource.includes('createTierNote'),
    'Bootstrap docs and scaffold source no longer encode ORM/DB prompts, support tiers, or starter-time ORM adapter injection.',
  );
  assertCheck(
    checks,
    'Toolchain contract lock',
    toolchainContract.includes('## generated app baseline') &&
      toolchainContract.includes('## CLI & scaffolding contracts') &&
      toolchainContract.includes('## naming conventions (CLI output)') &&
      toolchainContract.includes('fluo new') &&
      toolchainContract.includes('fluo inspect'),
    'The toolchain contract matrix documents the generated app baseline plus the canonical fluo command surfaces.',
  );
  assertCheck(
    checks,
    'Manifest benchmark evidence',
    releaseGovernance.includes('## intended publish surface') &&
      releaseGovernance.includes('pnpm verify:release-readiness') &&
      releaseGovernance.includes('pnpm verify:platform-consistency-governance'),
    'Release governance documents the canonical publish surface plus the companion automated release/governance gates.',
  );
  assertCheck(
    checks,
    'Dist-based package entrypoints',
    cliPackage.bin.fluo === './bin/fluo.mjs' &&
      cliPackage.bin.fluo === './bin/fluo.mjs' &&
      cliPackage.main === './dist/index.js' &&
      cliReadme.includes('canonical CLI'),
    'CLI manifest and bin prove a dist-backed public `fluo` entrypoint with a subordinate compatibility alias.',
  );
  assertCheck(
    checks,
    'Root OSS license file',
    pathExists(join(repoRoot, 'LICENSE')) || pathExists(join(repoRoot, 'LICENSE.md')),
    'A repository-level OSS license file exists at the root.',
  );
  assertCheck(
    checks,
    'Public changelog baseline',
    changelog.includes('# Changelog') && changelog.includes('## [Unreleased]') && changelog.includes('## [0.0.0]'),
    'CHANGELOG.md exists with Keep a Changelog baseline sections for Unreleased and current 0.x history.',
  );
  assertCheck(
    checks,
    'Public package surface docs are synchronized',
    governancePackageList.length > 0 &&
      packageSurfaceList.length > 0 &&
      areSameStringArrays(governancePackageList, packageSurfaceList),
    'release-governance and package-surface docs declare the same @fluojs public package list.',
  );
  assertCheck(
    checks,
    'Documented public packages exist in workspace',
    governancePackageList.every((packageName) => workspacePackages.includes(packageName)),
    'Every documented public package maps to an existing workspace package manifest.',
  );
  assertCheck(
    checks,
    'Public internal dependency ranges use workspace:^',
    publicWorkspaceProtocolViolations.length === 0,
    publicWorkspaceProtocolViolations.length === 0
      ? 'Intended public package manifests use `workspace:^` for internal `@fluojs/*` dependencies across dependency, optional, peer, and dev dependency fields.'
      : `Use exact \`workspace:^\` ranges for internal public package dependencies in: ${publicWorkspaceProtocolViolations.join('; ')}`,
  );
  verifySinglePackageReleasePreflight(checks, { distTag, targetPackage, targetVersion }, packageManifests, governancePackageList, {
    isPublishedVersion: registryVersionExists,
  });

  if (writeDrafts) {
    upsertReleaseCandidateDraft({ existsSync: pathExists, readFileSync: readFile, writeFileSync: writeFile });
    writeSummary(checks, 'drafts', { mkdirSync: createDirectory, outputDirectory: scriptDirectory, writeFileSync: writeFile });
  } else if (shouldWriteSummary) {
    writeSummary(checks, 'summary', {
      mkdirSync: createDirectory,
      outputDirectory: summaryOutputDirectory,
      writeFileSync: writeFile,
    });
  }

  return { checks, writeDrafts, writeSummary: shouldWriteSummary };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseCliOptions(argv);
  const result = runReleaseReadinessVerification(options);

  if (result.writeDrafts) {
    console.log(`Release readiness drafts written to ${summaryPath}, ${summaryKoPath}, and ${changelogPath}`);
  } else if (result.writeSummary) {
    const { summaryPath: nextSummaryPath, summaryKoPath: nextSummaryKoPath } = resolveSummaryOutputPaths(options.summaryOutputDirectory);
    console.log(`Release readiness summaries written to ${nextSummaryPath} and ${nextSummaryKoPath} without mutating ${changelogPath}`);
  } else {
    console.log('Release readiness checks passed without writing draft artifacts.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
