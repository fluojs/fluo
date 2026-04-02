import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '..', '..');

const ssotPairs = [
  ['docs/concepts/platform-consistency-design.md', 'docs/concepts/platform-consistency-design.ko.md'],
  ['docs/operations/release-governance.md', 'docs/operations/release-governance.ko.md'],
  ['docs/operations/platform-conformance-authoring-checklist.md', 'docs/operations/platform-conformance-authoring-checklist.ko.md'],
];

const contractGateTriggers = new Set([
  'docs/concepts/platform-consistency-design.md',
  'docs/concepts/platform-consistency-design.ko.md',
  'docs/operations/behavioral-contract-policy.md',
  'docs/operations/release-governance.md',
  'docs/operations/release-governance.ko.md',
  'docs/operations/platform-conformance-authoring-checklist.md',
  'docs/operations/platform-conformance-authoring-checklist.ko.md',
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Platform consistency governance check failed: ${message}`);
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

const changedFiles = changedFilesFromGit();

enforceSsotMirrorStructure();
enforceContractCompanionUpdates(changedFiles);
enforceAlignmentClaimsBackedByHarness(changedFiles);

console.log('Platform consistency governance checks passed.');
