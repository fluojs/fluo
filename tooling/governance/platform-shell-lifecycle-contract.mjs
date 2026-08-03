import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const lifecycleContractRequirements = [
  ['packages/runtime/README.md', ['PlatformLifecycleConflictError', 'PLATFORM_LIFECYCLE_CONFLICT', 'strictly exclusive']],
  ['packages/runtime/README.ko.md', ['PlatformLifecycleConflictError', 'PLATFORM_LIFECYCLE_CONFLICT', '엄격한 exclusive']],
  ['docs/architecture/platform-consistency-design.md', ['PlatformLifecycleConflictError', 'MUST NOT queue']],
  ['docs/architecture/platform-consistency-design.ko.md', ['PlatformLifecycleConflictError', 'queue하면 안 된다']],
  ['docs/contracts/third-party-extension-contract.md', ['PlatformLifecycleConflictError', 'MUST NOT queue']],
  ['docs/contracts/third-party-extension-contract.ko.md', ['PlatformLifecycleConflictError', 'queue하면 안 됩니다']],
  ['docs/contracts/platform-conformance-authoring-checklist.md', ['PlatformLifecycleConflictError', 'all four `start()` / `stop()` overlap pairs']],
  ['docs/contracts/platform-conformance-authoring-checklist.ko.md', ['PlatformLifecycleConflictError', '네 가지 `start()` / `stop()` overlap pair']],
  ['docs/CONTEXT.md', ['PlatformShell lifecycle exclusivity', 'PlatformLifecycleConflictError']],
  ['docs/CONTEXT.ko.md', ['PlatformShell lifecycle exclusivity', 'PlatformLifecycleConflictError']],
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Platform shell lifecycle contract check failed: ${message}`);
  }
}

export function enforcePlatformShellLifecycleContract(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of lifecycleContractRequirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));
    assert(
      missingMarkers.length === 0,
      `${relativePath} must keep strict PlatformShell lifecycle exclusivity synchronized; missing: ${missingMarkers.join(', ')}.`,
    );
  }
}
