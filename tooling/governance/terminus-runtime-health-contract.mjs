import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSourceFile,
  isExportDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isNamedExports,
  isStringLiteral,
  isVariableStatement,
  ScriptKind,
  ScriptTarget,
  SyntaxKind,
} from 'typescript';

import { enforceTerminusRuntimeSourceContract } from './terminus-runtime-health-source-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const contractSentinel =
  'fluo-terminus-contract: registration=application-owned-TerminusModule.forRoot;health=aggregated-diagnostics;ready-admission=binary;ready-body=ready|starting|unavailable;default-liveness=absent;unhealthy-status=503;route-protection=path-scoped-external-boundary;indicator-readiness=opt-out;readiness-checks=additive';
const contractOwners = [
  'docs/contracts/health-and-readiness.md',
  'docs/contracts/health-and-readiness.ko.md',
];
const contractDocuments = [
  ...contractOwners,
  'packages/terminus/README.md',
  'packages/terminus/README.ko.md',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
  'book/beginner/ch18-health.md',
  'book/beginner/ch18-health.ko.md',
];
const authoritativePaths = new Set([
  ...contractOwners,
  'packages/terminus/src/module.ts',
  'packages/terminus/README.md',
  'packages/terminus/README.ko.md',
]);
const sharedPaths = new Set([
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
]);
const sharedContractMarkerPattern =
  /(?:fluo-terminus-contract:|@fluojs\/terminus|NestJS Terminus|TerminusModule|`?\/health`?|`?\/ready`?)/u;

function sharedTerminusContractFragments(patch, prefix) {
  return patch.split('\n').flatMap((line) => {
    if (!line.startsWith(prefix) || line.startsWith(`${prefix}${prefix}${prefix}`)) {
      return [];
    }

    // Node support policy is checked by manifest/release gates, not health semantics.
    const content = line.slice(1).replace(
      /\bNode\.js (?:\d+\+|`>=\d+\.\d+\.\d+ <\d+`)/gu,
      'Node.js <engine-policy>',
    ).replace(
      /\bengines\.node >=\d+\.\d+\.\d+(?: <\d+)?/gu,
      'engines.node <engine-policy>',
    );
    // Prose has no safe distance cutoff: govern the complete marked line.
    return sharedContractMarkerPattern.test(content) ? [content] : [];
  });
}

function sharedTerminusContractChanged(patch) {
  return JSON.stringify(sharedTerminusContractFragments(patch, '-')) !==
    JSON.stringify(sharedTerminusContractFragments(patch, '+'));
}

function assertContract(condition, message) {
  if (!condition) {
    throw new Error(`Platform consistency governance check failed: ${message}`);
  }
}

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function sourceFile(relativePath, source) {
  return createSourceFile(relativePath, source, ScriptTarget.Latest, true, ScriptKind.TS);
}

function isReexportFrom(source, moduleSpecifier, symbol) {
  return source.statements.some((statement) => {
    if (!isExportDeclaration(statement)
      || !isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== moduleSpecifier) {
      return false;
    }

    if (symbol === undefined || statement.exportClause === undefined) {
      return true;
    }

    return isNamedExports(statement.exportClause)
      && statement.exportClause.elements.some((element) => element.name.text === symbol);
  });
}

function hasExportModifier(statement) {
  return statement.modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword) ?? false;
}

function exportsNamedDeclaration(source, symbol) {
  return source.statements.some((statement) => {
    if (isExportDeclaration(statement)) {
      return isNamedExports(statement.exportClause)
        && statement.exportClause.elements.some((element) => element.name.text === symbol);
    }

    if (!hasExportModifier(statement)) {
      return false;
    }

    if (isFunctionDeclaration(statement) && isIdentifier(statement.name)) {
      return statement.name.text === symbol;
    }

    return isVariableStatement(statement)
      && statement.declarationList.declarations.some(
        (declaration) => isIdentifier(declaration.name) && declaration.name.text === symbol,
      );
  });
}

function runGit(args) {
  return spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function changedFilePatchFromGit(relativePath) {
  const preferredBase = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
  const mergeBaseResult = runGit(['merge-base', 'HEAD', preferredBase]);
  assertContract(
    mergeBaseResult.status === 0 && mergeBaseResult.stdout.trim().length > 0,
    `unable to compute merge-base with ${preferredBase} for Terminus companion enforcement.`,
  );

  const mergeBase = mergeBaseResult.stdout.trim();
  const patches = [];
  for (const args of [
    ['diff', '--unified=0', `${mergeBase}...HEAD`, '--', relativePath],
    ['diff', '--unified=0', '--', relativePath],
    ['diff', '--cached', '--unified=0', '--', relativePath],
  ]) {
    const result = runGit(args);
    assertContract(result.status === 0, `unable to inspect ${relativePath} for Terminus contract changes.`);
    patches.push(result.stdout);
  }

  return patches.join('\n');
}

export function enforceTerminusRuntimeHealthContract(readText = read) {
  const runtimeSource = readText('packages/terminus/src/module.ts');
  const runtimeHealthSource = readText('packages/runtime/src/health/health.ts');
  const rootEntrySource = readText('packages/terminus/src/index.ts');
  const rootIndicatorsSource = readText('packages/terminus/src/indicators/index.ts');
  const nodeIndicatorsSource = readText('packages/terminus/src/node.ts');
  enforceTerminusRuntimeSourceContract(runtimeSource, assertContract);
  assertContract(
    !exportsNamedDeclaration(
      sourceFile('packages/runtime/src/health/health.ts', runtimeHealthSource),
      'createHealthModule',
    ),
    'runtime health registration must remain owned by HealthModule.forRoot without a createHealthModule compatibility export.',
  );
  assertContract(
    !isReexportFrom(sourceFile('packages/terminus/src/index.ts', rootEntrySource), './node.js')
      && !isReexportFrom(sourceFile('packages/terminus/src/index.ts', rootEntrySource), './indicators/memory.js')
      && !isReexportFrom(sourceFile('packages/terminus/src/index.ts', rootEntrySource), './indicators/disk.js')
      && !isReexportFrom(sourceFile('packages/terminus/src/indicators/index.ts', rootIndicatorsSource), './memory.js')
      && !isReexportFrom(sourceFile('packages/terminus/src/indicators/index.ts', rootIndicatorsSource), './disk.js'),
    'memory and disk indicators must remain outside the Terminus root export boundary.',
  );
  assertContract(
    isReexportFrom(
      sourceFile('packages/terminus/src/node.ts', nodeIndicatorsSource),
      './indicators/memory.js',
      'MemoryHealthIndicator',
    ),
    'MemoryHealthIndicator must remain available from the Terminus node subpath.',
  );
  assertContract(
    isReexportFrom(
      sourceFile('packages/terminus/src/node.ts', nodeIndicatorsSource),
      './indicators/disk.js',
      'DiskHealthIndicator',
    ),
    'DiskHealthIndicator must remain available from the Terminus node subpath.',
  );

  for (const path of contractDocuments) {
    assertContract(
      readText(path).includes(contractSentinel),
      `${path} must preserve the Terminus runtime health contract sentinel.`,
    );
  }
}

export function enforceTerminusRuntimeHealthContractCompanions(
  changedFiles,
  readChangedPatch = changedFilePatchFromGit,
) {
  const touchedAuthoritativePath = changedFiles.some((path) => authoritativePaths.has(path));
  const touchedSharedContractSection = !touchedAuthoritativePath && changedFiles.some((path) =>
    sharedPaths.has(path) && sharedTerminusContractChanged(readChangedPatch(path)));

  if (!touchedAuthoritativePath && !touchedSharedContractSection) {
    return;
  }

  // Docs owns the contract; summaries and unchanged source guards remain checked
  // without requiring file churn. Source changes still need runtime regression evidence.
  const companions = changedFiles.includes('packages/terminus/src/module.ts')
    ? [...contractOwners, 'packages/terminus/src/module.test.ts']
    : contractOwners;
  const missingCompanions = companions.filter((path) => !changedFiles.includes(path));
  assertContract(
    missingCompanions.length === 0,
    `Terminus runtime health contract updates must include ${missingCompanions.join(', ')}.`,
  );
}
