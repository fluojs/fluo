import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enforceTerminusRuntimeSourceContract } from './terminus-runtime-health-source-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const contractSentinel =
  'fluo-terminus-contract: registration=application-owned-TerminusModule.forRoot;health=aggregated-diagnostics;ready-admission=binary;ready-body=ready|starting|unavailable;default-liveness=absent;unhealthy-status=503;route-protection=path-scoped-external-boundary;indicator-readiness=opt-out;readiness-checks=additive';
const contractDocuments = [
  'packages/terminus/README.md',
  'packages/terminus/README.ko.md',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
  'book/beginner/ch18-health.md',
  'book/beginner/ch18-health.ko.md',
];
const contractCompanions = [
  ...contractDocuments,
  'tooling/governance/terminus-runtime-health-contract.mjs',
  'tooling/governance/terminus-runtime-health-source-contract.mjs',
  'tooling/governance/terminus-runtime-health-contract.test.ts',
];
const authoritativePaths = new Set([
  'packages/terminus/src/module.ts',
  'packages/terminus/README.md',
  'packages/terminus/README.ko.md',
  'book/beginner/ch18-health.md',
  'book/beginner/ch18-health.ko.md',
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
  enforceTerminusRuntimeSourceContract(runtimeSource, assertContract);

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

  const missingCompanions = contractCompanions.filter((path) => !changedFiles.includes(path));
  assertContract(
    missingCompanions.length === 0,
    `Terminus runtime health contract updates must include ${missingCompanions.join(', ')}.`,
  );
}
