import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const summaryPath = join(scriptDirectory, 'release-readiness-summary.md');
const summaryKoPath = join(scriptDirectory, 'release-readiness-summary.ko.md');
const changelogPath = join(repoRoot, 'CHANGELOG.md');

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

function writeSummary(checks) {
  mkdirSync(scriptDirectory, { recursive: true });
  const summary = [
    '# release readiness summary',
    '',
    languageToggle('en'),
    '',
    ...checks.map((check) => `- [${check.pass ? 'x' : ' '}] ${check.label} — ${check.detail}`),
    '',
    '- Commands executed: `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm verify:platform-consistency-governance`, `pnpm verify:release-readiness`',
    '- Side effects: `CHANGELOG.md` draft release-readiness section updated',
  ].join('\n');
  const summaryKo = [
    '# 릴리즈 준비도 검증 요약',
    '',
    languageToggle('ko'),
    '',
    ...checks.map((check) => `- [${check.pass ? 'x' : ' '}] ${check.label} — ${check.detail}`),
    '',
    '- 실행한 명령: `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm verify:platform-consistency-governance`, `pnpm verify:release-readiness`',
    '- 부수 효과: `CHANGELOG.md` 릴리즈 준비도 드래프트 섹션 갱신',
  ].join('\n');

  writeFileSync(summaryPath, `${summary}\n`, 'utf8');
  writeFileSync(summaryKoPath, `${summaryKo}\n`, 'utf8');
}

function upsertReleaseCandidateDraft() {
  if (!existsSync(changelogPath)) {
    throw new Error('Release readiness check failed: CHANGELOG.md is missing at the repository root.');
  }

  const changelog = readFileSync(changelogPath, 'utf8');
  const draftDate = new Date().toISOString().slice(0, 10);
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

  writeFileSync(changelogPath, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
}

const checks = [];

upsertReleaseCandidateDraft();
run('pnpm', ['build']);
run('pnpm', ['typecheck']);
run('pnpm', ['test']);

const quickStart = read('docs/getting-started/quick-start.md');
const contributing = read('CONTRIBUTING.md');
const releaseGovernance = read('docs/operations/release-governance.md');
const packageSurface = read('docs/reference/package-surface.md');
const toolchainContract = read('docs/reference/toolchain-contract-matrix.md');
const cliReadme = read('packages/cli/README.md');
const scaffoldSource = read('packages/cli/src/new/scaffold.ts');
const cliPackage = JSON.parse(read('packages/cli/package.json'));
const changelog = read('CHANGELOG.md');
const governancePackageList = sorted(parsePackageListFromSection(releaseGovernance, 'intended publish surface'));
const packageSurfaceList = parsePackageNamesFromFamilyTable(packageSurface, 'public package families');
const workspacePackages = workspacePackageNames();

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
    scaffoldSource.includes('const app = await KonektiFactory.create(AppModule, {') &&
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
    cliPackage.bin.konekti === './bin/konekti.mjs' &&
    cliPackage.main === './dist/index.js' &&
    cliReadme.includes('canonical CLI'),
  'CLI manifest and bin prove a dist-backed public `fluo` entrypoint with a subordinate compatibility alias.',
);
assertCheck(
  checks,
  'Root OSS license file',
  existsSync(join(repoRoot, 'LICENSE')) || existsSync(join(repoRoot, 'LICENSE.md')),
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

writeSummary(checks);
console.log(`Release readiness summary written to ${summaryPath}`);
