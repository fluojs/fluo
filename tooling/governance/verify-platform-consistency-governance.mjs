import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enforceAdvancedBookCoreBoundaryCompanions } from './advanced-book-core-boundary.mjs';
import { enforceConfigNestjsMigrationDocs } from './config-nestjs-migration-docs.mjs';
import { enforceDenoHostOwnedLifecycleContract } from './deno-host-owned-lifecycle-contract.mjs';
import { enforceEmailLifecycleDocsContract } from './email-lifecycle-docs-contract.mjs';
import { enforceExpressApplicationOwnershipDocs } from './express-application-ownership-docs.mjs';
import { enforceJwtAsyncRegistrationContract } from './jwt-async-registration-contract.mjs';
import { enforceJwtLearningPathModuleWiring } from './jwt-learning-path-module-wiring.mjs';
import {
  enforceMicroservicesSafetyGuidanceParity,
  enforceMicroservicesSafetyRuntimeEvidence,
} from './microservices-safety-guidance.mjs';
import { enforcePassportJsBridgeNestjsMigration } from './passport-js-bridge-nestjs-migration.mjs';
import { enforcePlatformShellLifecycleContract } from './platform-shell-lifecycle-contract.mjs';
import { enforceReactPageCatalogContract } from './react-page-catalog-contract.mjs';
import { enforceReactRscGraduationGovernance } from './react-rsc-graduation-policy.mjs';
import { enforceRequestPipelineImportBoundary } from './request-pipeline-import-boundary.mjs';
import { enforceRuntimeLifecycleNestjsMigrationDocs } from './runtime-lifecycle-nestjs-migration-docs.mjs';

const contractDiscoverabilityCompanions = ['docs/CONTEXT.md', 'docs/CONTEXT.ko.md'];

export { enforceAdvancedBookCoreBoundaryCompanions } from './advanced-book-core-boundary.mjs';
export { enforceDenoHostOwnedLifecycleContract } from './deno-host-owned-lifecycle-contract.mjs';
export { enforceEmailLifecycleDocsContract } from './email-lifecycle-docs-contract.mjs';
export { enforceExpressApplicationOwnershipDocs } from './express-application-ownership-docs.mjs';
export { enforceJwtAsyncRegistrationContract } from './jwt-async-registration-contract.mjs';
export { enforceJwtLearningPathModuleWiring } from './jwt-learning-path-module-wiring.mjs';
export {
  enforceMicroservicesSafetyGuidanceParity,
  enforceMicroservicesSafetyRuntimeEvidence,
} from './microservices-safety-guidance.mjs';
export { enforcePassportJsBridgeNestjsMigration } from './passport-js-bridge-nestjs-migration.mjs';
export { enforcePlatformShellLifecycleContract } from './platform-shell-lifecycle-contract.mjs';
export { enforceReactPageCatalogContract } from './react-page-catalog-contract.mjs';
export {
  enforceReactRscGraduationEvidenceUpdates,
  enforceReactRscGraduationGovernance,
  enforceReactRscGraduationPolicy,
} from './react-rsc-graduation-policy.mjs';
export { enforceRequestPipelineImportBoundary } from './request-pipeline-import-boundary.mjs';
export { enforceRuntimeLifecycleNestjsMigrationDocs } from './runtime-lifecycle-nestjs-migration-docs.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');
const directProcessEnvPattern = /\bprocess\s*(?:\?\.|\.)\s*env\b/g;
const nodeGlobalBufferPattern = /\bBuffer\b/g;
const nodeListenerEngineWindows = [
  { maximumMajorExclusive: 21, minimumMajor: 20, minimumMinor: 19, minimumPatch: 3 },
  { maximumMajorExclusive: 27, minimumMajor: 22, minimumMinor: 2, minimumPatch: 0 },
];
const nodeListenerEngineRange = nodeListenerEngineWindows
  .map(({ maximumMajorExclusive, minimumMajor, minimumMinor, minimumPatch }) =>
    `>=${minimumMajor}.${minimumMinor}.${minimumPatch} <${maximumMajorExclusive}`)
  .join(' || ');
const nodeListenerEngineMarker = `engines.node ${nodeListenerEngineRange}`;

export function enforceSocketIoNodeEngineAlignment(readText = read) {
  const runtimeManifest = JSON.parse(readText('packages/runtime/package.json'));
  const canonicalNodeRange = runtimeManifest.engines?.node;

  assert(
    typeof canonicalNodeRange === 'string' && canonicalNodeRange.length > 0,
    '@fluojs/runtime must declare the canonical engines.node range.',
  );

  for (const [manifestPath, packageName] of [
    ['package.json', 'root workspace'],
    ['packages/platform-nodejs/package.json', '@fluojs/platform-nodejs'],
    ['packages/socket.io/package.json', '@fluojs/socket.io'],
  ]) {
    const manifest = JSON.parse(readText(manifestPath));
    assert(
      manifest.engines?.node === canonicalNodeRange,
      `${packageName} engines.node must equal the canonical @fluojs/runtime range ${canonicalNodeRange}.`,
    );
  }
}

export function enforcePlatformFastifyEngineDocumentation(readText = read) {
  const manifest = JSON.parse(readText('packages/platform-fastify/package.json'));
  const engineRange = manifest.engines?.node;

  assert(
    typeof engineRange === 'string' && engineRange.length > 0,
    '@fluojs/platform-fastify must declare engines.node.',
  );

  for (const relativePath of [
    'apps/docs/content/docs/guides/runtime-adapters.mdx',
    'apps/docs/content/docs/guides/runtime-adapters.ko.mdx',
  ]) {
    const content = readText(relativePath);
    const fastifyHeadingMatches = [...content.matchAll(/^## Fastify\s*$/gmu)];

    assert(
      fastifyHeadingMatches.length === 1,
      `${relativePath} must include exactly one ## Fastify heading; found ${fastifyHeadingMatches.length}.`,
    );

    const fastifySectionStart = fastifyHeadingMatches[0].index;
    const nextSectionStart = content.indexOf('\n## ', fastifySectionStart + 1);
    const fastifySection = content.slice(
      fastifySectionStart,
      nextSectionStart === -1 ? undefined : nextSectionStart,
    );

    assert(
      fastifySection.includes(`\`${engineRange}\``),
      `${relativePath} Fastify section must state @fluojs/platform-fastify engines.node ${engineRange}.`,
    );
  }
}

export function enforcePlatformNodejsEngineDocumentation(readText = read) {
  const manifest = JSON.parse(readText('packages/platform-nodejs/package.json'));
  const engineRange = manifest.engines?.node;

  assert(
    typeof engineRange === 'string' && engineRange.length > 0,
    '@fluojs/platform-nodejs must declare engines.node.',
  );

  for (const relativePath of [
    'apps/docs/content/docs/guides/runtime-adapters.mdx',
    'apps/docs/content/docs/guides/runtime-adapters.ko.mdx',
  ]) {
    const content = readText(relativePath);
    const headingMatches = [...content.matchAll(/^## Raw Node\.js\s*$/gmu)];

    assert(
      headingMatches.length === 1,
      `${relativePath} must include exactly one ## Raw Node.js heading; found ${headingMatches.length}.`,
    );
    const sectionStart = headingMatches[0].index;

    const nextSectionStart = content.indexOf('\n## ', sectionStart + 1);
    const rawNodeSection = content.slice(
      sectionStart,
      nextSectionStart === -1 ? undefined : nextSectionStart,
    );

    assert(
      rawNodeSection.includes(`\`${engineRange}\``),
      `${relativePath} Raw Node.js section must state @fluojs/platform-nodejs engines.node ${engineRange}.`,
    );
  }
}

export function isSupportedNodeListenerVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (match === null) {
    return false;
  }

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  const window = nodeListenerEngineWindows.find((candidate) =>
    major >= candidate.minimumMajor && major < candidate.maximumMajorExclusive);
  if (window === undefined) {
    return false;
  }

  return major > window.minimumMajor ||
    minor > window.minimumMinor ||
    (minor === window.minimumMinor && patch >= window.minimumPatch);
}

const ssotPairs = [
  ['docs/CONTEXT.md', 'docs/CONTEXT.ko.md'],
  ['docs/architecture/http-catch-all-route-grammar.md', 'docs/architecture/http-catch-all-route-grammar.ko.md'],
  ['docs/architecture/platform-consistency-design.md', 'docs/architecture/platform-consistency-design.ko.md'],
  [
    'docs/architecture/react-render-policy-decorators.md',
    'docs/architecture/react-render-policy-decorators.ko.md',
  ],
  [
    'docs/architecture/react-page-render-policies.md',
    'docs/architecture/react-page-render-policies.ko.md',
  ],
  ['docs/contracts/behavioral-contract-policy.md', 'docs/contracts/behavioral-contract-policy.ko.md'],
  ['docs/contracts/public-export-tsdoc-baseline.md', 'docs/contracts/public-export-tsdoc-baseline.ko.md'],
  ['docs/contracts/react-rsc-graduation.md', 'docs/contracts/react-rsc-graduation.ko.md'],
  ['docs/contracts/release-governance.md', 'docs/contracts/release-governance.ko.md'],
  ['docs/contracts/platform-conformance-authoring-checklist.md', 'docs/contracts/platform-conformance-authoring-checklist.ko.md'],
  ['docs/getting-started/migrate-from-nestjs.md', 'docs/getting-started/migrate-from-nestjs.ko.md'],
  ['docs/reference/package-folder-structure.md', 'docs/reference/package-folder-structure.ko.md'],
  ['docs/reference/package-surface.md', 'docs/reference/package-surface.ko.md'],
];

const contractGateTriggers = new Set([
  'docs/architecture/auth-and-jwt.md',
  'docs/architecture/auth-and-jwt.ko.md',
  'docs/architecture/http-catch-all-route-grammar.md',
  'docs/architecture/http-catch-all-route-grammar.ko.md',
  'docs/architecture/platform-consistency-design.md',
  'docs/architecture/platform-consistency-design.ko.md',
  'docs/architecture/react-render-policy-decorators.md',
  'docs/architecture/react-render-policy-decorators.ko.md',
  'docs/architecture/react-page-render-policies.md',
  'docs/architecture/react-page-render-policies.ko.md',
  'docs/contracts/behavioral-contract-policy.md',
  'docs/contracts/behavioral-contract-policy.ko.md',
  'docs/contracts/public-export-tsdoc-baseline.md',
  'docs/contracts/public-export-tsdoc-baseline.ko.md',
  'docs/contracts/react-rsc-graduation.md',
  'docs/contracts/react-rsc-graduation.ko.md',
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
  // These shared files intentionally use only the generic contract gate; topic-specific prose
  // must not impose unrelated companion-document requirements.
  'docs/contracts/nestjs-parity-gaps.md',
  'docs/contracts/nestjs-parity-gaps.ko.md',
  // Includes Bun fetch-style lifecycle, synchronous manual fetch-host ownership,
  // pre-listen realtime binding, WebSocket runtime-subpath/return-value, and
  // metadata migration boundaries.
  'apps/docs/content/docs/guides/realtime.mdx',
  'apps/docs/content/docs/guides/realtime.ko.mdx',
  'apps/docs/content/docs/guides/runtime-adapters.mdx',
  'apps/docs/content/docs/guides/runtime-adapters.ko.mdx',
  'apps/docs/content/docs/guides/auth.mdx',
  'apps/docs/content/docs/guides/auth.ko.mdx',
  // Includes portable setCookie/clearCookie migration and cross-adapter response semantics.
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

export function enforceCliMigrationTransformDocs(readText = read) {
  const transformSource = readText('packages/cli/src/transforms/nestjs-migrate.ts');
  const transformList = /export const MIGRATION_TRANSFORMS = \[([\s\S]*?)\] as const;/u.exec(transformSource);
  assert(transformList?.[1], 'unable to read the CLI migration transform declarations.');

  const supportedTransforms = new Set([...transformList[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]));
  assert(supportedTransforms.size > 0, 'CLI migration transform declarations must not be empty.');

  const migrationDocs = [
    'docs/getting-started/migrate-from-nestjs.md',
    'docs/getting-started/migrate-from-nestjs.ko.md',
    'packages/cli/README.md',
    'packages/cli/README.ko.md',
  ];

  for (const relativePath of migrationDocs) {
    const markdown = readText(relativePath);
    const selections = [...markdown.matchAll(/--(?:only|skip)\s+([a-z]+(?:,[a-z]+)*)/gu)];
    for (const selection of selections) {
      for (const transform of selection[1].split(',')) {
        assert(
          supportedTransforms.has(transform),
          `documented migration transform "${transform}" in ${relativePath} is not supported by the CLI.`,
        );
      }
    }
  }
}

function hasOneArgumentGuardContextContract(markdown) {
  const guardCodeBlocks = [...markdown.matchAll(/```(?:typescript|ts)\s*\n([\s\S]*?)```/gu)]
    .map((match) => match[1] ?? '')
    .filter((code) => /\bcanActivate\s*\(/u.test(code));

  return guardCodeBlocks.length > 0 && guardCodeBlocks.every((code) => {
    const signatures = [...code.matchAll(/\bcanActivate\s*\(([^)]*)\)/gu)];
    return code.includes('type GuardContext') && signatures.length > 0 && signatures.every((signature) => {
      const parameter = /^\s*([A-Za-z_$][\w$]*)\s*:\s*GuardContext\s*$/u.exec(signature[1] ?? '');
      return parameter !== null && code.includes(`${parameter[1]}.requestContext.request`);
    });
  });
}

function hasRequestContextSecondArgumentGuidance(markdown) {
  return markdown.split(/\n\s*\n/gu).some((paragraph) =>
    paragraph.includes('`@RequestDto(...)`') &&
    paragraph.includes('`@FromBody(...)`') &&
    paragraph.includes('`@FromHeader(...)`') &&
    paragraph.includes('`RequestContext`') &&
    /controller/iu.test(paragraph) &&
    /(?:second\s+(?:controller\s+)?argument|두 번째\s+인자)/iu.test(paragraph));
}

export function enforceHttpBookRequestContracts(readText = read) {
  const guardChapterPaths = [
    'book/beginner/ch09-guards-interceptors.md',
    'book/beginner/ch09-guards-interceptors.ko.md',
  ];
  const bunChapterPaths = [
    'book/intermediate/ch22-bun.md',
    'book/intermediate/ch22-bun.ko.md',
  ];

  for (const chapterPath of guardChapterPaths) {
    assert(
      hasOneArgumentGuardContextContract(readText(chapterPath)),
      `${chapterPath} must use a one-argument GuardContext signature and read request data through that context's requestContext.`,
    );
  }

  for (const chapterPath of bunChapterPaths) {
    const chapter = readText(chapterPath);
    assert(
      hasRequestContextSecondArgumentGuidance(chapter) &&
        !chapter.includes('`@Body()`') &&
        !chapter.includes('`@Headers()`'),
      `${chapterPath} must keep fluo DTO field binding and explicit RequestContext as the second controller argument instead of NestJS parameter decorators.`,
    );
  }
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
  // coverage for fail-open manual transactions and root-handle ALS fallback nesting
  // that preserves ambient abort/drain ownership without atomicity, Drizzle decorated-instance
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
  // custom standard-decorator Symbol.metadata preload ordering before dynamic
  // application-graph import,
  // and Studio live helper contracts such as deterministic Mermaid rendering,
  // route-id graph correlation, viewer dependency classification, Node.js
  // tooling runtime-floor discoverability, and CLI-owned active ingestion socket
  // teardown with one shared close operation, plus Cron distributed-lock
  // lifecycle contracts such as enabled TTL validation before Redis I/O,
  // bounded shutdown lock-release I/O including the shutdown-start deadline reused
  // by post-task release/retry, timeout ownership retention, dynamic
  // blank-name rejection, immutable registry descriptor snapshots, failed-stop
  // scheduler handle retention for retryable registry disable/removal and
  // subsequent shutdown-hook cleanup, and
  // microservices facade shutdown signal forwarding plus transport-owned
  // cancellation cleanup docs/tests, Queue's package-level Node.js runtime
  // floor discoverability and Queue migration from NestJS/Bull processor metadata
  // to explicit singleton worker registration, jobName/payload cutover,
  // cross-scope Redis/jobName ownership collision rejection, and
  // bootstrap-ready/bounded-shutdown ownership, notifications queue opt-in, status
  // details, and generated identity diagnostics contracts, plus Slack singleton
  // provider discoverability, bootstrap verification settlement before shutdown,
  // and owned transport cleanup serialization docs/tests,
  // plus CQRS provider-token fan-out, private immutable dispatch topology state,
  // single-owner same-token nested saga continuation, full handler/saga/delegated
  // pipeline ordering, and shutdown authorization,
  // plus event-bus background handler/transport shutdown drain to live-set
  // quiescence under one deadline, inbound timeout, stable eventKey migration,
  // and CQRS responsibility-boundary docs/tests,
  // plus HTTP trust-proxy connection identity scope, where forwarding metadata
  // can replace direct transport identity only behind an explicit trusted peer
  // boundary and legacy full-chain compatibility remains distinct,
  // plus React Router/Path facade-over-HTTP metadata, ReactModule.forRoot
  // registration contract discoverability, inherited class/method render-policy
  // ordering, nearest Suspense fallback selection, request-scope renderer context,
  // bootstrap diagnostics for invalid/duplicate policies or missing renderPage,
  // stable path-only @fluojs/react/typegen output with locale-independent ordering,
  // route-bound real-anchor props, and typed push/replace href resolution,
  // stable SSR phase boundaries,
  // isolated Vite/client/experimental-RSC subpaths, HTTP-first full-document
  // navigation, exact RSC version diagnostics, explicit client-reference and
  // server-to-client module maps, HTTP-dispatched Flight responses, and the
  // root package's non-goals for RSC exports, client route tables, and caches,
  // plus OpenAPI's
  // explicit descriptor adoption, response metadata, configurable document/UI
  // route defaults, normalized multi-instance route-collision failures, Swagger
  // UI assets, operation collision-precedence boundaries, and legacy nullable
  // input normalization to OpenAPI 3.1 null unions, plus GraphQL's explicit
  // resolver/provider wiring, root and object-field resolver boundaries, output type declarations,
  // Node.js runtime-floor/dependency alignment, unsupported non-Node targets,
  // and server-backed WebSocket migration boundaries, plus JWT refresh-token
  // family-scoped reuse revocation, subject-wide compatibility fallback, and
  // consume-only rotation regression coverage, plus Socket.IO configured-transport
  // enforcement parity across Node-backed and Bun engine paths, plus WebSocket room injection
  // token discoverability (WebSocketRoomService as a type-only contract injected
  // via @Inject(...) with root WebSocketGatewayLifecycleService, explicit Node
  // NodeWebSocketGatewayLifecycleService, or the matching runtime-subpath token)
  // and room broadcast backpressure runtime limits (Node.js-backed adapter only;
  // fetch-style runtimes do not apply a backpressure policy to room broadcasts),
  // plus terminal Node upgrade admission and retained disconnect lifecycle state
  // across the bounded cross-runtime shutdown drain, plus HTTP request-observer
  // success ordering after module and application middleware fully settle,
  // plus @nestjs/config migration call-shape and bootstrap ownership boundaries
  // where ConfigModule never reads external secret Providers itself and
  // ConfigService.get/getOrThrow accept a single key with no NestJS
  // default-value or options overload, plus JWT refresh-token-specific HMAC
  // algorithm policy separation from narrow access-token algorithm allowlists.

  assert(
    contractDiscoverabilityCompanions.every((path) => hasChanged(changedFiles, path)),
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
  // payload clone, byte-safe TCP UTF-8 framing, TCP 1 MiB frames, port:0 routing,
  // shutdown send guards, concurrent close-promise sharing, and gRPC abort-listener
  // cleanup docs are also covered by this companion path.
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

const denoManagedStartupCommand = 'deno run --allow-net main.ts';
const denoNativeDevCommand = 'deno run --watch --allow-env --allow-net src/main.ts';
const denoCompileCommand = 'deno compile --allow-env --allow-net --output dist/app src/main.ts';
const invalidDenoPermissionPatterns = [
  /deno run --allow-net --allow-env main\.ts/u,
  /deno run(?: --watch)? --allow-env=PORT --allow-net src\/main\.ts/u,
  /deno compile --allow-env=PORT --allow-net --output dist\/app src\/main\.ts/u,
];
const denoPermissionGuidanceRequirements = [
  [
    'packages/platform-deno/README.md',
    [denoManagedStartupCommand, '--allow-env=PORT,DATABASE_URL', 'shutdownSignals: false', 'does not read environment variables', 'does not require a separate Deno permission'],
  ],
  [
    'packages/platform-deno/README.ko.md',
    [denoManagedStartupCommand, '--allow-env=PORT,DATABASE_URL', 'shutdownSignals: false', 'environment variable을 읽지 않습니다', '별도의 Deno permission이 필요하지 않'],
  ],
  [
    'apps/docs/content/docs/guides/runtime-adapters.mdx',
    [denoManagedStartupCommand, '--allow-env=PORT,DATABASE_URL', 'shutdownSignals: false', 'does not read environment variables', 'does not require a separate Deno permission'],
  ],
  [
    'apps/docs/content/docs/guides/runtime-adapters.ko.mdx',
    [denoManagedStartupCommand, '--allow-env=PORT,DATABASE_URL', 'shutdownSignals: false', 'environment variable을 읽지 않습니다', '별도의 Deno permission이 필요하지 않'],
  ],
  [
    'book/intermediate/ch23-deno.md',
    [denoManagedStartupCommand, '--allow-env=PORT,DATABASE_URL', 'shutdownSignals: false', 'does not read environment variables', 'does not require a separate Deno permission'],
  ],
  [
    'book/intermediate/ch23-deno.ko.md',
    [denoManagedStartupCommand, '--allow-env=PORT,DATABASE_URL', 'shutdownSignals: false', 'environment variable을 읽지 않습니다', '별도의 Deno permission이 필요하지 않'],
  ],
  [
    'docs/CONTEXT.md',
    [denoManagedStartupCommand, '--allow-env=<keys>', 'shutdownSignals: false', 'does not require environment access', 'does not require a separate Deno permission'],
  ],
  [
    'docs/CONTEXT.ko.md',
    [denoManagedStartupCommand, '--allow-env=<keys>', 'shutdownSignals: false', 'environment 접근 권한이 필요하지 않', '별도의 Deno permission이 필요하지 않'],
  ],
  [
    'packages/cli/src/new/scaffold.ts',
    [denoNativeDevCommand, denoCompileCommand, 'Deno.env.toObject()'],
  ],
  ['packages/cli/README.md', [denoNativeDevCommand, denoCompileCommand]],
  ['packages/cli/README.ko.md', [denoNativeDevCommand, denoCompileCommand]],
  ['docs/reference/toolchain-contract-matrix.md', [denoNativeDevCommand, denoCompileCommand]],
  ['docs/reference/toolchain-contract-matrix.ko.md', [denoNativeDevCommand, denoCompileCommand]],
  ['docs/architecture/dev-reload-architecture.md', [denoNativeDevCommand]],
  ['docs/architecture/dev-reload-architecture.ko.md', [denoNativeDevCommand]],
];

export function enforceDenoPermissionGuidance(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of denoPermissionGuidanceRequirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    assert(
      missingMarkers.length === 0,
      `${relativePath} must keep Deno permission guidance synchronized; missing: ${missingMarkers.join(', ')}.`,
    );
    assert(
      invalidDenoPermissionPatterns.every((pattern) => !pattern.test(content)),
      `${relativePath} must not include invalid Deno permission syntax or narrow generated application env access.`,
    );
  }
}

const cloudflareWorkerFetchEnvMarkers = {
  english: [
    'cannot supply `ConfigModule.forRoot(...)` or singleton bootstrap providers',
    'application-shaped values',
  ],
  korean: [
    '`ConfigModule.forRoot(...)` 또는 singleton bootstrap provider를 구성할 수 없습니다',
    'application-shaped 값',
  ],
};

const cloudflareWorkerFetchEnvForbiddenClaims = {
  english: [
    /(?:env|bindings?)[^.\n]*\b(?:can|may|should|must|is|are)\b\s+(?:be\s+)?(?:mapped|passed|supplied|registered|captured)[^.\n]*(?:`ConfigModule\.forRoot\(\.\.\.\)`|`@fluojs\/config`|bootstrap(?:-time)? provider)/iu,
    /\bmap\b[^.\n]*(?:env|bindings?)[^.\n]*(?:`ConfigModule\.forRoot\(\.\.\.\)`|`@fluojs\/config`|bootstrap(?:-time)? provider)/iu,
  ],
  korean: [
    /(?:env|binding)[^.\n]*(?:`ConfigModule\.forRoot\(\.\.\.\)`|`@fluojs\/config`|bootstrap(?:-time)? provider)[^.\n]*(?:매핑|전달|공급|등록|캡처)(?:하고|해야|하세요|합니다|할 수 있)/u,
    /(?:env|binding)[^.\n]*(?:매핑|전달|공급|등록|캡처)(?:하고|해야|하세요|합니다|할 수 있)[^.\n]*(?:`ConfigModule\.forRoot\(\.\.\.\)`|`@fluojs\/config`|bootstrap(?:-time)? provider)/u,
  ],
};

const cloudflareWorkerFetchEnvGovernedDocs = [
  ['packages/platform-cloudflare-workers/README.md', cloudflareWorkerFetchEnvForbiddenClaims.english],
  ['packages/platform-cloudflare-workers/README.ko.md', cloudflareWorkerFetchEnvForbiddenClaims.korean],
  ['book/intermediate/ch24-cloudflare.md', cloudflareWorkerFetchEnvForbiddenClaims.english],
  ['book/intermediate/ch24-cloudflare.ko.md', cloudflareWorkerFetchEnvForbiddenClaims.korean],
  ['docs/getting-started/migrate-from-nestjs.md', cloudflareWorkerFetchEnvForbiddenClaims.english],
  ['docs/getting-started/migrate-from-nestjs.ko.md', cloudflareWorkerFetchEnvForbiddenClaims.korean],
  ['apps/docs/content/docs/guides/runtime-adapters.mdx', cloudflareWorkerFetchEnvForbiddenClaims.english],
  ['apps/docs/content/docs/guides/runtime-adapters.ko.mdx', cloudflareWorkerFetchEnvForbiddenClaims.korean],
  ['docs/CONTEXT.md', cloudflareWorkerFetchEnvForbiddenClaims.english],
  ['docs/CONTEXT.ko.md', cloudflareWorkerFetchEnvForbiddenClaims.korean],
];

const cloudflareWorkersLifecycleDocRequirements = [
  ['packages/platform-cloudflare-workers/README.md', ['CloudflareWorkersWebSocketModule.forRoot()', 'app.listen()', 'timed-out close', ...cloudflareWorkerFetchEnvMarkers.english]],
  ['packages/platform-cloudflare-workers/README.ko.md', ['CloudflareWorkersWebSocketModule.forRoot()', 'app.listen()', 'timed-out close', ...cloudflareWorkerFetchEnvMarkers.korean]],
  ['docs/reference/package-surface.md', ['executionContext.waitUntil(...)', 'underlying drain', 'bootstrap a fresh application']],
  ['docs/reference/package-surface.ko.md', ['executionContext.waitUntil(...)', 'underlying drain', '새 application을 bootstrap']],
  ['book/intermediate/ch24-cloudflare.md', ['CloudflareWorkersWebSocketModule.forRoot()', 'ctx.waitUntil()', 'underlying drain', ...cloudflareWorkerFetchEnvMarkers.english, 'Partial<WorkerEnv>', 'export class WorkerBindingsModule', 'export class DatabaseModule']],
  ['book/intermediate/ch24-cloudflare.ko.md', ['CloudflareWorkersWebSocketModule.forRoot()', 'ctx.waitUntil()', 'underlying drain', ...cloudflareWorkerFetchEnvMarkers.korean, 'Partial<WorkerEnv>', 'export class WorkerBindingsModule', 'export class DatabaseModule']],
  ['docs/getting-started/migrate-from-nestjs.md', ['fetch(request, env, ctx)', 'CloudflareWorkersWebSocketModule.forRoot()', 'ctx.waitUntil(...)', '@fluojs/config', ...cloudflareWorkerFetchEnvMarkers.english]],
  ['docs/getting-started/migrate-from-nestjs.ko.md', ['fetch(request, env, ctx)', 'CloudflareWorkersWebSocketModule.forRoot()', 'ctx.waitUntil(...)', '@fluojs/config', ...cloudflareWorkerFetchEnvMarkers.korean]],
  ['apps/docs/content/docs/guides/runtime-adapters.mdx', ['CloudflareWorkersWebSocketModule.forRoot()', 'executionContext.waitUntil(...)', 'request.cloudflare.env', 'underlying drain', ...cloudflareWorkerFetchEnvMarkers.english, 'Partial<WorkerEnv>', 'export class WorkerBindingsModule']],
  ['apps/docs/content/docs/guides/runtime-adapters.ko.mdx', ['CloudflareWorkersWebSocketModule.forRoot()', 'executionContext.waitUntil(...)', 'request.cloudflare.env', 'underlying drain', ...cloudflareWorkerFetchEnvMarkers.korean, 'Partial<WorkerEnv>', 'export class WorkerBindingsModule']],
  ['apps/docs/content/docs/guides/realtime.mdx', ['CloudflareWorkersWebSocketModule.forRoot()', 'executionContext.waitUntil(...)', 'JSON `503`']],
  ['apps/docs/content/docs/guides/realtime.ko.mdx', ['CloudflareWorkersWebSocketModule.forRoot()', 'executionContext.waitUntil(...)', 'JSON `503`']],
  ['docs/CONTEXT.md', ['packages/platform-cloudflare-workers/README.md', 'docs/getting-started/migrate-from-nestjs.md', 'website runtime/realtime guides', 'fetch-time `env` boundary is mirrored specifically in the package README, intermediate book, NestJS migration map, and website runtime guide', 'request-bound bindings are validated and narrowed']],
  ['docs/CONTEXT.ko.md', ['packages/platform-cloudflare-workers/README.ko.md', 'docs/getting-started/migrate-from-nestjs.ko.md', 'website runtime/realtime guide', 'Fetch-time `env` boundary는 package README, intermediate book, NestJS migration map, website runtime guide에만 명시적으로 반영', 'request-bound binding은 application-shaped 값이 provider method에 전달되기 전에 검증하고 좁혀야 합니다']],
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

  for (const [relativePath, forbiddenClaims] of cloudflareWorkerFetchEnvGovernedDocs) {
    const content = readText(relativePath);

    assert(
      forbiddenClaims.every((pattern) => !pattern.test(content)),
      `${relativePath} must not map request-bound Worker env into bootstrap configuration or singleton bootstrap providers.`,
    );
  }
}

const expressRuntimeMigrationDocRequirements = [
  [
    'packages/platform-express/README.md',
    [nodeListenerEngineRange, 'engines.node', 'TC39 standard decorators', 'explicit module/provider registration'],
  ],
  [
    'packages/platform-express/README.ko.md',
    [nodeListenerEngineRange, 'engines.node', 'TC39 표준 데코레이터', '명시적 module/provider registration'],
  ],
  [
    'docs/reference/package-surface.md',
    [nodeListenerEngineRange, 'engines.node', 'TC39 standard decorator', 'explicit DI/module wiring'],
  ],
  [
    'docs/reference/package-surface.ko.md',
    [nodeListenerEngineRange, 'engines.node', 'TC39 표준 데코레이터', '명시적 DI/module wiring'],
  ],
  [
    'docs/reference/package-chooser.md',
    [nodeListenerEngineRange, 'engines.node', 'TC39 standard decorators', 'explicit DI/module wiring'],
  ],
  [
    'docs/reference/package-chooser.ko.md',
    [nodeListenerEngineRange, 'engines.node', 'TC39 표준 데코레이터', '명시적 DI/module wiring'],
  ],
  [
    'docs/getting-started/migrate-from-nestjs.md',
    [nodeListenerEngineRange, 'TC39 standard decorators', 'class-level `@Inject(...)`', 'explicit module/provider registration'],
  ],
  [
    'docs/getting-started/migrate-from-nestjs.ko.md',
    [nodeListenerEngineRange, 'TC39 표준 데코레이터', 'class-level `@Inject(...)`', '명시적 module/provider registration'],
  ],
  [
    'book/intermediate/ch21-express-node.md',
    [nodeListenerEngineRange, 'engines.node', 'getListenTarget()', 'explicit DI/module wiring'],
  ],
  [
    'book/intermediate/ch21-express-node.ko.md',
    [nodeListenerEngineRange, 'engines.node', 'getListenTarget()', '명시적 DI/module wiring'],
  ],
  [
    'apps/docs/content/docs/guides/runtime-adapters.mdx',
    [nodeListenerEngineRange, 'engines.node', 'getListenTarget()', 'explicit DI/module wiring'],
  ],
  [
    'apps/docs/content/docs/guides/runtime-adapters.ko.mdx',
    [nodeListenerEngineRange, 'engines.node', 'getListenTarget()', '명시적 DI/module wiring'],
  ],
  [
    'docs/CONTEXT.md',
    [nodeListenerEngineRange, 'engines.node', 'getListenTarget()', 'explicit DI/module wiring'],
  ],
  [
    'docs/CONTEXT.ko.md',
    [nodeListenerEngineRange, 'engines.node', 'getListenTarget()', '명시적 DI/module wiring'],
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
  const fastifyAdapterSource = readFileSync(join(repoRoot, 'packages/platform-fastify/src/adapter.ts'), 'utf8');
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
  const cronReadme = readFileSync(join(repoRoot, 'packages/cron/README.md'), 'utf8');
  const cronReadmeKo = readFileSync(join(repoRoot, 'packages/cron/README.ko.md'), 'utf8');
  const cronChapter = readFileSync(join(repoRoot, 'book/intermediate/ch12-cron.md'), 'utf8');
  const cronChapterKo = readFileSync(join(repoRoot, 'book/intermediate/ch12-cron.ko.md'), 'utf8');
  const lifecycleAndShutdown = readFileSync(join(repoRoot, 'docs/architecture/lifecycle-and-shutdown.md'), 'utf8');
  const lifecycleAndShutdownKo = readFileSync(join(repoRoot, 'docs/architecture/lifecycle-and-shutdown.ko.md'), 'utf8');
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
    fastifyReadme.includes(nodeListenerEngineMarker) &&
      fastifyReadme.includes('Node.js `https.ServerOptions`') &&
      fastifyReadme.includes('createFastifyAdapter(...)') &&
      fastifyReadme.includes('bootstrapFastifyApplication(...)') &&
      fastifyReadme.includes('runFastifyApplication(...)') &&
      packageSurface.includes('Fastify-backed Node `http`/`https` listener') &&
      packageChooser.includes('Need Fastify-owned HTTPS/TLS startup') &&
      packageChooser.includes('plain HTTP behind that boundary') &&
      docsContext.includes('Fastify adapter discoverability') &&
      docsContext.includes('apps/docs/content/docs/guides/runtime-adapters.mdx') &&
      docsContext.includes(nodeListenerEngineMarker) &&
      beginnerIntro.includes(nodeListenerEngineRange) &&
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
    fastifyReadmeKo.includes(nodeListenerEngineMarker) &&
      fastifyReadmeKo.includes('Node.js `https.ServerOptions`') &&
      fastifyReadmeKo.includes('createFastifyAdapter(...)') &&
      fastifyReadmeKo.includes('bootstrapFastifyApplication(...)') &&
      fastifyReadmeKo.includes('runFastifyApplication(...)') &&
      packageSurfaceKo.includes('Fastify 기반 Node `http`/`https` listener') &&
      packageChooserKo.includes('Fastify가 HTTPS/TLS 시작을 직접 소유해야 함') &&
      packageChooserKo.includes('일반 HTTP로 유지하세요') &&
      docsContextKo.includes('Fastify adapter discoverability') &&
      docsContextKo.includes('apps/docs/content/docs/guides/runtime-adapters.ko.mdx') &&
      docsContextKo.includes(nodeListenerEngineMarker) &&
      beginnerIntroKo.includes(nodeListenerEngineRange) &&
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
    fastifyReadme.includes('`shutdownTimeoutMs: 0` starts Fastify close immediately') &&
      fastifyReadme.includes('the wait may time out on the next timer turn') &&
      fastifyReadme.includes('the underlying Fastify close and cleanup continue') &&
      fastifyReadme.includes('starts listening before it resolves, installs shutdown registration') &&
      fastifyReadme.includes('returns the running application shell') &&
      !fastifyReadme.includes('the caller still invokes') &&
      fastifyAdapterSource.includes('awaits `listen()`') &&
      fastifyAdapterSource.includes('only then returns the running application') &&
      fastifyAdapterSource.includes('@returns A running application shell after listening succeeds and shutdown registration completes.') &&
      !fastifyAdapterSource.includes('callers only need to invoke `listen()`') &&
      !fastifyAdapterSource.includes('ready to listen'),
    'Fastify README and public TSDoc must document zero-timeout close ordering and run-helper-owned listening.',
  );
  assert(
    fastifyReadmeKo.includes('`shutdownTimeoutMs: 0`은 Fastify close를 즉시 시작') &&
      fastifyReadmeKo.includes('대기는 다음 timer turn에 timeout될 수 있지만') &&
      fastifyReadmeKo.includes('기반 Fastify close와 cleanup은 계속 진행') &&
      fastifyReadmeKo.includes('resolve되기 전에 listening을 시작하고 shutdown registration을 설치') &&
      fastifyReadmeKo.includes('실행 중인 application shell을 반환') &&
      !fastifyReadmeKo.includes('caller는 여전히'),
    'Korean Fastify README must document zero-timeout close ordering and run-helper-owned listening.',
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
    packageSurface.includes('NormalizedCacheModuleOptions') && packageSurface.includes('CacheModule.forRootAsync') &&
      docsContext.includes('NormalizedCacheModuleOptions') && docsContext.includes('CacheModule.forRootAsync') &&
      cacheManagerReadme.includes('NormalizedCacheModuleOptions') && cacheManagerReadme.includes('CacheModule.forRootAsync'),
    'cache-manager package-surface, docs/CONTEXT.md, and README.md must keep async registration and the compatibility export discoverable together.',
  );
  assert(
    packageSurfaceKo.includes('NormalizedCacheModuleOptions') && packageSurfaceKo.includes('CacheModule.forRootAsync') &&
      docsContextKo.includes('NormalizedCacheModuleOptions') && docsContextKo.includes('CacheModule.forRootAsync') &&
      cacheManagerReadmeKo.includes('NormalizedCacheModuleOptions') && cacheManagerReadmeKo.includes('CacheModule.forRootAsync'),
    'cache-manager package-surface.ko.md, docs/CONTEXT.ko.md, and README.ko.md must keep async registration and the compatibility export discoverable together.',
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
    packageSurface.includes('per-acquisition lease tokens') &&
      packageSurface.includes('rejects late queued ticks') &&
      docsContext.includes('committed scheduler handle token') &&
      docsContext.includes('distinct lease token') &&
      cronReadme.includes('unique lease token') &&
      cronReadme.includes('already queued') &&
      cronChapter.includes('provisional replacement tick-gated') &&
      lifecycleAndShutdown.includes('distinct Redis lease token'),
    'Cron English contract surfaces must keep shutdown tick admission, transactional replacement handles, and per-acquisition lease fencing aligned.',
  );
  assert(
    packageSurfaceKo.includes('per-acquisition lease token') &&
      packageSurfaceKo.includes('late queued tick') &&
      docsContextKo.includes('committed scheduler handle token') &&
      docsContextKo.includes('서로 다른 lease token') &&
      cronReadmeKo.includes('고유한 lease token') &&
      cronReadmeKo.includes('이미 queue된 callback') &&
      cronChapterKo.includes('provisional replacement의 tick을 gate') &&
      lifecycleAndShutdownKo.includes('서로 다른 Redis lease token'),
    'Cron Korean contract surfaces must keep shutdown tick admission, transactional replacement handles, and per-acquisition lease fencing aligned.',
  );
  assert(
    packageSurface.includes('@fluojs/socket.io') &&
      packageSurface.includes('runtime limits') &&
      docsContext.includes('packages/socket.io/README.md') &&
      docsContext.includes('SocketIoHandshakeRequest') &&
      docsContext.includes('guard acceptance for `true` / `undefined` / no return') &&
      docsContext.includes('Node.js `>=20.19.3 <21 || >=22.2.0 <27` server-backed') &&
      docsContext.includes('all-runtime no-`serverBacked` gateway caveats') &&
      docsContext.includes('explicit ACK callback handling') &&
      docsContext.includes('bounded accepted-work drain plus force-disconnect/retry semantics'),
    'docs/CONTEXT.md must keep Socket.IO runtime limits, public guard request typing, ACK, guard, Bun caveat, and shutdown retry guidance discoverable when package-surface.md documents them.',
  );
  assert(
    packageSurfaceKo.includes('@fluojs/socket.io') &&
      packageSurfaceKo.includes('런타임 제한') &&
      docsContextKo.includes('packages/socket.io/README.ko.md') &&
      docsContextKo.includes('SocketIoHandshakeRequest') &&
      docsContextKo.includes('return 없음은 허용') &&
      docsContextKo.includes('Node.js `>=20.19.3 <21 || >=22.2.0 <27` server-backed') &&
      docsContextKo.includes('모든 runtime의 no-`serverBacked` gateway caveat') &&
      docsContextKo.includes('명시적 ACK callback') &&
      docsContextKo.includes('bounded accepted-work drain과 force-disconnect/retry semantic'),
    'docs/CONTEXT.ko.md must keep Socket.IO runtime limits, public guard request typing, ACK, guard, Bun caveat, and shutdown retry guidance discoverable when package-surface.ko.md documents them.',
  );
  assert(
    packageSurface.includes('@fluojs/websockets/bun') &&
      packageSurface.includes('shared decorator and metadata authoring primitives') &&
      packageSurface.includes('ignored raw handler return values') &&
      packageSurface.includes('(payload, socket, request, socketId)') &&
      packageSurface.includes("replies: { mode: 'event-envelope' }") &&
      packageSurface.includes('thrown HTTP exceptions') &&
      packageSurface.includes('token-only root `WebSocketGatewayLifecycleService`') &&
      packageSurface.includes('terminal Node shutdown admission gate') &&
      packageSurface.includes('retained per-connection lifecycle state') &&
      docsContext.includes('packages/websockets/README.md') &&
      docsContext.includes('@fluojs/websockets/cloudflare-workers') &&
      docsContext.includes('metadata authoring primitives') &&
      docsContext.includes('thrown HTTP exceptions') &&
      docsContext.includes('ignored raw WebSocket handler return values') &&
      docsContext.includes('(payload, socket, request, socketId)') &&
      docsContext.includes("replies: { mode: 'event-envelope' }") &&
      docsContext.includes('token-only `WebSocketGatewayLifecycleService`') &&
      docsContext.includes('terminal Node shutdown admission') &&
      docsContext.includes('retained per-connection lifecycle state'),
    'docs/CONTEXT.md must keep WebSockets runtime subpaths, shared authoring primitives, guard rejection modes, ignored returns, token-only lifecycle service, terminal upgrade admission, and retained disconnect drain state discoverable when package-surface.md documents them.',
  );
  assert(
    packageSurfaceKo.includes('@fluojs/websockets/bun') &&
      packageSurfaceKo.includes('metadata authoring primitive') &&
      packageSurfaceKo.includes('await 완료 뒤 무시되는 raw handler return value') &&
      packageSurfaceKo.includes('(payload, socket, request, socketId)') &&
      packageSurfaceKo.includes("replies: { mode: 'event-envelope' }") &&
      packageSurfaceKo.includes('throw된 HTTP exception') &&
      packageSurfaceKo.includes('token-only root `WebSocketGatewayLifecycleService`') &&
      packageSurfaceKo.includes('upgrade accept 직전에') &&
      packageSurfaceKo.includes('connection별 lifecycle state retention') &&
      docsContextKo.includes('packages/websockets/README.ko.md') &&
      docsContextKo.includes('@fluojs/websockets/cloudflare-workers') &&
      docsContextKo.includes('metadata authoring primitive') &&
      docsContextKo.includes('throw된 HTTP exception') &&
      docsContextKo.includes('raw WebSocket handler return value') &&
      docsContextKo.includes('(payload, socket, request, socketId)') &&
      docsContextKo.includes("replies: { mode: 'event-envelope' }") &&
      docsContextKo.includes('token-only `WebSocketGatewayLifecycleService`') &&
      docsContextKo.includes('upgrade accept 직전에') &&
      docsContextKo.includes('connection별 lifecycle state retention'),
    'docs/CONTEXT.ko.md must keep WebSockets runtime subpaths, shared authoring primitives, guard rejection modes, ignored returns, token-only lifecycle service, terminal upgrade admission, and retained disconnect drain state discoverable when package-surface.ko.md documents them.',
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

export function enforceReactPageMetadataIdentityContract() {
  const metadataSource = read('packages/react/src/page-metadata.ts');
  const metadataTest = read('packages/react/src/page-metadata.test.ts');
  const englishReadme = read('packages/react/README.md');
  const koreanReadme = read('packages/react/README.ko.md');
  const englishDecision = read('docs/architecture/react-page-render-policies.md');
  const koreanDecision = read('docs/architecture/react-page-render-policies.ko.md');
  const englishContext = read('docs/CONTEXT.md');
  const koreanContext = read('docs/CONTEXT.ko.md');

  assert(
    metadataSource.includes("JSON.stringify(['name', meta.name])") &&
      metadataSource.includes("JSON.stringify(['property', meta.property])"),
    'React page metadata source must identify meta descriptors by the present name or property value without content.',
  );
  assert(
    metadataTest.includes("{ content: 'base', name: 'description' }") &&
      metadataTest.includes("{ content: 'base method', name: 'description' }"),
    'React page metadata tests must cover later content replacing an earlier descriptor with the same name identity.',
  );
  assert(
    englishReadme.includes('same `name` or `property`') &&
      englishDecision.includes('`content` is not part of identity') &&
      englishContext.includes('`content` is not part of identity'),
    'English React metadata docs must identify meta descriptors by name or property and exclude content from identity.',
  );
  assert(
    koreanReadme.includes('같은 `name` 또는 `property` identity') &&
      koreanDecision.includes('`content`는 identity에 포함하지 않는다') &&
      koreanContext.includes('`content`는 identity에 포함하지 않으므로'),
    'Korean React metadata docs must identify meta descriptors by name or property and exclude content from identity.',
  );
}

export function enforceReactServerFunctionContract() {
  const rscEntrypoint = read('packages/react/src/experimental/rsc.ts');
  const rootEntrypoint = read('packages/react/src/index.ts');
  const clientEntrypoint = read('packages/react/src/client.ts');
  const serverSource = read('packages/react/src/experimental/server-functions-server.ts');
  const referenceSource = read('packages/react/src/experimental/server-functions-reference.ts');
  const securityTest = read('packages/react/src/experimental/server-functions-security.test.ts');
  const dispatchTest = read('packages/react/src/experimental/server-functions-dispatch.test.ts');
  const englishReadme = read('packages/react/README.md');
  const koreanReadme = read('packages/react/README.ko.md');
  const documentation = [
    englishReadme,
    koreanReadme,
    read('docs/CONTEXT.md'),
    read('docs/CONTEXT.ko.md'),
    read('docs/reference/package-surface.md'),
    read('docs/reference/package-surface.ko.md'),
    read('docs/reference/package-chooser.md'),
    read('docs/reference/package-chooser.ko.md'),
  ];

  for (const exportedSymbol of [
    'createReactServerFunctionRegistry',
    'createReactServerFunctionClient',
    'REACT_SERVER_FUNCTION_ERROR_CODES',
    'REACT_SERVER_FUNCTION_REQUEST_HEADER',
  ]) {
    assert(
      rscEntrypoint.includes(exportedSymbol),
      `packages/react/src/experimental/rsc.ts must export ${exportedSymbol} from the unstable subpath.`,
    );
  }

  assert(
    !rootEntrypoint.includes('server-function') && !clientEntrypoint.includes('server-function'),
    'Stable @fluojs/react root and client entrypoints must keep experimental Server Function code isolated.',
  );

  for (const contract of [
    'allowedOrigins',
    'application/json',
    'maxBodyBytes',
    'maxResultBytes',
    'REACT_SERVER_FUNCTION_REQUEST_HEADER',
    'RequestContext',
  ]) {
    assert(serverSource.includes(contract), `Server Function server transport must enforce ${contract}.`);
  }
  assert(
    referenceSource.includes('HMAC') && referenceSource.includes('SHA-256') && referenceSource.includes('secret.byteLength < 32'),
    'Server Function references must keep HMAC-SHA-256 integrity and the 32-byte secret floor enforced.',
  );

  for (const markdown of documentation) {
    assert(
      markdown.includes('@fluojs/react/experimental/rsc') && markdown.includes('Server Function'),
      'React Server Function docs must keep the unstable subpath discoverable across bilingual package and reference surfaces.',
    );
  }
  for (const readme of [englishReadme, koreanReadme]) {
    for (const contract of [
      'REACT_SERVER_FUNCTION_ACTION_NOT_FOUND',
      'REACT_SERVER_FUNCTION_ARGUMENT_SERIALIZATION_FAILED',
      'x-fluo-react-action',
      'pre-parse',
    ]) {
      assert(readme.includes(contract), `React package README mirrors must document ${contract}.`);
    }
  }

  for (const evidence of [
    'tampered',
    'unsafe serialized arguments',
    'body-size, origin, content-type, and CSRF marker',
    'unsafe action result',
  ]) {
    assert(securityTest.includes(evidence), `Server Function security regressions must cover ${evidence}.`);
  }
  for (const evidence of ['middleware', 'guards', 'interceptors', 'isolated request scopes', 'unauthorized']) {
    assert(dispatchTest.includes(evidence), `Server Function dispatch regressions must cover ${evidence}.`);
  }
}

export function enforceHttpRuntimeCancellationAndContextIsolation() {
  const abortSource = read('packages/http/src/dispatch/request-abort.ts');
  const dispatcherSource = read('packages/http/src/dispatch/dispatcher.ts');
  const fastPathSource = read('packages/http/src/dispatch/fast-path/fast-path-executor.ts');
  const contextSource = read('packages/http/src/context/request-context.ts');
  const nodeRootSource = read('packages/http/src/index.ts');
  const portableRootSource = read('packages/http/src/index.portable.ts');
  const httpPackage = JSON.parse(read('packages/http/package.json'));
  const cancellationRegression = read('packages/http/src/dispatch/dispatcher-cancellation.test.ts');
  const contextRegression = read('packages/http/src/context/request-context-isolation.test.ts');
  const fastPathScopeRegression = read('packages/http/src/dispatch/dispatcher-fast-path-scope.test.ts');
  const sseBackpressureRegression = read(
    'packages/http/src/dispatch/dispatcher-sse-backpressure-cancellation.test.ts',
  );

  assert(
    abortSource.includes('request.isAborted?.() === true || request.signal?.aborted === true'),
    'HTTP request cancellation must treat isAborted() and signal.aborted as independent authoritative surfaces.',
  );
  assert(
    dispatcherSource.includes("import { isRequestAborted } from './request-abort.js';") &&
      fastPathSource.includes("import { isRequestAborted } from '../request-abort.js';"),
    'Full and fast HTTP dispatch must share the dual-surface request abort decision.',
  );
  assert(
    !contextSource.includes('Promise.prototype') &&
      contextSource.includes('getFallbackRequestContextStore().run(context, callback)'),
    'Lazy request-context resolution must use a request-local store or synchronous fallback without patching Promise.prototype.',
  );
  assert(
    nodeRootSource.includes("from 'node:async_hooks'") &&
      nodeRootSource.includes('registerImmediateAsyncLocalStorageConstructor(AsyncLocalStorage)') &&
      !portableRootSource.includes('node:async_hooks') &&
      httpPackage.exports?.['.']?.node === './dist/index.js' &&
      httpPackage.exports?.['.']?.import === './dist/index.portable.js',
    'HTTP root export conditions must provide synchronous Node async storage without adding Node built-ins to the portable root.',
  );
  assert(
    cancellationRegression.includes('request.isAborted = () => false') &&
      cancellationRegression.includes('request.signal = abortController.signal'),
    'HTTP cancellation regressions must cover a false adapter probe paired with an aborted signal.',
  );
  assert(
    contextRegression.includes('Promise.prototype.then') &&
      contextRegression.includes('unrelatedRequestId') &&
      contextRegression.includes("createContext('promise-callback')") &&
      contextRegression.includes("createContext('request-a')") &&
      contextRegression.includes("createContext('request-b')"),
    'HTTP request-context regressions must cover Promise prototype stability, promise-returning callbacks, concurrent requests, and unrelated continuation isolation.',
  );
  assert(
    dispatcherSource.includes(
      'const controller = await context.dispatchScope.container.resolve(handler.controllerToken as Token<object>);',
    ) &&
      !dispatcherSource.includes('controllerPromise?: Promise<object>') &&
      !dispatcherSource.includes('runtimeCache.controller'),
    'HTTP fast-path dispatch must leave controller lifetime caching to the active DI container.',
  );
  assert(
    fastPathScopeRegression.includes("@ScopeDecorator('transient')") &&
      fastPathScopeRegression.includes("executionPath: 'fast'") &&
      fastPathScopeRegression.includes('dependencyId: this.dependency.dependencyId') &&
      fastPathScopeRegression.includes('controllerId: 2, dependencyId: 2'),
    'HTTP fast-path regressions must prove transient controller and dependency identity across repeated dispatches.',
  );
  assert(
    dispatcherSource.includes(
      'const drain = await waitForManagedSseOperation(requestContext.request, stream, stream.waitForDrain());',
    ) &&
      dispatcherSource.includes("if (drain === 'aborted')") &&
      dispatcherSource.includes('iteratorCleanup ??= closeAsyncIterator(iterator);'),
    'Managed SSE backpressure waits must share request-abort and stream-close cancellation with iterator reads.',
  );
  assert(
    sseBackpressureRegression.includes('const blockedDrain') &&
      sseBackpressureRegression.includes('response.stream.emitClose()') &&
      sseBackpressureRegression.includes('expect(iteratorCleanupCalls).toBe(1)') &&
      sseBackpressureRegression.includes('expect(root.requestScopeDisposeCount).toBe(1)') &&
      sseBackpressureRegression.includes('writeFailure') &&
      sseBackpressureRegression.includes('drainFailure'),
    'Managed SSE regressions must cover blocked-drain cancellation, exactly-once iterator cleanup, request-scope disposal, and original stream errors.',
  );

  for (const documentationPath of [
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
    'docs/architecture/http-runtime.md',
    'docs/architecture/http-runtime.ko.md',
    'packages/http/README.md',
    'packages/http/README.ko.md',
  ]) {
    const documentation = read(documentationPath);
    assert(
      documentation.includes('Promise.prototype') && documentation.includes('isAborted()'),
      `${documentationPath} must document HTTP cancellation and request-context isolation together.`,
    );
  }

  for (const documentationPath of [
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
    'docs/architecture/http-runtime.md',
    'docs/architecture/http-runtime.ko.md',
    'packages/http/README.md',
    'packages/http/README.ko.md',
    'book/advanced/ch11-request-pipeline.md',
    'book/advanced/ch11-request-pipeline.ko.md',
  ]) {
    const documentation = read(documentationPath).toLowerCase();
    assert(
      documentation.includes('fast') &&
        documentation.includes('controller') &&
        documentation.includes('transient'),
      `${documentationPath} must document fast-path transient controller identity preservation.`,
    );
  }

  for (const documentationPath of [
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
    'docs/architecture/http-runtime.md',
    'docs/architecture/http-runtime.ko.md',
    'packages/http/README.md',
    'packages/http/README.ko.md',
    'book/advanced/ch11-request-pipeline.md',
    'book/advanced/ch11-request-pipeline.ko.md',
  ]) {
    const documentation = read(documentationPath).toLowerCase();
    assert(
      documentation.includes('waitfordrain()') &&
        documentation.includes('iterator') &&
        documentation.includes('scope'),
      `${documentationPath} must document managed SSE backpressure cancellation through iterator cleanup and request-scope disposal.`,
    );
  }
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

export function enforceHttpCustomMethodContract() {
  const expectedNodeListenerEngine = nodeListenerEngineRange;
  const nodeListenerManifestPaths = [
    'package.json',
    'packages/graphql/package.json',
    'packages/platform-express/package.json',
    'packages/platform-fastify/package.json',
    'packages/platform-nodejs/package.json',
    'packages/runtime/package.json',
    'packages/testing/package.json',
  ];
  const portableAdapterManifestPaths = [
    'packages/platform-bun/package.json',
    'packages/platform-cloudflare-workers/package.json',
    'packages/platform-deno/package.json',
  ];
  const documentationPaths = [
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
    'docs/architecture/http-runtime.md',
    'docs/architecture/http-runtime.ko.md',
    'packages/http/README.md',
    'packages/http/README.ko.md',
    'book/beginner/ch05-routing-controllers.md',
    'book/beginner/ch05-routing-controllers.ko.md',
  ];

  for (const documentationPath of documentationPaths) {
    const documentation = read(documentationPath);
    assert(
      documentation.includes('QUERY') &&
        documentation.includes('Route') &&
        documentation.includes('ALL') &&
        documentation.includes('CONNECT') &&
        documentation.includes('OpenAPI'),
      `${documentationPath} must keep custom HTTP method authoring, wildcard, CONNECT, and OpenAPI boundaries discoverable.`,
    );
  }

  for (const manifestPath of nodeListenerManifestPaths) {
    const manifest = JSON.parse(read(manifestPath));
    assert(
      manifest.engines?.node === expectedNodeListenerEngine,
      `${manifestPath} must declare Node.js ${expectedNodeListenerEngine} so listener-level QUERY requests reach fluo dispatch.`,
    );
  }

  for (const manifestPath of portableAdapterManifestPaths) {
    const manifest = JSON.parse(read(manifestPath));
    assert(
      manifest.engines?.node === undefined,
      `${manifestPath} must not acquire a Node.js engine floor for fetch-style custom-method dispatch.`,
    );
  }

  const decorators = read('packages/http/src/decorators.ts');
  const mappingRegression = read('packages/http/src/mapping.test.ts');
  const dispatcherRegression = read('packages/http/src/dispatch/custom-route-methods.test.ts');
  const networkHarness = read('packages/testing/src/portability/http-adapter-portability.ts');
  const webHarness = read('packages/testing/src/portability/web-runtime-adapter-portability.ts');
  const fastifyAdapter = read('packages/platform-fastify/src/adapter.ts');
  const bunAdapter = read('packages/platform-bun/src/adapter.ts');
  const scaffold = read('packages/cli/src/new/scaffold.ts');

  assert(
    decorators.includes('normalizeHttpRouteMethod') &&
      decorators.includes("normalized === 'ALL'") &&
      decorators.includes("Route('QUERY', path)"),
    'HTTP decorators must validate custom method tokens, reserve ALL, and build Query on Route.',
  );
  assert(
    mappingRegression.includes('preserves custom method version selection, exact precedence, and ALL fallback') &&
      dispatcherRegression.includes('default 200 semantics') &&
      dispatcherRegression.includes('canonical validation errors'),
    'HTTP regressions must cover custom-method precedence, versioning, DTO validation, and default status.',
  );
  assert(
    networkHarness.includes('assertSupportsCustomHttpRouteMethods') &&
      webHarness.includes('assertSupportsCustomHttpRouteMethods') &&
      networkHarness.includes("['QUERY', 'PURGE']") &&
      webHarness.includes("['QUERY', 'PURGE']"),
    'HTTP portability harnesses must execute QUERY and a representative extension method.',
  );
  assert(
    fastifyAdapter.includes("method === 'CONNECT'") &&
      fastifyAdapter.includes('this.app.addHttpMethod(method, { hasBody: true })') &&
      bunAdapter.includes("case 'HEAD':") &&
      bunAdapter.includes('return undefined;'),
    'Fastify and Bun adapters must preserve the documented custom-method fallback boundary.',
  );
  assert(
    scaffold.includes(`const NODE_HTTP_LISTENER_ENGINE = '${expectedNodeListenerEngine}';`) &&
      scaffold.includes("case 'application-node-fastify-http':") &&
      scaffold.includes("case 'application-node-fastify-react-vite-ssr':") &&
      scaffold.includes("case 'application-node-express-http':") &&
      scaffold.includes("case 'application-node-nodejs-http':") &&
      scaffold.includes("case 'mixed-node-fastify-tcp':"),
    `Generated Node HTTP listener projects must declare Node.js ${expectedNodeListenerEngine}.`,
  );
}

export function enforceHttpAdapterPortabilityDocumentationContract(readText = read) {
  const assertionOrder = [
    'assertSupportsCustomHttpRouteMethods()',
    'assertSupportsHttpErrorRepresentations()',
    'assertDoesNotCommitAbortedHttpErrorRepresentations()',
    'assertPreservesMalformedCookieValues()',
    'assertSupportsPortableResponseCookies()',
    'assertPreservesRawBodyForJsonAndText()',
    'assertPreservesExactRawBodyBytesForByteSensitivePayloads()',
    'assertExcludesRawBodyForMultipart()',
    'assertDefaultsMultipartTotalLimitToMaxBodySize()',
    'assertSupportsSseStreaming()',
    'assertSettlesStreamDrainWaitOnClose()',
    'assertReportsConfiguredHostInStartupLogs()',
    'assertReportsHttpsStartupUrl',
    'assertRemovesShutdownSignalListenersAfterClose()',
  ];
  const discoverabilityPaths = [
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
    'book/advanced/ch14-portability-testing.md',
    'book/advanced/ch14-portability-testing.ko.md',
  ];

  for (const documentationPath of discoverabilityPaths) {
    const documentation = readText(documentationPath);
    const suiteStartMarker = documentationPath.startsWith('docs/')
      ? '## HTTP Portability Harness Contract'
      : "describe('MyCustomAdapter Portability', () => {";
    const suiteStart = documentation.indexOf(suiteStartMarker);
    assert(
      suiteStart >= 0,
      `${documentationPath} must keep the complete HTTP portability suite section discoverable.`,
    );
    const suite = documentation.slice(suiteStart);
    let previousPosition = -1;

    for (const assertion of assertionOrder) {
      const position = suite.indexOf(assertion);
      assert(
        position >= 0,
        `${documentationPath} must keep ${assertion} discoverable.`,
      );
      assert(
        position > previousPosition,
        `${documentationPath} must keep the complete HTTP portability suite in canonical assertion order.`,
      );
      previousPosition = position;
    }

    for (const supportingIdentifier of [
      'createHttpAdapterPortabilityHarness',
      'createErrorRepresentationBootstrapOptions',
      'TEST_TLS_CERTIFICATE',
      'TEST_TLS_PRIVATE_KEY',
    ]) {
      assert(
        documentation.includes(supportingIdentifier),
        `${documentationPath} must keep ${supportingIdentifier} discoverable.`,
      );
    }
  }

  for (const contractPath of [
    'docs/contracts/platform-conformance-authoring-checklist.md',
    'docs/contracts/platform-conformance-authoring-checklist.ko.md',
  ]) {
    const contract = readText(contractPath);

    for (const marker of [
      '## Adapter Portability Requirements',
      'createHttpAdapterPortabilityHarness(...)',
      'assertSupportsPortableResponseCookies()',
      'assertSupportsCustomHttpRouteMethods()',
      'assertSupportsHttpErrorRepresentations()',
      'assertDoesNotCommitAbortedHttpErrorRepresentations()',
      'assertPreservesExactRawBodyBytesForByteSensitivePayloads()',
      'assertDefaultsMultipartTotalLimitToMaxBodySize()',
      'assertSettlesStreamDrainWaitOnClose()',
      'assertReportsConfiguredHostInStartupLogs()',
      'assertReportsHttpsStartupUrl(...)',
      'assertRemovesShutdownSignalListenersAfterClose()',
    ]) {
      assert(
        contract.includes(marker),
        `${contractPath} must keep the HTTP portability companion contract marker ${marker}.`,
      );
    }
  }

  const networkHarness = readText('packages/testing/src/portability/http-adapter-portability.ts');
  for (const assertion of assertionOrder) {
    const identifier = assertion.replace(/\([^)]*\)$/, '');
    assert(
      networkHarness.includes(identifier),
      `packages/testing/src/portability/http-adapter-portability.ts must retain ${identifier}.`,
    );
  }
}

export function enforceOpenApiNullableNormalizationContract() {
  const documentationPaths = [
    'apps/docs/content/docs/guides/http-api.mdx',
    'apps/docs/content/docs/guides/http-api.ko.mdx',
    'book/beginner/ch10-openapi.md',
    'book/beginner/ch10-openapi.ko.md',
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
    'docs/architecture/openapi.md',
    'docs/architecture/openapi.ko.md',
    'docs/reference/package-surface.md',
    'docs/reference/package-surface.ko.md',
    'packages/openapi/README.md',
    'packages/openapi/README.ko.md',
  ];

  for (const documentationPath of documentationPaths) {
    const documentation = read(documentationPath);
    assert(
      documentation.includes('OpenAPI 3.1') && documentation.includes('nullable'),
      `${documentationPath} must keep OpenAPI 3.1 nullable normalization discoverable.`,
    );
  }

  const schemaSurface = read('packages/openapi/src/schema-builder.ts');
  const normalization = read('packages/openapi/src/schema-bounds.ts');
  const regression = read('packages/openapi/src/schema-nullable.test.ts');

  assert(schemaSurface.includes('nullable?: boolean;'), 'OpenApiSchemaObject must continue accepting legacy nullable input.');
  assert(
    normalization.includes('schema.nullable === true') && normalization.includes("{ type: 'null' }"),
    'OpenAPI schema normalization must keep emitting OpenAPI 3.1 null unions.',
  );
  assert(
    ['nullable: true', 'nullable: false', "type: 'array'", '$ref:'].every((marker) => regression.includes(marker)),
    'OpenAPI nullable regression coverage must include true, false, array, and $ref inputs.',
  );
}

const openApiMigrationDocumentRequirements = [
  {
    heading: '## OpenAPI Contract Differences',
    markers: ["defaultErrorResponsesPolicy: 'omit'", 'operationId', 'documentTransform', 'documentPath', 'uiPath', 'useFactory(...)'],
    path: 'docs/getting-started/migrate-from-nestjs.md',
  },
  {
    heading: '## OpenAPI 계약 차이',
    markers: ["defaultErrorResponsesPolicy: 'omit'", 'operationId', 'documentTransform', 'documentPath', 'uiPath', 'useFactory(...)'],
    path: 'docs/getting-started/migrate-from-nestjs.ko.md',
  },
  {
    heading: '### Default Error Contract',
    markers: [],
    path: 'book/beginner/ch10-openapi.md',
  },
  {
    heading: '### 기본 오류 계약',
    markers: [],
    path: 'book/beginner/ch10-openapi.ko.md',
  },
];

export function enforceOpenApiMigrationDocumentStructure(readText = read) {
  for (const { heading, markers, path } of openApiMigrationDocumentRequirements) {
    const documentation = readText(path);
    const headingCount = documentation.split('\n').filter((line) => line.trim() === heading).length;
    const missingMarkers = markers.filter((marker) => !documentation.includes(marker));

    assert(
      headingCount === 1,
      `${path} must contain exactly one ${heading.slice('#'.repeat(heading.match(/^#+/)?.[0].length ?? 0).length + 1)} heading; found ${headingCount}.`,
    );
    assert(
      missingMarkers.length === 0,
      `${path} must retain migration marker(s): ${missingMarkers.join(', ')}.`,
    );
  }
}

export function enforceGraphqlRuntimeBoundaryDiscoverability() {
  const expectedNodeEngine = nodeListenerEngineRange;
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
    configPackageJson.engines?.node === '>=20.16.0',
    'packages/config/package.json must keep its direct process.getBuiltinModule Node.js >=20.16.0 floor documented independently.',
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

const queueWorkerOwnershipContractPaths = [
  'packages/queue/README.md',
  'packages/queue/README.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'docs/reference/package-surface.md',
  'docs/reference/package-surface.ko.md',
  'book/intermediate/ch11-queue.md',
  'book/intermediate/ch11-queue.ko.md',
];
const queueWorkerOwnershipSourcePaths = [
  ...queueWorkerOwnershipContractPaths,
  'packages/queue/src/worker-ownership.ts',
  'packages/queue/src/module.ts',
  'packages/queue/src/worker-ownership.test.ts',
];

export function enforceQueueWorkerOwnershipContractFromSources(sources) {
  const readSource = (path) => {
    const source = sources[path];
    assert(typeof source === 'string', `Queue ownership contract source "${path}" must be provided.`);
    return source;
  };

  for (const contractPath of queueWorkerOwnershipContractPaths) {
    const contract = readSource(contractPath);
    assert(
      contract.includes('scope') && contract.includes('Redis') && contract.includes('jobName'),
      `${contractPath} must keep cross-scope Redis and jobName ownership discoverable.`,
    );
  }

  const queuePackageSurfaceBulletRequirements = [
    [
      'docs/reference/package-surface.md',
      [
        'application-supplied `ownershipNamespace` identities independent of DI `clientName`',
        'pre-resource `(ownershipNamespace, jobName)` collision validation',
        '2.x compatibility diagnostics by default',
        "opt-in `ownershipEnforcement: 'reject'` bootstrap rejection",
      ],
    ],
    [
      'docs/reference/package-surface.ko.md',
      [
        'DI `clientName`과 독립적인 application-supplied `ownershipNamespace` identity',
        'resource 생성 전 `(ownershipNamespace, jobName)` collision validation',
        '기본 2.x compatibility diagnostic',
        "opt-in `ownershipEnforcement: 'reject'` bootstrap rejection",
      ],
    ],
  ];

  for (const [contractPath, requirements] of queuePackageSurfaceBulletRequirements) {
    const contract = readSource(contractPath);
    const queueBulletAnchor = '- **`@fluojs/queue`**:';
    const queueBullets = contract.split('\n').filter((line) => line.startsWith(queueBulletAnchor));

    assert(
      queueBullets.length === 1,
      `${contractPath} Queue package-surface bullet anchor must occur exactly once; observed ${queueBullets.length}.`,
    );

    const [queueBullet] = queueBullets;

    assert(
      requirements.every((requirement) => queueBullet.includes(requirement)),
      `${contractPath} Queue package-surface bullet must document application ownershipNamespace identity independent of DI clientName, pre-resource collision validation, default 2.x diagnostics, and opt-in reject failure.`,
    );
  }

  const ownershipSource = readSource('packages/queue/src/worker-ownership.ts');
  const moduleSource = readSource('packages/queue/src/module.ts');
  const regressionSource = readSource('packages/queue/src/worker-ownership.test.ts');
  const unconfiguredNamespaceDiagnostic =
    'Queue ownership namespace is unconfigured for scope "${moduleContext.scope}". Set QueueModule.forRoot({ ownershipNamespace }) to a stable identity shared only by registrations that use the same BullMQ backend.';
  const unconfiguredNamespaceWarning = [
    'logger.warn(',
    `        \`${unconfiguredNamespaceDiagnostic}\`,`,
    "        'QueueLifecycleService',",
    '      );',
  ].join('\n');
  const descriptorIteration = 'const descriptors = discoverQueueWorkerDescriptors(';
  const rejectPreferredOwnerSelection = [
    'const existingOwner =',
    "        compatibleOwners.find((owner) => owner.ownershipEnforcement === 'reject') ??",
    '        compatibleOwners[0];',
  ].join('\n');

  assert(
    ownershipSource.includes('const ownershipNamespace = moduleContext.options.ownershipNamespace;') &&
      !ownershipSource.includes('moduleContext.options.clientName') &&
      ownershipSource.includes('function canShareBackend(') &&
      ownershipSource.includes('ownershipNamespace === undefined ||') &&
      ownershipSource.includes('existingOwner.ownershipNamespace === undefined ||') &&
      ownershipSource.includes('ownershipNamespace === existingOwner.ownershipNamespace'),
    'Queue ownership identity must use application-supplied ownershipNamespace, treating an absent namespace as compatible and only explicitly different namespaces as isolated.',
  );
  assert(
    ownershipSource.includes(unconfiguredNamespaceDiagnostic) &&
      (ownershipSource.match(/Queue ownership namespace is unconfigured for scope/g) ?? []).length === 1 &&
      ownershipSource.includes(unconfiguredNamespaceWarning) &&
      ownershipSource.indexOf(unconfiguredNamespaceWarning) < ownershipSource.indexOf(descriptorIteration),
    'Queue ownership validation must emit exactly one actionable unconfigured-namespace diagnostic through logger.warn before worker descriptor iteration.',
  );
  assert(
    ownershipSource.includes(
      'const compatibleOwners = owners.filter((owner) => canShareBackend(ownershipNamespace, owner));',
    ) &&
      ownershipSource.includes(rejectPreferredOwnerSelection) &&
      ownershipSource.includes(
        "existingOwner.ownershipEnforcement === 'reject' ||\n          moduleContext.options.ownershipEnforcement === 'reject'",
      ) &&
      ownershipSource.includes('Cross-scope @fluojs/queue worker ownership collision') &&
      ownershipSource.includes('createQueueDiscoveryModuleFilter(compiledModules, moduleContext)'),
    'Queue ownership validation must prefer a compatible owner that enforces rejection before falling back to the first compatible owner.',
  );
  assert(
    moduleSource.includes(
      'assertUniqueQueueWorkerOwnership(typedDeps[3], typedDeps[4], typedDeps[6].moduleType)',
    ) &&
      moduleSource.indexOf(
        'assertUniqueQueueWorkerOwnership(typedDeps[3], typedDeps[4], typedDeps[6].moduleType)',
      ) <
        moduleSource.indexOf('new QueueLifecycleService(...typedDeps)'),
    'Queue lifecycle provider creation must reject ownership collisions before BullMQ bootstrap creates worker resources.',
  );
  assert(
    regressionSource.includes(
      'warns about an unconfigured ownership namespace collision without creating resources first',
    ) &&
      regressionSource.includes('warns about a mixed configured and unconfigured ownership namespace collision') &&
      regressionSource.includes(
        'rejects a mixed configured and unconfigured ownership namespace collision before creating resources',
      ) &&
      regressionSource.includes(
        'rejects when an unconfigured registration collides with a later reject owner',
      ) &&
      regressionSource.includes('warns once for a lone unconfigured ownership namespace') &&
      regressionSource.includes(
        'rejects the same jobName for different Redis clients with one ownership namespace',
      ) &&
      regressionSource.includes('allows the same jobName across explicitly distinct ownership namespaces'),
    'Queue ownership regressions must cover unconfigured diagnostics, mixed namespace compatibility, rejection before resource creation, later-owner rejection, DI-independent ownership, and explicitly distinct namespace allowance.',
  );

  for (const regressionTitle of [
    'rejects a mixed configured and unconfigured ownership namespace collision before creating resources',
    'rejects when an unconfigured registration collides with a later reject owner',
    'rejects the same jobName for different Redis clients with one ownership namespace',
  ]) {
    const testDeclaration = `  it('${regressionTitle}',`;
    const matchingDeclarations = regressionSource
      .split('\n')
      .filter((line) => line.startsWith(testDeclaration));

    assert(
      matchingDeclarations.length === 1,
      `Queue ownership regression "${regressionTitle}" test declaration must occur exactly once; observed ${matchingDeclarations.length}.`,
    );

    const testStart = regressionSource.indexOf(testDeclaration);
    const nextTestStart = regressionSource.indexOf("\n  it('", testStart + 1);
    const testSource = regressionSource.slice(testStart, nextTestStart === -1 ? undefined : nextTestStart);

    assert(
      testSource.includes('expect(bullmqState.queueNames).toEqual([])'),
      `Queue ownership regression "${regressionTitle}" must assert no BullMQ queues are created before rejection.`,
    );
  }
}

export function enforceQueueWorkerOwnershipContract() {
  return enforceQueueWorkerOwnershipContractFromSources(
    Object.fromEntries(
      queueWorkerOwnershipSourcePaths.map((path) => [
        path,
        read(path),
      ]),
    ),
  );
}

export function enforceFastifyNativeConfigurationDocsSync() {
  const adapterSource = read('packages/platform-fastify/src/adapter.ts');
  const regressionSource = read('packages/platform-fastify/src/adapter.test.ts');

  assert(
    adapterSource.includes('configureFastify?:') &&
      adapterSource.includes('await this.configureFastifyInstance()'),
    'Fastify adapter configuration must remain an awaited typed construction-time seam.',
  );
  assert(
    regressionSource.includes('configures every created Fastify instance once before internal registration') &&
      regressionSource.includes('propagates configuration failures and retries only after closing the failed instance'),
    'Fastify configuration must retain ordering and failure/relisten regression coverage.',
  );

  for (const documentationPath of [
    'packages/platform-fastify/README.md',
    'packages/platform-fastify/README.ko.md',
    'docs/getting-started/migrate-from-nestjs.md',
    'docs/getting-started/migrate-from-nestjs.ko.md',
  ]) {
    const documentation = read(documentationPath);
    assert(
      documentation.includes('configureFastify') && documentation.includes('middleware'),
      `${documentationPath} must document the Fastify native configuration seam and portable middleware boundary.`,
    );
  }
}

export async function main() {
  const changedFiles = changedFilesFromGit();

  enforceSsotMirrorStructure();
  enforcePackageDirectoriesHaveManifests();
  enforceReleaseGovernancePublishSurfaceSync();
  enforceCanonicalPackageSurfaceSync();
  enforceSocketIoNodeEngineAlignment();
  enforcePlatformFastifyEngineDocumentation();
  enforceDocsHubOfficialTransportLinks();
  enforceDenoHostOwnedLifecycleContract();
  enforceDenoPermissionGuidance();
  enforceEmailLifecycleDocsContract();
  enforceSerializerResponseOwnershipDocsSync();
  enforceCloudflareWorkersLifecycleDocsSync();
  enforcePlatformShellLifecycleContract();
  enforceConfigNestjsMigrationDocs();
  enforceCliMigrationTransformDocs();
  enforceJwtAsyncRegistrationContract();
  await enforceJwtLearningPathModuleWiring();
  enforceRuntimeLifecycleNestjsMigrationDocs();
  enforcePassportJsBridgeNestjsMigration();
  enforceExpressApplicationOwnershipDocs();
  enforceExpressRuntimeMigrationDocsSync();
  enforceFastifyNativeConfigurationDocsSync();
  enforceCanonicalRuntimeMatrixReferences();
  enforceHttpBookRequestContracts();
  enforceRemovedRuntimeFactoryNamesNotUsedInDocs();
  enforceNoDirectProcessEnvInOrdinaryPackageSource();
  enforceNoNodeGlobalBufferInDenoAndCloudflareWorkerServices();
  enforceViteToolingDiscoverability();
  enforceReactPageCatalogContract();
  enforceReactPageMetadataIdentityContract();
  enforceReactClientSubpathContract();
  enforceReactRscGraduationGovernance(changedFiles);
  enforceReactServerFunctionContract();
  enforceHttpRuntimeCancellationAndContextIsolation();
  enforceHttpCustomMethodContract();
  enforceHttpAdapterPortabilityDocumentationContract();
  enforceHttpCatchAllRouteGrammarDecision();
  enforceOpenApiNullableNormalizationContract();
  enforceOpenApiMigrationDocumentStructure();
  enforceGraphqlRuntimeBoundaryDiscoverability();
  enforceRequestPipelineImportBoundary();
  enforcePersistenceTransactionInterceptorCompatibility();
  enforceQueueWorkerOwnershipContract();
  enforceMicroservicesSafetyGuidanceParity();
  enforceMicroservicesSafetyRuntimeEvidence();
  enforcePlatformNodejsEngineDocumentation();
  enforceAdvancedBookCoreBoundaryCompanions(changedFiles);
  enforceContractCompanionUpdates(changedFiles);
  enforceAlignmentClaimsBackedByHarness(changedFiles);

  console.log('Platform consistency governance checks passed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
