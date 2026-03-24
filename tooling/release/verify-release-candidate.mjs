import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const summaryPath = join(scriptDirectory, 'release-candidate-summary.md');
const summaryKoPath = join(scriptDirectory, 'release-candidate-summary.ko.md');
const changelogPath = join(repoRoot, 'CHANGELOG.md');

function languageToggle(current) {
  const english = current === 'en' ? '<strong><kbd>English</kbd></strong>' : '<a href="./release-candidate-summary.md"><kbd>English</kbd></a>';
  const korean = current === 'ko' ? '<strong><kbd>한국어</kbd></strong>' : '<a href="./release-candidate-summary.ko.md"><kbd>한국어</kbd></a>';
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
    throw new Error(`Release candidate check failed: ${label}. ${detail}`);
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

    const match = line.match(/^- `(@konekti\/[^`]+)`$/);

    if (match) {
      packages.push(match[1]);
    }
  }

  return packages;
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
    '# release candidate summary',
    '',
    languageToggle('en'),
    '',
    ...checks.map((check) => `- [${check.pass ? 'x' : ' '}] ${check.label} — ${check.detail}`),
    '',
    '- Commands executed: `pnpm typecheck`, `pnpm build`, `pnpm test`',
    '- Side effects: `CHANGELOG.md` draft release-candidate section updated',
  ].join('\n');
  const summaryKo = [
    '# 릴리즈 후보 검증 요약',
    '',
    languageToggle('ko'),
    '',
    ...checks.map((check) => `- [${check.pass ? 'x' : ' '}] ${check.label} — ${check.detail}`),
    '',
    '- 실행한 명령: `pnpm typecheck`, `pnpm build`, `pnpm test`',
    '- 부수 효과: `CHANGELOG.md` 릴리즈 후보 드래프트 섹션 갱신',
  ].join('\n');

  writeFileSync(summaryPath, `${summary}\n`, 'utf8');
  writeFileSync(summaryKoPath, `${summaryKo}\n`, 'utf8');
}

function upsertReleaseCandidateDraft() {
  if (!existsSync(changelogPath)) {
    throw new Error('Release candidate check failed: CHANGELOG.md is missing at the repository root.');
  }

  const changelog = readFileSync(changelogPath, 'utf8');
  const draftDate = new Date().toISOString().slice(0, 10);
  const startMarker = '<!-- release-candidate-draft:start -->';
  const endMarker = '<!-- release-candidate-draft:end -->';
  const draftBlock = [
    startMarker,
    `### Draft release candidate entry (${draftDate})`,
    '',
    '- Breaking changes:',
    '  - _Describe public contract changes and include migration notes._',
    '- New features by package:',
    '  - _List package-level additions (for example `@konekti/http`, `@konekti/cli`)._',
    '- Bug fixes:',
    '  - _List notable fixes by package._',
    '- Deprecations:',
    '  - _List newly deprecated APIs and removal timelines._',
    endMarker,
  ].join('\n');

  if (!changelog.includes('## [Unreleased]')) {
    throw new Error('Release candidate check failed: CHANGELOG.md must define an `## [Unreleased]` section.');
  }

  const blockRegex = /<!-- release-candidate-draft:start -->[\s\S]*?<!-- release-candidate-draft:end -->/;
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
const releaseGovernance = read('docs/operations/release-governance.md');
const packageSurface = read('docs/reference/package-surface.md');
const toolchainContract = read('docs/reference/toolchain-contract-matrix.md');
const cliReadme = read('packages/cli/README.md');
const scaffoldSource = read('packages/cli/src/new/scaffold.ts');
const cliPackage = JSON.parse(read('packages/cli/package.json'));
const changelog = read('CHANGELOG.md');
const governancePackageList = sorted(parsePackageListFromSection(releaseGovernance, 'intended publish surface'));
const packageSurfaceList = sorted(parsePackageListFromSection(packageSurface, 'public package family'));
const workspacePackages = workspacePackageNames();

assertCheck(
  checks,
  'Canonical bootstrap docs',
  quickStart.includes('pnpm dlx @konekti/cli new starter-app') && quickStart.includes('canonical public bootstrap flow'),
  'The quick start guide documents the public `pnpm add -g @konekti/cli` + `konekti new` path.',
);
assertCheck(
  checks,
  'Repo-local smoke path docs',
  cliReadme.includes('pnpm --dir packages/cli run sandbox:test') && cliReadme.includes('instead of publishing prereleases'),
  'The repo-local sandbox path is documented in the CLI README as monorepo-only verification support.',
);
assertCheck(
  checks,
  'Starter shape and runtime ownership',
  scaffoldSource.includes('runNodeApplication') &&
    scaffoldSource.includes('createHealthModule') &&
    scaffoldSource.includes("@Controller('/health-info')") &&
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
    !scaffoldSource.includes('@konekti/prisma') &&
    !scaffoldSource.includes('@konekti/drizzle') &&
    !scaffoldSource.includes('@konekti/mongoose') &&
    !scaffoldSource.includes('createTierNote'),
  'Bootstrap docs and scaffold source no longer encode ORM/DB prompts, support tiers, or starter-time ORM adapter injection.',
);
assertCheck(
  checks,
  'Toolchain contract lock',
  !toolchainContract.includes('to be locked') &&
    toolchainContract.includes('public contract') &&
    toolchainContract.includes('generated (stable)') &&
    toolchainContract.includes('internal-only'),
  'The toolchain contract matrix is locked with public/generated/internal statuses.',
);
assertCheck(
  checks,
  'Manifest benchmark evidence',
  releaseGovernance.includes('manifest decision note') && existsSync(join(repoRoot, 'tooling/benchmarks/manifest-decision.latest.json')),
  'Release docs still point at the benchmark-backed manifest decision snapshot.',
);
assertCheck(
  checks,
  'Dist-based package entrypoints',
  cliPackage.bin.konekti === './bin/konekti.mjs' &&
    cliPackage.main === './dist/index.js' &&
    cliReadme.includes('canonical CLI'),
  'CLI manifest and bin prove a dist-backed public entrypoint.',
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
  'release-governance and package-surface docs declare the same @konekti public package list.',
);
assertCheck(
  checks,
  'Documented public packages exist in workspace',
  governancePackageList.every((packageName) => workspacePackages.includes(packageName)),
  'Every documented public package maps to an existing workspace package manifest.',
);

writeSummary(checks);
console.log(`Release candidate summary written to ${summaryPath}`);
