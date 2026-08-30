import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const docs = [
  {
    path: 'packages/platform-bun/README.md',
    language: 'English',
    retainedState: 'accepted work and adapter state remain retained until the underlying drain settles',
    timeout: 'bounded timeout only rejects the caller-facing `close()` promise',
    forcedTeardown: 'Bun forcefully tears the server down',
  },
  {
    path: 'packages/platform-bun/README.ko.md',
    language: 'Korean',
    retainedState: '수락된 작업과 adapter state는 underlying drain이 끝날 때까지 유지됩니다',
    timeout: 'bounded timeout은 caller-facing `close()` promise만 reject합니다',
    forcedTeardown: 'Bun이 서버를 강제로 내리기 전에',
  },
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function enforceBoundedDrainDocumentation(readText = read): void {
  for (const document of docs) {
    const content = readText(document.path);

    if (!content.includes(document.timeout)) {
      throw new Error(
        `${document.language} Bun README must state that the bounded shutdown timeout only rejects the caller-facing close() promise.`,
      );
    }

    if (!content.includes(document.retainedState)) {
      throw new Error(
        `${document.language} Bun README must state that accepted work and adapter state remain retained until the underlying drain settles.`,
      );
    }

    if (content.includes(document.forcedTeardown)) {
      throw new Error(
        `${document.language} Bun README must not promise forced server teardown after the bounded shutdown timeout.`,
      );
    }
  }
}

function overrideFile(
  relativePath: string,
  transform: (content: string) => string,
): (requestedPath: string) => string {
  return (requestedPath) => {
    const original = read(requestedPath);

    if (requestedPath !== relativePath) {
      return original;
    }

    const mutated = transform(original);

    if (mutated === original) {
      throw new Error(
        `Governance fixture for ${relativePath} left the source unchanged: update its anchor so this test continues to prove the guard detects documentation drift.`,
      );
    }

    return mutated;
  };
}

describe('Bun bounded-drain documentation contract', () => {
  it('documents caller-facing timeout without promising forced teardown', () => {
    expect(() => enforceBoundedDrainDocumentation()).not.toThrow();
  });

  it.each(docs)('rejects missing retained-state documentation in $language README', (document) => {
    const readWithoutRetainedState = overrideFile(
      document.path,
      (content) => content.replaceAll(document.retainedState, ''),
    );

    expect(() => enforceBoundedDrainDocumentation(readWithoutRetainedState)).toThrow(
      /accepted work and adapter state remain retained/i,
    );
  });

  it.each(docs)('rejects forced-teardown documentation in $language README', (document) => {
    const readWithForcedTeardown = overrideFile(
      document.path,
      (content) => content.replace(document.timeout, `${document.timeout} ${document.forcedTeardown}`),
    );

    expect(() => enforceBoundedDrainDocumentation(readWithForcedTeardown)).toThrow(
      /must not promise forced server teardown/i,
    );
  });
});
