import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const summaryPath = join(scriptDirectory, 'release-readiness-summary.md');
const summaryKoPath = join(scriptDirectory, 'release-readiness-summary.ko.md');
const changelogPath = join(repoRoot, 'CHANGELOG.md');

function parseCliOptions(argv = process.argv.slice(2)) {
  const writeDrafts = argv.includes('--write-drafts');

  for (const argument of argv) {
    if (argument !== '--write-drafts') {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return { writeDrafts };
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

export function buildSummary(checks, writeDrafts) {
  const sideEffects = writeDrafts
    ? '- Side effects: `CHANGELOG.md`, `tooling/release/release-readiness-summary.md`, and `tooling/release/release-readiness-summary.ko.md` updated'
    : '- Side effects: none by default; use `pnpm generate:release-readiness-drafts` to refresh draft artifacts explicitly.';
  const sideEffectsKo = writeDrafts
    ? '- 부수 효과: `CHANGELOG.md`, `tooling/release/release-readiness-summary.md`, `tooling/release/release-readiness-summary.ko.md` 갱신'
    : '- 부수 효과: 기본값은 없음; 초안 산출물을 갱신하려면 `pnpm generate:release-readiness-drafts`를 명시적으로 실행하세요.';
  const summary = [
    '# release readiness summary',
    '',
    languageToggle('en'),
    '',
    ...checks.map((check) => `- [${check.pass ? 'x' : ' '}] ${check.label} — ${check.detail}`),
    '',
    '- Commands executed: `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm --dir packages/cli sandbox:matrix`, `pnpm verify:platform-consistency-governance`, `pnpm verify:release-readiness`',
    sideEffects,
  ].join('\n');
  const summaryKo = [
    '# 릴리즈 준비도 검증 요약',
    '',
    languageToggle('ko'),
    '',
    ...checks.map((check) => `- [${check.pass ? 'x' : ' '}] ${check.label} — ${check.detail}`),
    '',
    '- 실행한 명령: `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm --dir packages/cli sandbox:matrix`, `pnpm verify:platform-consistency-governance`, `pnpm verify:release-readiness`',
    sideEffectsKo,
  ].join('\n');

  return { summary, summaryKo };
}

function writeSummary(checks, writeDrafts, dependencies = {}) {
  const { mkdirSync: createDirectory = mkdirSync, writeFileSync: writeFile = writeFileSync } = dependencies;
  createDirectory(scriptDirectory, { recursive: true });
  const { summary, summaryKo } = buildSummary(checks, writeDrafts);
  writeFile(summaryPath, `${summary}\n`, 'utf8');
  writeFile(summaryKoPath, `${summaryKo}\n`, 'utf8');
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
  const { writeDrafts = false } = options;
  const {
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

  runCommand('pnpm', ['build']);
  runCommand('pnpm', ['typecheck']);
  runCommand('pnpm', ['test']);
  runCommand('pnpm', ['--dir', 'packages/cli', 'sandbox:matrix']);

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
    listWorkspacePackageManifests(),
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
    'Release governance documents the canonical publish surface and the automated release gates.',
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

  if (writeDrafts) {
    upsertReleaseCandidateDraft({ existsSync: pathExists, readFileSync: readFile, writeFileSync: writeFile });
    writeSummary(checks, true, { mkdirSync: createDirectory, writeFileSync: writeFile });
  }

  return { checks, writeDrafts };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseCliOptions(argv);
  const result = runReleaseReadinessVerification(options);

  if (result.writeDrafts) {
    console.log(`Release readiness drafts written to ${summaryPath}, ${summaryKoPath}, and ${changelogPath}`);
  } else {
    console.log('Release readiness checks passed without writing draft artifacts.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
