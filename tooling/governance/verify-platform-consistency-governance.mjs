import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enforceAdvancedBookCoreBoundaryCompanions } from './advanced-book-core-boundary.mjs';
import { enforceConfigNestjsMigrationDocs } from './config-nestjs-migration-docs.mjs';
import {
  enforceMicroservicesSafetyGuidanceParity,
  enforceMicroservicesSafetyRuntimeEvidence,
} from './microservices-safety-guidance.mjs';

export { enforceAdvancedBookCoreBoundaryCompanions } from './advanced-book-core-boundary.mjs';
export {
  enforceMicroservicesSafetyGuidanceParity,
  enforceMicroservicesSafetyRuntimeEvidence,
} from './microservices-safety-guidance.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const directProcessEnvPattern = /\bprocess\s*(?:\?\.|\.)\s*env\b/g;
const nodeGlobalBufferPattern = /\bBuffer\b/g;

const ssotPairs = [
  ['docs/CONTEXT.md', 'docs/CONTEXT.ko.md'],
  ['docs/architecture/http-catch-all-route-grammar.md', 'docs/architecture/http-catch-all-route-grammar.ko.md'],
  ['docs/architecture/platform-consistency-design.md', 'docs/architecture/platform-consistency-design.ko.md'],
  ['docs/contracts/behavioral-contract-policy.md', 'docs/contracts/behavioral-contract-policy.ko.md'],
  ['docs/contracts/public-export-tsdoc-baseline.md', 'docs/contracts/public-export-tsdoc-baseline.ko.md'],
  ['docs/contracts/release-governance.md', 'docs/contracts/release-governance.ko.md'],
  ['docs/contracts/platform-conformance-authoring-checklist.md', 'docs/contracts/platform-conformance-authoring-checklist.ko.md'],
  ['docs/reference/package-folder-structure.md', 'docs/reference/package-folder-structure.ko.md'],
  ['docs/reference/package-surface.md', 'docs/reference/package-surface.ko.md'],
];

const contractGateTriggers = new Set([
  'docs/architecture/http-catch-all-route-grammar.md',
  'docs/architecture/http-catch-all-route-grammar.ko.md',
  'docs/architecture/platform-consistency-design.md',
  'docs/architecture/platform-consistency-design.ko.md',
  'docs/contracts/behavioral-contract-policy.md',
  'docs/contracts/behavioral-contract-policy.ko.md',
  'docs/contracts/public-export-tsdoc-baseline.md',
  'docs/contracts/public-export-tsdoc-baseline.ko.md',
  'docs/contracts/release-governance.md',
  'docs/contracts/release-governance.ko.md',
  'docs/contracts/platform-conformance-authoring-checklist.md',
  'docs/contracts/platform-conformance-authoring-checklist.ko.md',
  'docs/architecture/observability.md',
  'docs/architecture/observability.ko.md',
  'docs/architecture/lifecycle-and-shutdown.md',
  'docs/architecture/lifecycle-and-shutdown.ko.md',
  'docs/architecture/http-runtime.md',
  'docs/architecture/http-runtime.ko.md',
  'docs/contracts/deployment.md',
  'docs/contracts/deployment.ko.md',
  'docs/contracts/nestjs-parity-gaps.md',
  'docs/contracts/nestjs-parity-gaps.ko.md',
  // Includes Bun fetch-style lifecycle, synchronous manual fetch-host ownership,
  // pre-listen realtime binding, WebSocket runtime-subpath/return-value, and
  // metadata migration boundaries.
  'apps/docs/content/docs/guides/realtime.mdx',
  'apps/docs/content/docs/guides/realtime.ko.mdx',
  'apps/docs/content/docs/guides/runtime-adapters.mdx',
  'apps/docs/content/docs/guides/runtime-adapters.ko.mdx',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'docs/architecture/transactions.md',
  'docs/architecture/transactions.ko.md',
  'docs/reference/package-chooser.md',
  'docs/reference/package-chooser.ko.md',
  'docs/reference/package-folder-structure.md',
  'docs/reference/package-folder-structure.ko.md',
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
  '@fluojs/platform-fastify',
  '@fluojs/platform-express',
  '@fluojs/websockets',
  '@fluojs/socket.io',
  '@fluojs/platform-bun',
  '@fluojs/platform-deno',
  '@fluojs/platform-cloudflare-workers',
];

export function getOfficialTransportDocsPackages() {
  return [...officialTransportDocsPackages];
}

const packageSourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts']);

const directProcessEnvAllowedPackageSourcePaths = new Set([
  'packages/cli/src/cli.ts',
  'packages/cli/src/new/scaffold.ts',
]);

const denoAndCloudflareWorkerServiceSourcePaths = new Set([
  'packages/websockets/src/deno/deno-service.ts',
  'packages/websockets/src/cloudflare-workers/cloudflare-workers-service.ts',
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

export function changedFilesFromGit(runCommand = run, env = process.env) {
  const preferredBase = env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : 'origin/main';
  const mergeBaseResult = runCommand('git', ['merge-base', 'HEAD', preferredBase], { allowFailure: true });

  if (mergeBaseResult.status === 0 && mergeBaseResult.stdout.trim().length > 0) {
    const mergeBase = mergeBaseResult.stdout.trim();
    const diffResult = runCommand('git', ['diff', '--name-only', `${mergeBase}...HEAD`], { allowFailure: true });

    if (diffResult.status !== 0) {
      throw new Error(
        'Platform consistency governance check failed: unable to compute changed files from git diff. Ensure CI fetches full history before running pnpm verify:platform-consistency-governance.',
      );
    }

    const changedFiles = diffResult.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    for (const args of [
      ['diff', '--name-only'],
      ['diff', '--name-only', '--cached'],
      ['ls-files', '--others', '--exclude-standard'],
    ]) {
      const workingTreeResult = runCommand('git', args, { allowFailure: true });
      if (workingTreeResult.status !== 0) {
        throw new Error(
          'Platform consistency governance check failed: unable to compute working tree changed files. Ensure git status is readable before running pnpm verify:platform-consistency-governance.',
        );
      }

      changedFiles.push(
        ...workingTreeResult.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      );
    }

    return [...new Set(changedFiles)].sort((left, right) => left.localeCompare(right));
  }

  throw new Error(
    `Platform consistency governance check failed: unable to compute merge-base with ${preferredBase}. Ensure CI fetches full history before running pnpm verify:platform-consistency-governance.`,
  );
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
  const normalizeSectionHeading = (value) =>
    value
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/[()]/g, ' ')
      .replace(/\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/[^#a-z0-9\-\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const normalizedSectionTitle = normalizeSectionHeading(sectionTitle);
  const start = lines.findIndex((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('## ')) {
      return false;
    }

    return normalizeSectionHeading(trimmed.replace(/^##\s*/, '')) === normalizedSectionTitle;
  });

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

  return packages.sort((left, right) => left.localeCompare(right));
}

export function parsePackageNamesFromFamilyTable(markdown, sectionTitle) {
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

    for (const match of line.matchAll(/`(@(?:fluojs|fluo)\/[^`]+)`/g)) {
      packages.add(match[1]);
    }
  }

  return [...packages].sort((left, right) => left.localeCompare(right));
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

      if (!['.md', '.mdx'].includes(extname(entry.name))) {
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

export function collectNodeGlobalBufferViolations(relativePaths, readSource) {
  const violations = [];

  for (const relativePath of relativePaths) {
    if (!denoAndCloudflareWorkerServiceSourcePaths.has(relativePath)) {
      continue;
    }

    const source = readSource(relativePath);
    nodeGlobalBufferPattern.lastIndex = 0;

    for (const match of source.matchAll(nodeGlobalBufferPattern)) {
      const matchIndex = match.index ?? 0;
      const lineNumber = findLineNumberFromIndex(source, matchIndex);
      const excerpt = source.split('\n')[lineNumber - 1]?.trim() ?? 'Buffer';

      violations.push({
        excerpt,
        line: lineNumber,
        path: relativePath,
      });
    }
  }

  return violations;
}

export function enforceNoNodeGlobalBufferInDenoAndCloudflareWorkerServices(
  relativePaths = [...denoAndCloudflareWorkerServiceSourcePaths],
  readSource = read,
) {
  const violations = collectNodeGlobalBufferViolations(relativePaths, readSource);
  assert(
    violations.length === 0,
    [
      'Deno and Cloudflare Workers service source files must not use the Node.js global Buffer.',
      'Use TextEncoder / TextDecoder or other Web-standard API equivalents instead.',
      `Governed paths: ${[...denoAndCloudflareWorkerServiceSourcePaths].join(', ')}.`,
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

export function enforceContractCompanionUpdates(changedFiles) {
  const touchedContractGate = changedFiles.some((path) => contractGateTriggers.has(path));

  if (!touchedContractGate) {
    return;
  }

  // Contract-governing docs must remain discoverable from the docs hub, and any
  // such discoverability updates should stay coupled to this governance rule so
  // future contract-boundary edits do not silently bypass the companion checks.
  // Updating this script is the CI/tooling companion for branches that extend
  // the contract-governing documentation surface, including package-surface
  // transaction boundary and observability ownership updates that must stay
  // paired with runtime tests, such as Prisma branded transaction target
  // resolution, ALS host lookup fail-closed coverage, service-decorator shutdown
  // drain, concurrent multi-container context isolation, explicit request signal
  // forwarding, facade/wrapper responsibility, fail-open rollback limits, and
  // non-contract replica routing/transaction telemetry claims, Drizzle shutdown-drain
  // coverage for fail-open manual transactions, Drizzle decorated-instance
  // transaction target fallback discoverability, Mongoose ALS session/request
  // tracking, fail-open manual transaction drain, plus runtime-boundary docs,
  // raw Node.js adapter type/runtime-floor and retry/body-limit/shutdown
  // regression coverage, Cloudflare Workers adapter public seam and lifecycle
  // shutdown docs, metrics shared-registry HTTP collector or platform telemetry
  // stale-series ownership docs, and email
  // transport-agnostic status snapshots plus caller-owned shutdown boundaries,
  // validation mapped-type/nested-materialization contract discoverability,
  // missing-value, safe-extra-property, and unsupported-group migration rules,
  // serialization class options, committed-response ownership bypass, and
  // request-boundary interceptor coverage, CLI
  // public runtime type boundaries plus the documented Node.js runtime floor,
  // and Studio live helper contracts such as deterministic Mermaid rendering,
  // route-id graph correlation, viewer dependency classification, and Node.js
  // tooling runtime-floor discoverability, plus Cron distributed-lock
  // lifecycle contracts such as enabled TTL validation before Redis I/O,
  // bounded shutdown lock-release I/O, timeout ownership retention, dynamic
  // blank-name rejection, immutable registry descriptor snapshots, and
  // microservices facade shutdown signal forwarding plus transport-owned
  // cancellation cleanup docs/tests, Queue's package-level Node.js runtime
  // floor discoverability and Queue migration from NestJS/Bull processor metadata
  // to explicit singleton worker registration, jobName/payload cutover, and
  // bootstrap-ready/bounded-shutdown ownership, notifications queue opt-in, status
  // details, and generated identity diagnostics contracts, plus Slack singleton
  // provider discoverability and owned transport cleanup serialization docs/tests,
  // plus CQRS provider-token fan-out, private immutable dispatch topology state,
  // full handler/saga/delegated pipeline ordering, and shutdown authorization,
  // plus event-bus background handler/transport shutdown drain, inbound timeout,
  // stable eventKey migration, and CQRS responsibility-boundary docs/tests,
  // plus React Router/Path facade-over-HTTP metadata, ReactModule.forRoot
  // registration contract discoverability, stable SSR phase boundaries,
  // isolated Vite/client subpaths, HTTP-first full-document navigation, and
  // the root package's non-goals for client route tables, caches, and RSC,
  // plus OpenAPI's
  // explicit descriptor adoption, response metadata, Swagger UI asset, and
  // path/method collision-precedence boundaries, plus GraphQL's explicit
  // resolver/provider wiring, root-only operations, output type declarations,
  // Node.js runtime-floor/dependency alignment, unsupported non-Node targets,
  // and server-backed WebSocket migration boundaries, plus JWT refresh-token
  // family-scoped reuse revocation, subject-wide compatibility fallback, and
  // consume-only rotation regression coverage.

  assert(
    hasChanged(changedFiles, 'docs/CONTEXT.md') && hasChanged(changedFiles, 'docs/CONTEXT.ko.md'),
    'contract-governing doc updates must include docs/CONTEXT.md and docs/CONTEXT.ko.md discoverability updates.',
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

  // Microservices transport ownership, root/subpath export exceptions, lazy-load,
  // payload clone, TCP 1 MiB frames, port:0 routing, shutdown send guards, and
  // gRPC abort-listener cleanup docs are also covered by this companion path.
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
  const releaseGovernance = readFileSync(join(repoRoot, 'docs/contracts/release-governance.md'), 'utf8');
  const releaseGovernanceKo = readFileSync(join(repoRoot, 'docs/contracts/release-governance.ko.md'), 'utf8');

  const englishPublishSurface = parsePackageListFromSection(releaseGovernance, 'intended publish surface');
  const koreanPublishSurface = parsePackageListFromSection(releaseGovernanceKo, 'intended publish surface');

  assert(englishPublishSurface.length > 0, 'release-governance.md must define an intended publish surface list.');
  assert(koreanPublishSurface.length > 0, 'release-governance.ko.md must define an intended publish surface list.');
  assert(
    areSameStringArrays(englishPublishSurface, koreanPublishSurface),
    'release-governance.md and release-governance.ko.md must declare the same intended publish surface package list.',
  );
}

function enforceCanonicalPackageSurfaceSync() {
  const releaseGovernance = readFileSync(join(repoRoot, 'docs/contracts/release-governance.md'), 'utf8');
  const packageSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
  const packageSurfaceKo = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');

  const intendedPublishSurface = parsePackageListFromSection(releaseGovernance, 'intended publish surface');
  const englishPackageSurface = parsePackageNamesFromFamilyTable(packageSurface, 'public package families');
  const koreanPackageSurface = parsePackageNamesFromFamilyTable(packageSurfaceKo, '공개 패키지 패밀리');

  assert(intendedPublishSurface.length > 0, 'release-governance.md must define an intended publish surface list.');
  assert(englishPackageSurface.length > 0, 'package-surface.md must enumerate public @fluojs packages in its family table.');
  assert(koreanPackageSurface.length > 0, 'package-surface.ko.md must enumerate public @fluojs packages in its family table.');
  assert(
    areSameStringArrays(intendedPublishSurface, englishPackageSurface),
    'docs/reference/package-surface.md must stay synchronized with docs/contracts/release-governance.md intended publish surface.',
  );
  assert(
    areSameStringArrays(englishPackageSurface, koreanPackageSurface),
    'docs/reference/package-surface.md and docs/reference/package-surface.ko.md must declare the same public package family inventory.',
  );
}

function enforceDocsHubOfficialTransportLinks() {
  const docsContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const docsContextKo = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const packageSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');

  for (const packageName of officialTransportDocsPackages) {
    if (!packageSurface.includes(`- \`${packageName}\``)) {
      continue;
    }

    assert(
      docsContext.includes(packageName),
      `docs/CONTEXT.md must mention ${packageName} when it is part of the official transport package set.`,
    );
    assert(
      docsContextKo.includes(packageName),
      `docs/CONTEXT.ko.md must mention ${packageName} when it is part of the official transport package set.`,
    );
  }
}

const cloudflareWorkersLifecycleDocRequirements = [
  ['packages/platform-cloudflare-workers/README.md', ['CloudflareWorkersWebSocketModule.forRoot()', 'app.listen()', 'timed-out close']],
  ['packages/platform-cloudflare-workers/README.ko.md', ['CloudflareWorkersWebSocketModule.forRoot()', 'app.listen()', 'timed-out close']],
  ['docs/reference/package-surface.md', ['executionContext.waitUntil(...)', 'underlying drain', 'bootstrap a fresh application']],
  ['docs/reference/package-surface.ko.md', ['executionContext.waitUntil(...)', 'underlying drain', '새 application을 bootstrap']],
  ['book/intermediate/ch24-cloudflare.md', ['CloudflareWorkersWebSocketModule.forRoot()', 'ctx.waitUntil()', 'underlying drain']],
  ['book/intermediate/ch24-cloudflare.ko.md', ['CloudflareWorkersWebSocketModule.forRoot()', 'ctx.waitUntil()', 'underlying drain']],
  ['docs/getting-started/migrate-from-nestjs.md', ['fetch(request, env, ctx)', 'CloudflareWorkersWebSocketModule.forRoot()', 'ctx.waitUntil(...)', '@fluojs/config']],
  ['docs/getting-started/migrate-from-nestjs.ko.md', ['fetch(request, env, ctx)', 'CloudflareWorkersWebSocketModule.forRoot()', 'ctx.waitUntil(...)', '@fluojs/config']],
  ['apps/docs/content/docs/guides/runtime-adapters.mdx', ['CloudflareWorkersWebSocketModule.forRoot()', 'executionContext.waitUntil(...)', 'request.cloudflare.env', 'underlying drain']],
  ['apps/docs/content/docs/guides/runtime-adapters.ko.mdx', ['CloudflareWorkersWebSocketModule.forRoot()', 'executionContext.waitUntil(...)', 'request.cloudflare.env', 'underlying drain']],
  ['apps/docs/content/docs/guides/realtime.mdx', ['CloudflareWorkersWebSocketModule.forRoot()', 'executionContext.waitUntil(...)', 'JSON `503`']],
  ['apps/docs/content/docs/guides/realtime.ko.mdx', ['CloudflareWorkersWebSocketModule.forRoot()', 'executionContext.waitUntil(...)', 'JSON `503`']],
  ['docs/CONTEXT.md', ['packages/platform-cloudflare-workers/README.md', 'docs/getting-started/migrate-from-nestjs.md', 'website runtime/realtime guides']],
  ['docs/CONTEXT.ko.md', ['packages/platform-cloudflare-workers/README.ko.md', 'docs/getting-started/migrate-from-nestjs.ko.md', 'website runtime/realtime guide']],
];

const serializerResponseOwnershipDocRequirements = [
  [
    'packages/serialization/README.md',
    [
      'Framework-managed response',
      'Handler-owned response',
      'returns the value it received from `next.handle()` unchanged',
      'interceptors may still transform the chain result',
      'skips a second success-response write',
    ],
  ],
  [
    'packages/serialization/README.ko.md',
    [
      'Framework-managed response',
      'Handler-owned response',
      '`next.handle()`에서 받은 값을 그대로 반환',
      '다른 interceptor는 chain 결과를 계속 변환할 수 있',
      '두 번째 success-response write를 건너',
    ],
  ],
  [
    'packages/runtime/README.md',
    [
      'Framework-Managed and Handler-Owned Responses',
      'returns the value it received from `next.handle()` unchanged',
      'interceptors may still transform the chain result',
      'skips a second success-response write',
    ],
  ],
  [
    'packages/runtime/README.ko.md',
    [
      'Framework-managed response와 handler-owned response',
      '`next.handle()`에서 받은 값을 그대로 반환',
      '다른 interceptor는 chain 결과를 계속 변환할 수 있',
      '두 번째 success-response write를 건너',
    ],
  ],
  [
    'book/beginner/ch07-serialization.md',
    [
      'Framework-Managed vs Handler-Owned Responses',
      'returns the value it received from `next.handle()` unchanged',
      'interceptors may still transform the chain result',
      'skips a second success-response write',
    ],
  ],
  [
    'book/beginner/ch07-serialization.ko.md',
    [
      'Framework-managed response와 handler-owned response',
      '`next.handle()`에서 받은 값을 그대로 반환',
      '다른 interceptor는 chain 결과를 계속 변환할 수 있',
      '두 번째 success-response write를 건너',
    ],
  ],
  [
    'docs/getting-started/migrate-from-nestjs.md',
    [
      '`ClassSerializerInterceptor`',
      'returns the value it received from `next.handle()` unchanged',
      'interceptors may still transform the chain result',
      'skips a second success-response write',
    ],
  ],
  [
    'docs/getting-started/migrate-from-nestjs.ko.md',
    [
      '`ClassSerializerInterceptor`',
      '`next.handle()`에서 받은 값을 그대로 반환',
      '다른 interceptor는 chain 결과를 계속 변환할 수 있',
      '두 번째 success-response write를 건너',
    ],
  ],
  [
    'docs/CONTEXT.md',
    [
      'Serialization response-ownership discoverability',
      'returns the value it received from `next.handle()` unchanged',
      'interceptors may still transform the chain result',
      'skips a second success-response write',
    ],
  ],
  [
    'docs/CONTEXT.ko.md',
    [
      'Serialization response-ownership discoverability',
      '`next.handle()`에서 받은 값을 그대로 반환',
      '다른 interceptor는 chain 결과를 계속 변환할 수 있',
      '두 번째 success-response write를 건너',
    ],
  ],
  [
    'docs/reference/package-surface.md',
    [
      'returns the value it received from `next.handle()` unchanged',
      'interceptors may still transform the chain result',
      'skips a second success-response write',
    ],
  ],
  [
    'docs/reference/package-surface.ko.md',
    [
      '`next.handle()`에서 받은 값을 그대로 반환',
      '다른 interceptor는 chain 결과를 계속 변환할 수 있',
      '두 번째 success-response write를 건너',
    ],
  ],
];

const serializerResponseOwnershipBroadChainClaims = [
  /interceptor chain[^.\n]*(?:preserves?|keeps?)[^.\n]*handler(?:-owned)? (?:return )?values?[^.\n]*unchanged/iu,
  /interceptor chain[^.\n]*handler(?:-owned)? 반환값[^.\n]*(?:변경하지 않고 보존|그대로 보존)/u,
];

export function enforceSerializerResponseOwnershipDocsSync(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of serializerResponseOwnershipDocRequirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    assert(
      missingMarkers.length === 0,
      `${relativePath} must keep serializer response ownership guidance synchronized; missing: ${missingMarkers.join(', ')}.`,
    );

    assert(
      serializerResponseOwnershipBroadChainClaims.every((pattern) => !pattern.test(content)),
      `${relativePath} must not claim that the interceptor chain preserves handler return values; only SerializerInterceptor returns the value it receives unchanged, while other interceptors may transform it.`,
    );
  }
}

export function enforceCloudflareWorkersLifecycleDocsSync(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of cloudflareWorkersLifecycleDocRequirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    assert(
      missingMarkers.length === 0,
      `${relativePath} must keep Cloudflare Workers lifecycle and migration guidance synchronized; missing: ${missingMarkers.join(', ')}.`,
    );
  }
}

const expressRuntimeMigrationDocRequirements = [
  [
    'packages/platform-express/README.md',
    ['Node.js 20 or newer', 'engines.node >=20.0.0', 'TC39 standard decorators', 'explicit module/provider registration'],
  ],
  [
    'packages/platform-express/README.ko.md',
    ['Node.js 20 이상', 'engines.node >=20.0.0', 'TC39 표준 데코레이터', '명시적 module/provider registration'],
  ],
  [
    'docs/reference/package-surface.md',
    ['Node.js 20+', 'engines.node >=20.0.0', 'TC39 standard decorator', 'explicit DI/module wiring'],
  ],
  [
    'docs/reference/package-surface.ko.md',
    ['Node.js 20+', 'engines.node >=20.0.0', 'TC39 표준 데코레이터', '명시적 DI/module wiring'],
  ],
  [
    'docs/reference/package-chooser.md',
    ['Node.js 20+', 'engines.node >=20.0.0', 'TC39 standard decorators', 'explicit DI/module wiring'],
  ],
  [
    'docs/reference/package-chooser.ko.md',
    ['Node.js 20+', 'engines.node >=20.0.0', 'TC39 표준 데코레이터', '명시적 DI/module wiring'],
  ],
  [
    'docs/getting-started/migrate-from-nestjs.md',
    ['Node.js 20+', 'TC39 standard decorators', 'class-level `@Inject(...)`', 'explicit module/provider registration'],
  ],
  [
    'docs/getting-started/migrate-from-nestjs.ko.md',
    ['Node.js 20+', 'TC39 표준 데코레이터', 'class-level `@Inject(...)`', '명시적 module/provider registration'],
  ],
  [
    'book/intermediate/ch21-express-node.md',
    ['Node.js 20 or newer', 'engines.node >=20.0.0', 'getListenTarget()', 'explicit DI/module wiring'],
  ],
  [
    'book/intermediate/ch21-express-node.ko.md',
    ['Node.js 20 이상', 'engines.node >=20.0.0', 'getListenTarget()', '명시적 DI/module wiring'],
  ],
  [
    'apps/docs/content/docs/guides/runtime-adapters.mdx',
    ['Node.js 20 or newer', 'engines.node >=20.0.0', 'getListenTarget()', 'explicit DI/module wiring'],
  ],
  [
    'apps/docs/content/docs/guides/runtime-adapters.ko.mdx',
    ['Node.js 20 이상', 'engines.node >=20.0.0', 'getListenTarget()', '명시적 DI/module wiring'],
  ],
  [
    'docs/CONTEXT.md',
    ['Node.js 20+', 'engines.node >=20.0.0', 'getListenTarget()', 'explicit DI/module wiring'],
  ],
  [
    'docs/CONTEXT.ko.md',
    ['Node.js 20+', 'engines.node >=20.0.0', 'getListenTarget()', '명시적 DI/module wiring'],
  ],
];

const expressListenTargetExamplePaths = [
  'book/intermediate/ch21-express-node.md',
  'book/intermediate/ch21-express-node.ko.md',
  'apps/docs/content/docs/guides/runtime-adapters.mdx',
  'apps/docs/content/docs/guides/runtime-adapters.ko.mdx',
];

function includesMarkersInOrder(content, markers) {
  let offset = 0;

  return markers.every((marker) => {
    const index = content.indexOf(marker, offset);
    if (index === -1) {
      return false;
    }

    offset = index + marker.length;
    return true;
  });
}

function includesTypeCorrectExpressListenTargetExample(content) {
  const typedCodeFence = /```(?:ts|typescript)\r?\n([\s\S]*?)```/g;

  return Array.from(content.matchAll(typedCodeFence), (match) => match[1] ?? '').some((code) =>
    includesMarkersInOrder(code, [
      'createExpressAdapter,',
      'ExpressHttpApplicationAdapter,',
      'const adapter = createExpressAdapter(',
      'adapter instanceof ExpressHttpApplicationAdapter',
      'adapter.getListenTarget()',
    ]),
  );
}

export function enforceExpressRuntimeMigrationDocsSync(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of expressRuntimeMigrationDocRequirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    assert(
      missingMarkers.length === 0,
      `${relativePath} must keep the Express Node.js runtime floor, infrastructure helpers, and NestJS migration boundary synchronized; missing: ${missingMarkers.join(', ')}.`,
    );
  }

  const adapterSourcePath = 'packages/platform-express/src/adapter.ts';
  const adapterSource = readText(adapterSourcePath);
  const factoryStart = adapterSource.indexOf('export function createExpressAdapter(');
  const nextExport = factoryStart === -1 ? -1 : adapterSource.indexOf('\nexport ', factoryStart + 1);
  const factorySource =
    factoryStart === -1 ? '' : adapterSource.slice(factoryStart, nextExport === -1 ? undefined : nextExport);
  assert(
    adapterSource.includes('export class ExpressHttpApplicationAdapter implements HttpApplicationAdapter {') &&
      includesMarkersInOrder(factorySource, [
        'export function createExpressAdapter(',
        '): HttpApplicationAdapter {',
        'return new ExpressHttpApplicationAdapter(',
      ]),
    `${adapterSourcePath} must keep createExpressAdapter() on the shared HttpApplicationAdapter public return type while constructing the exported ExpressHttpApplicationAdapter implementation.`,
  );

  for (const relativePath of expressListenTargetExamplePaths) {
    const content = readText(relativePath);
    assert(
      includesTypeCorrectExpressListenTargetExample(content),
      `${relativePath} must narrow createExpressAdapter() from its shared HttpApplicationAdapter return type to the public ExpressHttpApplicationAdapter implementation before calling getListenTarget().`,
    );
  }
}

function enforceCanonicalRuntimeMatrixReferences() {
  const packageSurface = readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8');
  const packageSurfaceKo = readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8');
  const packageChooser = readFileSync(join(repoRoot, 'docs/reference/package-chooser.md'), 'utf8');
  const packageChooserKo = readFileSync(join(repoRoot, 'docs/reference/package-chooser.ko.md'), 'utf8');
  const docsContext = readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8');
  const docsContextKo = readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8');
  const rootReadme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
  const rootReadmeKo = readFileSync(join(repoRoot, 'README.ko.md'), 'utf8');
  const coreReadme = readFileSync(join(repoRoot, 'packages/core/README.md'), 'utf8');
  const coreReadmeKo = readFileSync(join(repoRoot, 'packages/core/README.ko.md'), 'utf8');
  const i18nReadme = readFileSync(join(repoRoot, 'packages/i18n/README.md'), 'utf8');
  const i18nReadmeKo = readFileSync(join(repoRoot, 'packages/i18n/README.ko.md'), 'utf8');
  const drizzleReadme = readFileSync(join(repoRoot, 'packages/drizzle/README.md'), 'utf8');
  const drizzleReadmeKo = readFileSync(join(repoRoot, 'packages/drizzle/README.ko.md'), 'utf8');
  const fastifyReadme = readFileSync(join(repoRoot, 'packages/platform-fastify/README.md'), 'utf8');
  const fastifyReadmeKo = readFileSync(join(repoRoot, 'packages/platform-fastify/README.ko.md'), 'utf8');
  const platformBunReadme = readFileSync(join(repoRoot, 'packages/platform-bun/README.md'), 'utf8');
  const platformBunReadmeKo = readFileSync(join(repoRoot, 'packages/platform-bun/README.ko.md'), 'utf8');
  const expressReadme = readFileSync(join(repoRoot, 'packages/platform-express/README.md'), 'utf8');
  const expressReadmeKo = readFileSync(join(repoRoot, 'packages/platform-express/README.ko.md'), 'utf8');
  const terminusReadme = readFileSync(join(repoRoot, 'packages/terminus/README.md'), 'utf8');
  const terminusReadmeKo = readFileSync(join(repoRoot, 'packages/terminus/README.ko.md'), 'utf8');
  const cacheManagerReadme = readFileSync(join(repoRoot, 'packages/cache-manager/README.md'), 'utf8');
  const cacheManagerReadmeKo = readFileSync(join(repoRoot, 'packages/cache-manager/README.ko.md'), 'utf8');
  const testingReadme = readFileSync(join(repoRoot, 'packages/testing/README.md'), 'utf8');
  const testingReadmeKo = readFileSync(join(repoRoot, 'packages/testing/README.ko.md'), 'utf8');
  const healthChapter = readFileSync(join(repoRoot, 'book/beginner/ch18-health.md'), 'utf8');
  const healthChapterKo = readFileSync(join(repoRoot, 'book/beginner/ch18-health.ko.md'), 'utf8');
  const notificationsReadme = readFileSync(join(repoRoot, 'packages/notifications/README.md'), 'utf8');
  const notificationsReadmeKo = readFileSync(join(repoRoot, 'packages/notifications/README.ko.md'), 'utf8');
  const notificationsChapter = readFileSync(join(repoRoot, 'book/intermediate/ch15-notifications.md'), 'utf8');
  const notificationsChapterKo = readFileSync(join(repoRoot, 'book/intermediate/ch15-notifications.ko.md'), 'utf8');
  const cliReadme = readFileSync(join(repoRoot, 'packages/cli/README.md'), 'utf8');
  const cliReadmeKo = readFileSync(join(repoRoot, 'packages/cli/README.ko.md'), 'utf8');
  const studioReadme = readFileSync(join(repoRoot, 'packages/studio/README.md'), 'utf8');
  const studioReadmeKo = readFileSync(join(repoRoot, 'packages/studio/README.ko.md'), 'utf8');
  const beginnerIntro = readFileSync(join(repoRoot, 'book/beginner/ch00-introduction.md'), 'utf8');
  const beginnerIntroKo = readFileSync(join(repoRoot, 'book/beginner/ch00-introduction.ko.md'), 'utf8');
  const beginnerCliSetup = readFileSync(join(repoRoot, 'book/beginner/ch02-cli-setup.md'), 'utf8');
  const beginnerCliSetupKo = readFileSync(join(repoRoot, 'book/beginner/ch02-cli-setup.ko.md'), 'utf8');
  const beginnerProduction = readFileSync(join(repoRoot, 'book/beginner/ch21-production.md'), 'utf8');
  const beginnerProductionKo = readFileSync(join(repoRoot, 'book/beginner/ch21-production.ko.md'), 'utf8');
  const customAdapter = readFileSync(join(repoRoot, 'book/advanced/ch13-custom-adapter.md'), 'utf8');
  const customAdapterKo = readFileSync(join(repoRoot, 'book/advanced/ch13-custom-adapter.ko.md'), 'utf8');
  const bunChapter = readFileSync(join(repoRoot, 'book/intermediate/ch22-bun.md'), 'utf8');
  const bunChapterKo = readFileSync(join(repoRoot, 'book/intermediate/ch22-bun.ko.md'), 'utf8');
  const runtimeAdaptersGuide = readFileSync(join(repoRoot, 'apps/docs/content/docs/guides/runtime-adapters.mdx'), 'utf8');
  const runtimeAdaptersGuideKo = readFileSync(join(repoRoot, 'apps/docs/content/docs/guides/runtime-adapters.ko.mdx'), 'utf8');
  const realtimeGuide = readFileSync(join(repoRoot, 'apps/docs/content/docs/guides/realtime.mdx'), 'utf8');
  const realtimeGuideKo = readFileSync(join(repoRoot, 'apps/docs/content/docs/guides/realtime.ko.mdx'), 'utf8');
  const viteReadme = readFileSync(join(repoRoot, 'packages/vite/README.md'), 'utf8');
  const viteReadmeKo = readFileSync(join(repoRoot, 'packages/vite/README.ko.md'), 'utf8');
  const quickStart = readFileSync(join(repoRoot, 'docs/getting-started/quick-start.md'), 'utf8');
  const quickStartKo = readFileSync(join(repoRoot, 'docs/getting-started/quick-start.ko.md'), 'utf8');
  const migrateFromNestjs = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.md'), 'utf8');
  const migrateFromNestjsKo = readFileSync(join(repoRoot, 'docs/getting-started/migrate-from-nestjs.ko.md'), 'utf8');
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
    packageChooser.includes('@fluojs/i18n') && packageChooser.includes('localization'),
    'docs/reference/package-chooser.md must keep @fluojs/i18n discoverable for localization tasks.',
  );
  assert(
    packageSurface.includes('@fluojs/i18n/adapters') && packageChooser.includes('@fluojs/i18n/adapters'),
    'docs/reference package-surface and package-chooser must keep @fluojs/i18n/adapters discoverable for non-HTTP locale resolution.',
  );
  assert(
    packageSurface.includes('typed translation helper declaration') && packageChooser.includes('typed translation helper declaration'),
    'docs/reference package-surface and package-chooser must keep @fluojs/i18n/typegen typed helper declarations discoverable.',
  );
  assert(
    i18nReadme.includes('does not declare a Node.js engine floor') &&
      packageSurface.includes('does not declare a Node.js engine floor') &&
      docsContext.includes('has no Node.js engine floor') &&
      i18nReadme.includes('global provider by default') &&
      packageSurface.includes('exposes `I18nService` globally by default') &&
      docsContext.includes('registers `I18nService` globally by default'),
    'i18n README, package-surface, and docs/CONTEXT.md must keep the root runtime boundary and provider visibility contract discoverable together.',
  );
  assert(
    packageChooserKo.includes('@fluojs/i18n') && packageChooserKo.includes('localization'),
    'docs/reference/package-chooser.ko.md must keep @fluojs/i18n discoverable for localization tasks.',
  );
  assert(
    packageSurfaceKo.includes('@fluojs/i18n/adapters') && packageChooserKo.includes('@fluojs/i18n/adapters'),
    'docs/reference package-surface.ko.md and package-chooser.ko.md must keep @fluojs/i18n/adapters discoverable for non-HTTP locale resolution.',
  );
  assert(
    packageSurfaceKo.includes('typed translation helper declaration') && packageChooserKo.includes('typed translation helper declaration'),
    'docs/reference package-surface.ko.md and package-chooser.ko.md must keep @fluojs/i18n/typegen typed helper declarations discoverable.',
  );
  assert(
    i18nReadmeKo.includes('Node.js engine floor를 선언하지 않으며') &&
      packageSurfaceKo.includes('Node.js engine floor를 선언하지 않는') &&
      docsContextKo.includes('Node.js engine floor가 없으며') &&
      i18nReadmeKo.includes('기본적으로 `I18nService`를 global provider로 export') &&
      packageSurfaceKo.includes('기본적으로 `I18nService`를 global로 노출') &&
      docsContextKo.includes('`I18nService`를 기본 global provider로 등록'),
    'Korean i18n README, package-surface, and docs/CONTEXT.ko.md must keep the root runtime boundary and provider visibility contract discoverable together.',
  );

  for (const markdown of [packageChooser, toolchainMatrix, docsContext, viteReadme, quickStart, migrateFromNestjs]) {
    assert(
      markdown.includes('@fluojs/vite') &&
        markdown.includes('@fluojs/testing/vitest') &&
        markdown.includes('vite.config.ts') &&
        markdown.includes('vitest.config.ts'),
      'Vite decorator tooling docs must keep @fluojs/vite, @fluojs/testing/vitest, vite.config.ts, and vitest.config.ts discoverable together.',
    );
  }

  for (const markdown of [packageChooserKo, toolchainMatrixKo, docsContextKo, viteReadmeKo, quickStartKo, migrateFromNestjsKo]) {
    assert(
      markdown.includes('@fluojs/vite') &&
        markdown.includes('@fluojs/testing/vitest') &&
        markdown.includes('vite.config.ts') &&
        markdown.includes('vitest.config.ts'),
      'Korean Vite decorator tooling docs must keep @fluojs/vite, @fluojs/testing/vitest, vite.config.ts, and vitest.config.ts discoverable together.',
    );
  }

  assert(
    packageChooser.includes('lazy') && toolchainMatrix.includes('lazy') && docsContext.includes('lazy') && viteReadme.includes('lazily loads Babel'),
    'Vite decorator tooling docs must preserve lazy Babel loading discoverability.',
  );
  assert(
    packageChooserKo.includes('lazy') &&
      toolchainMatrixKo.includes('lazy') &&
      docsContextKo.includes('lazy') &&
      viteReadmeKo.includes('Babel을 lazy load'),
    'Korean Vite decorator tooling docs must preserve lazy Babel loading discoverability.',
  );

  assert(
    testingReadme.includes('request-scoped provider isolation') &&
      testingReadme.includes('app.request(...).send()') &&
      testingReadme.includes('@fluojs/testing/http') &&
      testingReadme.includes('DeepMocked<T>') &&
      packageSurface.includes('@fluojs/testing/http') &&
      packageSurface.includes('request-scoped DI isolation') &&
      docsContext.includes('@fluojs/testing/http') &&
      docsContext.includes('request-scoped DI'),
    'Testing README, package-surface, and docs/CONTEXT.md must keep request helper subpaths, request-scoped DI isolation, and root mock typing discoverable together.',
  );
  assert(
    testingReadmeKo.includes('request-scoped provider isolation') &&
      testingReadmeKo.includes('app.request(...).send()') &&
      testingReadmeKo.includes('@fluojs/testing/http') &&
      testingReadmeKo.includes('DeepMocked<T>') &&
      packageSurfaceKo.includes('@fluojs/testing/http') &&
      packageSurfaceKo.includes('request-scoped DI isolation') &&
      docsContextKo.includes('@fluojs/testing/http') &&
      docsContextKo.includes('request-scoped DI'),
    'Korean testing README, package-surface.ko.md, and docs/CONTEXT.ko.md must keep request helper subpaths, request-scoped DI isolation, and root mock typing discoverable together.',
  );

  assert(
    docsContext.includes('docs/reference/package-surface.md'),
    'docs/CONTEXT.md must point readers to the canonical runtime package matrix page.',
  );
  assert(
    docsContextKo.includes('docs/reference/package-surface.md'),
    'docs/CONTEXT.ko.md must point readers to the canonical runtime package matrix page.',
  );
  assert(
    packageSurface.includes('@fluojs/runtime/internal*') &&
      packageSurface.includes('package-integration seams') &&
      docsContext.includes('@fluojs/runtime/internal*') &&
      docsContext.includes('package-integration seam boundary'),
    'docs/reference/package-surface.md and docs/CONTEXT.md must distinguish runtime application-facing helper subpaths from internal package-integration seams.',
  );
  assert(
    packageSurfaceKo.includes('@fluojs/runtime/internal*') &&
      packageSurfaceKo.includes('package-integration seam') &&
      docsContextKo.includes('@fluojs/runtime/internal*') &&
      docsContextKo.includes('package-integration seam 경계'),
    'docs/reference/package-surface.ko.md and docs/CONTEXT.ko.md must distinguish runtime application-facing helper subpaths from internal package-integration seams.',
  );
  assert(
    coreReadme.includes('@fluojs/core/request-pipeline') &&
      packageSurface.includes('@fluojs/core/request-pipeline') &&
      docsContext.includes('@fluojs/core/request-pipeline') &&
      docsContext.includes('@fluojs/core/internal'),
    'Core README, package-surface, and docs/CONTEXT.md must keep the request-pipeline metadata seam discoverable apart from @fluojs/core/internal.',
  );
  assert(
    coreReadmeKo.includes('@fluojs/core/request-pipeline') &&
      packageSurfaceKo.includes('@fluojs/core/request-pipeline') &&
      docsContextKo.includes('@fluojs/core/request-pipeline') &&
      docsContextKo.includes('@fluojs/core/internal'),
    'Core README.ko, package-surface.ko, and docs/CONTEXT.ko.md must keep the request-pipeline metadata seam discoverable apart from @fluojs/core/internal.',
  );
  assert(
    expressReadme.includes('Express compatibility does not mean that native Express/Connect') &&
      expressReadme.includes('Do not pass an Express/Connect function') &&
      expressReadme.includes('`nativeMiddleware` is mounted in array order before') &&
      packageSurface.includes('native Express/Connect `(req, res, next)` functions are not portable fluo middleware') &&
      packageSurface.includes('pre-router `nativeMiddleware` option') &&
      packageChooser.includes('Use fluo `Middleware` for the application pipeline') &&
      packageChooser.includes('pre-router `nativeMiddleware` option') &&
      migrateFromNestjs.includes('Native Express/Connect `(req, res, next)` middleware') &&
      migrateFromNestjs.includes('explicit `nativeMiddleware` option') &&
      docsContext.includes('Express host compatibility boundary') &&
      docsContext.includes('Express native middleware seam') &&
      docsContext.includes('`nativeMiddleware` adapter option') &&
      docsContext.includes('getServer()') &&
      docsContext.includes('getRealtimeCapability()'),
    'Express platform docs must keep host compatibility, native middleware limits, and infrastructure helper boundaries discoverable together.',
  );
  assert(
    expressReadmeKo.includes('Express 호환성은 native Express/Connect') &&
      expressReadmeKo.includes('Express/Connect function을 fluo middleware로 직접 전달하지 마세요') &&
      expressReadmeKo.includes('`nativeMiddleware`는 배열 순서대로 adapter의 Express Router') &&
      packageSurfaceKo.includes('native Express/Connect `(req, res, next)` function은 portable fluo middleware가 아닙니다') &&
      packageSurfaceKo.includes('pre-router `nativeMiddleware` 옵션') &&
      packageChooserKo.includes('Application pipeline에는 fluo `Middleware`를 사용') &&
      packageChooserKo.includes('pre-router `nativeMiddleware` 옵션') &&
      migrateFromNestjsKo.includes('native Express/Connect `(req, res, next)` middleware') &&
      migrateFromNestjsKo.includes('명시적 `nativeMiddleware` 옵션') &&
      docsContextKo.includes('Express host compatibility boundary') &&
      docsContextKo.includes('Express native middleware seam') &&
      docsContextKo.includes('`nativeMiddleware` adapter 옵션') &&
      docsContextKo.includes('getServer()') &&
      docsContextKo.includes('getRealtimeCapability()'),
    'Korean Express platform docs must keep host compatibility, native middleware limits, explicit registration, and infrastructure helper boundaries discoverable together.',
  );
  assert(
    fastifyReadme.includes('engines.node >=20.0.0') &&
      fastifyReadme.includes('Node.js `https.ServerOptions`') &&
      fastifyReadme.includes('createFastifyAdapter(...)') &&
      fastifyReadme.includes('bootstrapFastifyApplication(...)') &&
      fastifyReadme.includes('runFastifyApplication(...)') &&
      packageSurface.includes('Fastify-backed Node `http`/`https` listener') &&
      packageChooser.includes('Need Fastify-owned HTTPS/TLS startup') &&
      packageChooser.includes('plain HTTP behind that boundary') &&
      docsContext.includes('Fastify adapter discoverability') &&
      docsContext.includes('apps/docs/content/docs/guides/runtime-adapters.mdx') &&
      docsContext.includes('engines.node >=20.0.0') &&
      beginnerIntro.includes('Node.js 20 or newer') &&
      beginnerCliSetup.includes('plain HTTP for local development') &&
      beginnerProduction.includes('Fastify adapter `https` option') &&
      beginnerProduction.startsWith('<!-- packages: @fluojs/core, @fluojs/http, @fluojs/platform-fastify -->') &&
      customAdapter.startsWith('<!-- packages: @fluojs/http, @fluojs/core, @fluojs/di, @fluojs/platform-fastify -->') &&
      runtimeAdaptersGuide.includes('### Fastify HTTPS/TLS') &&
      runtimeAdaptersGuide.includes('Node.js `https.ServerOptions`') &&
      runtimeAdaptersGuide.includes('plain HTTP behind that infrastructure boundary'),
    'Fastify README, package-surface, package-chooser, docs/CONTEXT.md, book metadata, and website guidance must keep the Node.js 20+ runtime floor and HTTPS/TLS startup boundary discoverable together.',
  );
  assert(
    fastifyReadmeKo.includes('engines.node >=20.0.0') &&
      fastifyReadmeKo.includes('Node.js `https.ServerOptions`') &&
      fastifyReadmeKo.includes('createFastifyAdapter(...)') &&
      fastifyReadmeKo.includes('bootstrapFastifyApplication(...)') &&
      fastifyReadmeKo.includes('runFastifyApplication(...)') &&
      packageSurfaceKo.includes('Fastify 기반 Node `http`/`https` listener') &&
      packageChooserKo.includes('Fastify가 HTTPS/TLS 시작을 직접 소유해야 함') &&
      packageChooserKo.includes('일반 HTTP로 유지하세요') &&
      docsContextKo.includes('Fastify adapter discoverability') &&
      docsContextKo.includes('apps/docs/content/docs/guides/runtime-adapters.ko.mdx') &&
      docsContextKo.includes('engines.node >=20.0.0') &&
      beginnerIntroKo.includes('Node.js 20 버전 이상') &&
      beginnerCliSetupKo.includes('일반 HTTP로 실행') &&
      beginnerProductionKo.includes('Fastify adapter `https` option') &&
      beginnerProductionKo.startsWith('<!-- packages: @fluojs/core, @fluojs/http, @fluojs/platform-fastify -->') &&
      customAdapterKo.startsWith('<!-- packages: @fluojs/http, @fluojs/core, @fluojs/di, @fluojs/platform-fastify -->') &&
      runtimeAdaptersGuideKo.includes('### Fastify HTTPS/TLS') &&
      runtimeAdaptersGuideKo.includes('Node.js `https.ServerOptions`') &&
      runtimeAdaptersGuideKo.includes('infrastructure boundary 뒤에서 Fastify를 일반 HTTP로 실행'),
    'Korean Fastify README, package-surface, package-chooser, docs/CONTEXT.ko.md, book metadata, and website guidance must keep the Node.js 20+ runtime floor and HTTPS/TLS startup boundary discoverable together.',
  );
  assert(
    platformBunReadme.includes('synchronously creates the fetch bridge') &&
      platformBunReadme.includes('Bun websocket bindings must be configured before `listen()` starts') &&
      platformBunReadme.includes('logging and `process.exitCode`') &&
      bunChapter.includes('`runBunApplication(...)` combines bootstrap') &&
      runtimeAdaptersGuide.includes('const handler = createBunFetchHandler({') &&
      !runtimeAdaptersGuide.includes('await createBunFetchHandler') &&
      runtimeAdaptersGuide.includes('manual `Bun.serve(...)` call') &&
      realtimeGuide.includes('adapter exposes only an `upgrade(...)` host') &&
      migrateFromNestjs.includes('manual hosts own shutdown, websocket upgrades, and native `routes` acceleration') &&
      docsContext.includes('synchronous `createBunFetchHandler(...)` usage'),
    'Bun adapter docs must keep synchronous manual fetch hosting, pre-listen realtime binding, and signal-driven shutdown ownership discoverable together.',
  );
  assert(
    platformBunReadmeKo.includes('동기적으로 fetch bridge') &&
      platformBunReadmeKo.includes('Bun websocket binding은 서버를 시작하는 `listen()` 전에 구성해야 합니다') &&
      platformBunReadmeKo.includes('로그와 `process.exitCode`') &&
      bunChapterKo.includes('`runBunApplication(...)`이 bootstrap') &&
      runtimeAdaptersGuideKo.includes('const handler = createBunFetchHandler({') &&
      !runtimeAdaptersGuideKo.includes('await createBunFetchHandler') &&
      runtimeAdaptersGuideKo.includes('수동 `Bun.serve(...)` 호출') &&
      realtimeGuideKo.includes('`upgrade(...)` host만 노출') &&
      migrateFromNestjsKo.includes('manual host는 shutdown, websocket upgrade, native `routes` acceleration을 직접 소유') &&
      docsContextKo.includes('동기 `createBunFetchHandler(...)` 사용법'),
    'Korean Bun adapter docs must keep synchronous manual fetch hosting, pre-listen realtime binding, and signal-driven shutdown ownership discoverable together.',
  );
  assert(
    docsContext.includes('docs/reference/package-chooser.md') && docsContext.includes('@fluojs/i18n'),
    'docs/CONTEXT.md must point readers to package chooser i18n discovery guidance.',
  );
  assert(
    docsContext.includes('@fluojs/i18n/adapters'),
    'docs/CONTEXT.md must mention @fluojs/i18n/adapters when non-HTTP locale resolution is documented.',
  );
  assert(
    docsContext.includes('typed translation helper declaration'),
    'docs/CONTEXT.md must mention @fluojs/i18n/typegen typed helper declarations when documented.',
  );
  assert(
    docsContextKo.includes('docs/reference/package-chooser.md') && docsContextKo.includes('@fluojs/i18n'),
    'docs/CONTEXT.ko.md must point readers to package chooser i18n discovery guidance.',
  );
  assert(
    docsContextKo.includes('@fluojs/i18n/adapters'),
    'docs/CONTEXT.ko.md must mention @fluojs/i18n/adapters when non-HTTP locale resolution is documented.',
  );
  assert(
    docsContextKo.includes('typed translation helper declaration'),
    'docs/CONTEXT.ko.md must mention @fluojs/i18n/typegen typed helper declarations when documented.',
  );
  assert(
    packageChooser.includes('@fluojs/terminus/node') && docsContext.includes('@fluojs/terminus/node'),
    'docs/CONTEXT.md must point readers to package chooser Terminus Node indicator subpath guidance.',
  );
  assert(
    packageChooser.includes('execution.indicatorTimeoutMs') && docsContext.includes('execution.indicatorTimeoutMs'),
    'docs/CONTEXT.md must mention Terminus slow-indicator timeout guardrails when documented.',
  );
  assert(
    packageChooserKo.includes('@fluojs/terminus/node') && docsContextKo.includes('@fluojs/terminus/node'),
    'docs/CONTEXT.ko.md must point readers to package chooser Terminus Node indicator subpath guidance.',
  );
  assert(
    packageChooserKo.includes('execution.indicatorTimeoutMs') && docsContextKo.includes('execution.indicatorTimeoutMs'),
    'docs/CONTEXT.ko.md must mention Terminus slow-indicator timeout guardrails when documented.',
  );
  assert(
    terminusReadme.includes('TERMINUS_INDICATOR_PROVIDER_TOKENS') &&
      packageSurface.includes('exported indicator/provider DI tokens') &&
      docsContext.includes('exported indicator/provider DI tokens'),
    'Terminus DI provider token exports must stay discoverable across README, package-surface, and docs/CONTEXT.md.',
  );
  assert(
    terminusReadmeKo.includes('TERMINUS_INDICATOR_PROVIDER_TOKENS') &&
      packageSurfaceKo.includes('indicator/provider DI token') &&
      docsContextKo.includes('indicator/provider DI token'),
    'Korean Terminus DI provider token exports must stay discoverable across README.ko, package-surface.ko, and docs/CONTEXT.ko.md.',
  );
  assert(
    terminusReadme.includes('Separate application containers keep independent in-flight state') &&
      packageSurface.includes('service-scoped in-flight indicator serialization') &&
      docsContext.includes('service-scoped in-flight indicator serialization'),
    'Terminus in-flight indicator serialization scope must stay discoverable across README, package-surface, and docs/CONTEXT.md.',
  );
  assert(
    terminusReadmeKo.includes('별도 application container는 독립적인 in-flight state') &&
      packageSurfaceKo.includes('service-scoped in-flight indicator serialization') &&
      docsContextKo.includes('service-scoped in-flight indicator serialization'),
    'Korean Terminus in-flight indicator serialization scope must stay discoverable across README.ko, package-surface.ko, and docs/CONTEXT.ko.md.',
  );
  assert(
    terminusReadme.includes('optional Prisma peer') &&
      packageSurface.includes('optional Redis or Prisma peers') &&
      healthChapter.includes('optional Redis or Prisma peers') &&
      docsContext.includes('Prisma named service/client provider seams'),
    'Terminus optional-peer-safe Prisma provider diagnostics must stay discoverable across README, package-surface, beginner book, and docs/CONTEXT.md.',
  );
  assert(
    terminusReadmeKo.includes('optional Prisma peer') &&
      packageSurfaceKo.includes('optional Redis 또는 Prisma peer') &&
      healthChapterKo.includes('선택적 Redis 또는 Prisma peer') &&
      docsContextKo.includes('Prisma named service/client provider seam'),
    'Korean Terminus optional-peer-safe Prisma provider diagnostics must stay discoverable across README.ko, package-surface.ko, beginner book, and docs/CONTEXT.ko.md.',
  );
  assert(
    packageSurface.includes('lifecycle-owned connect/quit timeout guardrails') &&
      docsContext.includes('RedisModule.forRoot({ lifecycle })') &&
      docsContext.includes('book/intermediate/ch03-redis-transport.md'),
    'docs/CONTEXT.md must keep Redis lifecycle timeout guardrails and Redis transport book guidance discoverable when package-surface.md documents them.',
  );
  assert(
    packageSurface.includes('Pub/Sub subscribers use dedicated Redis connections') &&
      docsContext.includes('Pub/Sub subscribers need dedicated Redis connections'),
    'docs/CONTEXT.md must mention dedicated Redis Pub/Sub subscriber connections when package-surface.md documents them.',
  );
  assert(
    packageSurfaceKo.includes('lifecycle-owned connect/quit timeout guardrail') &&
      docsContextKo.includes('RedisModule.forRoot({ lifecycle })') &&
      docsContextKo.includes('book/intermediate/ch03-redis-transport.ko.md'),
    'docs/CONTEXT.ko.md must keep Redis lifecycle timeout guardrails and Redis transport book guidance discoverable when package-surface.ko.md documents them.',
  );
  assert(
    packageSurfaceKo.includes('Pub/Sub subscriber') && docsContextKo.includes('Pub/Sub subscriber에 전용 Redis 연결'),
    'docs/CONTEXT.ko.md must mention dedicated Redis Pub/Sub subscriber connections when package-surface.ko.md documents them.',
  );
  assert(
    packageSurface.includes('@fluojs/drizzle') &&
      packageSurface.includes('node:async_hooks') &&
      packageChooser.includes('raw Drizzle driver handle') &&
      docsContext.includes('raw Drizzle provider guidance') &&
      drizzleReadme.includes('raw Drizzle driver handle') &&
      drizzleReadme.includes('{ provide, useFactory }'),
    'Drizzle README, package-surface, package-chooser, and docs/CONTEXT.md must keep the Node-only runtime boundary and raw-provider fallback discoverable together.',
  );
  assert(
    packageSurfaceKo.includes('@fluojs/drizzle') &&
      packageSurfaceKo.includes('node:async_hooks') &&
      packageChooserKo.includes('raw Drizzle driver handle') &&
      docsContextKo.includes('raw Drizzle provider guidance') &&
      drizzleReadmeKo.includes('raw Drizzle driver handle') &&
      drizzleReadmeKo.includes('{ provide, useFactory }'),
    'Drizzle README.ko, package-surface.ko, package-chooser.ko, and docs/CONTEXT.ko.md must keep the Node-only runtime boundary and raw-provider fallback discoverable together.',
  );
  assert(
    packageSurface.includes('NormalizedCacheModuleOptions') &&
      docsContext.includes('NormalizedCacheModuleOptions') &&
      cacheManagerReadme.includes('NormalizedCacheModuleOptions'),
    'cache-manager package-surface, docs/CONTEXT.md, and README.md must keep the NormalizedCacheModuleOptions compatibility export discoverable together.',
  );
  assert(
    packageSurfaceKo.includes('NormalizedCacheModuleOptions') &&
      docsContextKo.includes('NormalizedCacheModuleOptions') &&
      cacheManagerReadmeKo.includes('NormalizedCacheModuleOptions'),
    'cache-manager package-surface.ko.md, docs/CONTEXT.ko.md, and README.ko.md must keep the NormalizedCacheModuleOptions compatibility export discoverable together.',
  );
  assert(
    packageSurface.includes('createPassportJsStrategyBridge(...)') &&
      packageSurface.includes('createCookieAuthPreset(...)') &&
      docsContext.includes('createPassportJsStrategyBridge(...)') &&
      docsContext.includes('createCookieAuthPreset(...)') &&
      docsContext.includes('provider bundle'),
    'docs/CONTEXT.md must keep Passport bridge and cookie compatibility provider bundles discoverable when package-surface.md documents them.',
  );
  assert(
    packageSurfaceKo.includes('createPassportJsStrategyBridge(...)') &&
      packageSurfaceKo.includes('createCookieAuthPreset(...)') &&
      docsContextKo.includes('createPassportJsStrategyBridge(...)') &&
      docsContextKo.includes('createCookieAuthPreset(...)') &&
      docsContextKo.includes('provider bundle'),
    'docs/CONTEXT.ko.md must keep Passport bridge and cookie compatibility provider bundles discoverable when package-surface.ko.md documents them.',
  );
  assert(
    packageSurface.includes('createSlackProviders(...)') &&
      docsContext.includes('packages/slack/README.md') &&
      docsContext.includes('abort-signal propagation') &&
      docsContext.includes('platform status snapshots'),
    'docs/CONTEXT.md must keep Slack manual provider composition, abort propagation, and status snapshot guidance discoverable when package-surface.md documents createSlackProviders(...).',
  );
  assert(
    packageSurfaceKo.includes('createSlackProviders(...)') &&
      docsContextKo.includes('packages/slack/README.ko.md') &&
      docsContextKo.includes('abort-signal 전파') &&
      docsContextKo.includes('platform status snapshot'),
    'docs/CONTEXT.ko.md must keep Slack manual provider composition, abort propagation, and status snapshot guidance discoverable when package-surface.ko.md documents createSlackProviders(...).',
  );
  assert(
    packageSurface.includes('NotificationsModule.forRootAsync({ inject, useFactory, global? })') &&
      packageSurface.includes('dispatchMany(...)') &&
      packageSurface.includes('NotificationsService.createPlatformStatusSnapshot()') &&
      docsContext.includes('packages/notifications/README.md') &&
      docsContext.includes('book/intermediate/ch15-notifications.md') &&
      docsContext.includes('concrete queue/event-bus ownership') &&
      notificationsReadme.includes('dispatchMany(...)') &&
      notificationsReadme.includes('createNotificationsPlatformStatusSnapshot(...)') &&
      notificationsChapter.includes('NotificationDispatchBatchResult') &&
      notificationsChapter.includes('global: false'),
    'Notifications package-surface, README, docs/CONTEXT.md, and Chapter 15 must keep async registration, batch dispatch, status diagnostics, and concrete queue/event-bus ownership discoverable together.',
  );
  assert(
    packageSurfaceKo.includes('NotificationsModule.forRootAsync({ inject, useFactory, global? })') &&
      packageSurfaceKo.includes('dispatchMany(...)') &&
      packageSurfaceKo.includes('NotificationsService.createPlatformStatusSnapshot()') &&
      docsContextKo.includes('packages/notifications/README.ko.md') &&
      docsContextKo.includes('book/intermediate/ch15-notifications.ko.md') &&
      docsContextKo.includes('concrete queue/event-bus ownership') &&
      notificationsReadmeKo.includes('dispatchMany(...)') &&
      notificationsReadmeKo.includes('createNotificationsPlatformStatusSnapshot(...)') &&
      notificationsChapterKo.includes('NotificationDispatchBatchResult') &&
      notificationsChapterKo.includes('global: false'),
    'Notifications package-surface.ko.md, README.ko.md, docs/CONTEXT.ko.md, and Chapter 15 KO must keep async registration, batch dispatch, status diagnostics, and concrete queue/event-bus ownership discoverable together.',
  );
  assert(
    packageSurface.includes('@fluojs/cron') &&
      packageSurface.includes('health/readiness status snapshots') &&
      docsContext.includes('packages/cron/README.md') &&
      docsContext.includes('book/intermediate/ch12-cron.md') &&
      docsContext.includes('dynamic-start lifecycle guarantees'),
    'docs/CONTEXT.md must keep cron scheduling, status snapshot, and book lifecycle guidance discoverable when package-surface.md documents them.',
  );
  assert(
    packageSurfaceKo.includes('@fluojs/cron') &&
      packageSurfaceKo.includes('health/readiness status snapshot') &&
      docsContextKo.includes('packages/cron/README.ko.md') &&
      docsContextKo.includes('book/intermediate/ch12-cron.ko.md') &&
      docsContextKo.includes('dynamic-start lifecycle guarantee'),
    'docs/CONTEXT.ko.md must keep cron scheduling, status snapshot, and book lifecycle guidance discoverable when package-surface.ko.md documents them.',
  );
  assert(
    packageSurface.includes('@fluojs/socket.io') &&
      packageSurface.includes('runtime limits') &&
      docsContext.includes('packages/socket.io/README.md') &&
      docsContext.includes('SocketIoHandshakeRequest') &&
      docsContext.includes('guard acceptance for `true` / `undefined` / no return') &&
      docsContext.includes('Node.js 20+ server-backed') &&
      docsContext.includes('Bun static CORS plus no-`serverBacked` gateway caveats') &&
      docsContext.includes('explicit ACK callback handling') &&
      docsContext.includes('force-disconnect/retry semantics'),
    'docs/CONTEXT.md must keep Socket.IO runtime limits, public guard request typing, ACK, guard, Bun caveat, and shutdown retry guidance discoverable when package-surface.md documents them.',
  );
  assert(
    packageSurfaceKo.includes('@fluojs/socket.io') &&
      packageSurfaceKo.includes('런타임 제한') &&
      docsContextKo.includes('packages/socket.io/README.ko.md') &&
      docsContextKo.includes('SocketIoHandshakeRequest') &&
      docsContextKo.includes('return 없음은 허용') &&
      docsContextKo.includes('Node.js 20+ server-backed') &&
      docsContextKo.includes('Bun static CORS') &&
      docsContextKo.includes('명시적 ACK callback') &&
      docsContextKo.includes('force-disconnect/retry semantic'),
    'docs/CONTEXT.ko.md must keep Socket.IO runtime limits, public guard request typing, ACK, guard, Bun caveat, and shutdown retry guidance discoverable when package-surface.ko.md documents them.',
  );
  assert(
    packageSurface.includes('@fluojs/websockets/bun') &&
      packageSurface.includes('shared decorator and metadata authoring primitives') &&
      packageSurface.includes('ignored raw handler return values') &&
      packageSurface.includes('thrown HTTP exceptions') &&
      packageSurface.includes('token-only root `WebSocketGatewayLifecycleService`') &&
      docsContext.includes('packages/websockets/README.md') &&
      docsContext.includes('@fluojs/websockets/cloudflare-workers') &&
      docsContext.includes('metadata authoring primitives') &&
      docsContext.includes('thrown HTTP exceptions') &&
      docsContext.includes('ignored raw WebSocket handler return values') &&
      docsContext.includes('token-only `WebSocketGatewayLifecycleService`'),
    'docs/CONTEXT.md must keep WebSockets runtime subpaths, shared authoring primitives, guard rejection modes, ignored returns, and token-only lifecycle service discoverable when package-surface.md documents them.',
  );
  assert(
    packageSurfaceKo.includes('@fluojs/websockets/bun') &&
      packageSurfaceKo.includes('metadata authoring primitive') &&
      packageSurfaceKo.includes('await 완료 뒤 무시되는 raw handler return value') &&
      packageSurfaceKo.includes('throw된 HTTP exception') &&
      packageSurfaceKo.includes('token-only root `WebSocketGatewayLifecycleService`') &&
      docsContextKo.includes('packages/websockets/README.ko.md') &&
      docsContextKo.includes('@fluojs/websockets/cloudflare-workers') &&
      docsContextKo.includes('metadata authoring primitive') &&
      docsContextKo.includes('throw된 HTTP exception') &&
      docsContextKo.includes('raw WebSocket handler return value') &&
      docsContextKo.includes('token-only `WebSocketGatewayLifecycleService`'),
    'docs/CONTEXT.ko.md must keep WebSockets runtime subpaths, shared authoring primitives, guard rejection modes, ignored returns, and token-only lifecycle service discoverable when package-surface.ko.md documents them.',
  );
  assert(
    packageSurface.includes('legacy standalone timing diagnostics') &&
      packageSurface.includes('rejecting body-like fields') &&
      packageSurface.includes('`body`, `headers`, `payload`, `rawBody`, `requestBody`, and `responseBody`') &&
      docsContext.includes('legacy standalone timing diagnostics') &&
      docsContext.includes('live request event privacy validation') &&
      docsContext.includes('`body`, `headers`, `payload`, `rawBody`, `requestBody`, and `responseBody`') &&
      studioReadme.includes('body-like payload fields') &&
      studioReadme.includes('`body`, `headers`, `payload`, `rawBody`, `requestBody`, and `responseBody`') &&
      studioReadme.includes('Node-based package entrypoint'),
    'Studio package-surface, docs/CONTEXT.md, and README.md must keep timing diagnostics, request privacy, and packaged viewer fallback guidance discoverable together.',
  );
  assert(
    packageSurfaceKo.includes('legacy standalone timing diagnostics') &&
      packageSurfaceKo.includes('body-like field') &&
      packageSurfaceKo.includes('`body`, `headers`, `payload`, `rawBody`, `requestBody`, `responseBody`') &&
      docsContextKo.includes('legacy standalone timing diagnostics') &&
      docsContextKo.includes('live request event privacy validation') &&
      docsContextKo.includes('`body`, `headers`, `payload`, `rawBody`, `requestBody`, `responseBody`') &&
      studioReadmeKo.includes('body-like payload field') &&
      studioReadmeKo.includes('`body`, `headers`, `payload`, `rawBody`, `requestBody`, `responseBody`') &&
      studioReadmeKo.includes('Node 기반 package entrypoint'),
    'Studio package-surface.ko.md, docs/CONTEXT.ko.md, and README.ko.md must keep timing diagnostics, request privacy, and packaged viewer fallback guidance discoverable together.',
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

function enforceViteToolingDiscoverability() {
  const englishContext = read('docs/CONTEXT.md');
  const englishChooser = read('docs/reference/package-chooser.md');
  const englishPackageSurface = read('docs/reference/package-surface.md');
  const englishToolchainMatrix = read('docs/reference/toolchain-contract-matrix.md');
  const englishViteReadme = read('packages/vite/README.md');
  const vitePackageJson = JSON.parse(read('packages/vite/package.json'));
  const koreanContext = read('docs/CONTEXT.ko.md');
  const koreanChooser = read('docs/reference/package-chooser.ko.md');
  const koreanPackageSurface = read('docs/reference/package-surface.ko.md');
  const koreanToolchainMatrix = read('docs/reference/toolchain-contract-matrix.ko.md');
  const koreanViteReadme = read('packages/vite/README.ko.md');

  for (const markdown of [
    englishContext,
    englishChooser,
    englishToolchainMatrix,
    englishViteReadme,
    koreanContext,
    koreanChooser,
    koreanToolchainMatrix,
    koreanViteReadme,
  ]) {
    assert(
      markdown.includes('@babel/preset-typescript'),
      'Vite tooling docs must keep the @babel/preset-typescript peer discoverable across README, context, chooser, and toolchain matrix surfaces.',
    );
  }

  assert(
    vitePackageJson.engines?.node === '>=20.0.0',
    'packages/vite/package.json must keep the documented Node.js >=20.0.0 engine floor.',
  );

  for (const markdown of [englishContext, englishPackageSurface, englishToolchainMatrix, englishViteReadme]) {
    assert(
      markdown.includes('Node.js') && markdown.includes('>=20.0.0'),
      'English Vite tooling docs must keep the @fluojs/vite Node.js >=20.0.0 engine floor discoverable.',
    );
    assert(
      markdown.includes('Vite `>=6.2.0`'),
      'English Vite tooling docs must keep the @fluojs/vite Vite >=6.2.0 peer boundary discoverable.',
    );
    assert(
      markdown.includes('lazy') || markdown.includes('lazily'),
      'English Vite tooling docs must keep the lazy Babel loading boundary discoverable.',
    );
  }

  for (const markdown of [koreanContext, koreanPackageSurface, koreanToolchainMatrix, koreanViteReadme]) {
    assert(
      markdown.includes('Node.js') && markdown.includes('>=20.0.0'),
      'Korean Vite tooling docs must keep the @fluojs/vite Node.js >=20.0.0 engine floor discoverable.',
    );
    assert(
      markdown.includes('Vite `>=6.2.0`'),
      'Korean Vite tooling docs must keep the @fluojs/vite Vite >=6.2.0 peer boundary discoverable.',
    );
    assert(
      markdown.includes('lazy'),
      'Korean Vite tooling docs must keep the lazy Babel loading boundary discoverable.',
    );
  }
}

export function enforceReactClientSubpathContract() {
  const clientEntrypoint = read('packages/react/src/client.ts');
  const englishReadme = read('packages/react/README.md');
  const koreanReadme = read('packages/react/README.ko.md');
  const packageJson = JSON.parse(read('packages/react/package.json'));
  const rootEntrypoint = read('packages/react/src/index.ts');
  const documentation = [
    englishReadme,
    koreanReadme,
    read('docs/reference/package-surface.md'),
    read('docs/reference/package-surface.ko.md'),
    read('docs/reference/package-chooser.md'),
    read('docs/reference/package-chooser.ko.md'),
  ];

  assert(
    packageJson.exports?.['./client']?.types === './dist/client.d.ts' &&
      packageJson.exports?.['./client']?.import === './dist/client.js',
    'packages/react/package.json must publish the @fluojs/react/client types and import entrypoint.',
  );
  assert(
    !rootEntrypoint.includes('./client.js'),
    'packages/react/src/index.ts must keep browser navigation APIs out of the runtime-neutral root.',
  );

  for (const exportedSymbol of [
    'Link',
    'ReactClientRouterProvider',
    'createReactRouteSnapshot',
    'useNavigation',
    'useParams',
    'usePathname',
    'useRouter',
    'useRouterState',
    'useSearchParams',
  ]) {
    assert(
      clientEntrypoint.includes(exportedSymbol),
      `packages/react/src/client.ts must export ${exportedSymbol} from the client subpath.`,
    );
  }

  for (const markdown of documentation) {
    assert(
      markdown.includes('@fluojs/react/client') && markdown.includes('full-document'),
      'React client contract docs must keep the isolated subpath and full-document navigation behavior discoverable.',
    );
  }

  assert(
    englishReadme.includes('pathname or search') &&
      englishReadme.includes('fragment-only') &&
      englishReadme.includes('does not issue a new HTTP request') &&
      englishReadme.includes('identical URL') &&
      englishReadme.includes('skipped'),
    'packages/react/README.md must document path/search full-document navigation, fragment-only same-document behavior, and identical-URL skips.',
  );
  assert(
    koreanReadme.includes('pathname 또는 search') &&
      koreanReadme.includes('fragment-only') &&
      koreanReadme.includes('새 HTTP request를 보내지') &&
      koreanReadme.includes('identical URL') &&
      koreanReadme.includes('skipped'),
    'packages/react/README.ko.md must document path/search full-document navigation, fragment-only same-document behavior, and identical-URL skips.',
  );
}

export function enforceHttpCatchAllRouteGrammarDecision() {
  const decisionPaths = [
    'docs/architecture/http-catch-all-route-grammar.md',
    'docs/architecture/http-catch-all-route-grammar.ko.md',
  ];
  const linkedSurfacePaths = [
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
    'docs/architecture/http-runtime.md',
    'docs/architecture/http-runtime.ko.md',
    'packages/http/README.md',
    'packages/http/README.ko.md',
    'packages/react/README.md',
    'packages/react/README.ko.md',
  ];

  for (const decisionPath of decisionPaths) {
    const decision = read(decisionPath);

    for (const requiredContract of [
      'Status: Deferred',
      '/*path',
      '/:path*',
      'static > param > catch-all',
      'Readonly<Record<string, string>>',
      'OpenAPI',
      'native fast path',
      '@fluojs/react/client',
    ]) {
      assert(
        decision.includes(requiredContract),
        `${decisionPath} must keep the deferred catch-all decision and adoption gate ${requiredContract} explicit.`,
      );
    }
  }

  for (const surfacePath of linkedSurfacePaths) {
    assert(
      read(surfacePath).includes('http-catch-all-route-grammar'),
      `${surfacePath} must link the HTTP catch-all route grammar decision.`,
    );
  }

  const routePathSource = read('packages/http/src/route-path.ts');
  assert(
    routePathSource.includes('Only literal segments and full-segment ":param" placeholders are supported.') &&
      !routePathSource.includes("kind: 'catch-all'"),
    'packages/http/src/route-path.ts must keep catch-all grammar inactive while the decision status is Deferred.',
  );
}

export function enforceGraphqlRuntimeBoundaryDiscoverability() {
  const expectedNodeEngine = '>=20.16.0';
  const graphqlPackageJson = JSON.parse(read('packages/graphql/package.json'));
  const runtimePackageJson = JSON.parse(read('packages/runtime/package.json'));
  const configPackageJson = JSON.parse(read('packages/config/package.json'));

  assert(
    graphqlPackageJson.engines?.node === expectedNodeEngine,
    `packages/graphql/package.json must cover the effective mandatory dependency floor with Node.js ${expectedNodeEngine}.`,
  );
  assert(
    runtimePackageJson.dependencies?.['@fluojs/config'] === 'workspace:^',
    'packages/runtime/package.json must keep the mandatory @fluojs/config dependency edge covered by the GraphQL runtime contract.',
  );
  assert(
    configPackageJson.engines?.node === expectedNodeEngine,
    `packages/config/package.json must keep the Node.js ${expectedNodeEngine} floor covered by the GraphQL runtime contract.`,
  );

  const contractPaths = [
    'packages/graphql/README.md',
    'packages/graphql/README.ko.md',
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
    'docs/getting-started/migrate-from-nestjs.md',
    'docs/getting-started/migrate-from-nestjs.ko.md',
    'book/intermediate/ch18-graphql.md',
    'book/intermediate/ch18-graphql.ko.md',
    'book/intermediate/ch25-final.md',
    'book/intermediate/ch25-final.ko.md',
  ];

  for (const contractPath of contractPaths) {
    assert(
      read(contractPath).includes(`Node.js \`${expectedNodeEngine}\``),
      `${contractPath} must keep the effective GraphQL Node.js ${expectedNodeEngine} floor discoverable.`,
    );
  }
}

export function enforcePersistenceTransactionInterceptorCompatibility() {
  const compatibilityExports = [
    ['PrismaTransactionInterceptor', 'packages/prisma/src/module.ts', 'packages/prisma/src/transaction.ts'],
    ['MongooseTransactionInterceptor', 'packages/mongoose/src/module.ts', 'packages/mongoose/src/transaction.ts'],
  ];
  const contractPaths = [
    'apps/docs/content/docs/guides/persistence.mdx',
    'apps/docs/content/docs/guides/persistence.ko.mdx',
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
    'docs/architecture/transactions.md',
    'docs/architecture/transactions.ko.md',
    'docs/getting-started/migrate-from-nestjs.md',
    'docs/getting-started/migrate-from-nestjs.ko.md',
    'docs/reference/package-surface.md',
    'docs/reference/package-surface.ko.md',
  ];

  for (const [interceptor, modulePath, sourcePath] of compatibilityExports) {
    const moduleSource = readFileSync(resolve(repoRoot, modulePath), 'utf8');
    const source = readFileSync(resolve(repoRoot, sourcePath), 'utf8');

    assert(
      source.includes(`export class ${interceptor}`) && source.includes('@deprecated'),
      `${sourcePath} must keep ${interceptor} exported and deprecated for 1.x compatibility.`,
    );
    assert(moduleSource.includes(interceptor), `${modulePath} must register ${interceptor}.`);

    for (const contractPath of contractPaths) {
      assert(
        readFileSync(resolve(repoRoot, contractPath), 'utf8').includes(interceptor),
        `${contractPath} must keep ${interceptor} compatibility discoverable.`,
      );
    }
  }
}

export function main() {
  const changedFiles = changedFilesFromGit();

  enforceSsotMirrorStructure();
  enforcePackageDirectoriesHaveManifests();
  enforceReleaseGovernancePublishSurfaceSync();
  enforceCanonicalPackageSurfaceSync();
  enforceDocsHubOfficialTransportLinks();
  enforceSerializerResponseOwnershipDocsSync();
  enforceCloudflareWorkersLifecycleDocsSync();
  enforceConfigNestjsMigrationDocs();
  enforceExpressRuntimeMigrationDocsSync();
  enforceCanonicalRuntimeMatrixReferences();
  enforceRemovedRuntimeFactoryNamesNotUsedInDocs();
  enforceNoDirectProcessEnvInOrdinaryPackageSource();
  enforceNoNodeGlobalBufferInDenoAndCloudflareWorkerServices();
  enforceViteToolingDiscoverability();
  enforceReactClientSubpathContract();
  enforceHttpCatchAllRouteGrammarDecision();
  enforceGraphqlRuntimeBoundaryDiscoverability();
  enforcePersistenceTransactionInterceptorCompatibility();
  enforceMicroservicesSafetyGuidanceParity();
  enforceMicroservicesSafetyRuntimeEvidence();
  enforceAdvancedBookCoreBoundaryCompanions(changedFiles);
  enforceContractCompanionUpdates(changedFiles);
  enforceAlignmentClaimsBackedByHarness(changedFiles);

  console.log('Platform consistency governance checks passed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
