import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const adapterPath = 'packages/platform-fastify/src/adapter.ts';

const documents = [
  {
    boundedWait: /\bFastify\b.*\bwaits?\b.*\b(?:up to|within)\b.*`shutdownTimeoutMs`/iu,
    callerTimeout: /\b(?:timeout|times out|deadline)\b.*\brejects?\b.*\bcaller-facing\b.*`close\(\)`/iu,
    language: 'English',
    path: 'docs/getting-started/bootstrap-paths.md',
    retainedClose: /\b(?:underlying|in-flight)\b.*\bFastify\b.*\bclose\b.*\bcleanup\b.*\bcontinues?\b.*\b(?:settle|settlement)\b/iu,
    withoutRetainedClose: '5. Fastify waits up to `shutdownTimeoutMs`; timeout rejects the caller-facing `close()` promise.',
  },
  {
    boundedWait: /Fastify.*`shutdownTimeoutMs`.*(?:최대|까지).*?(?:대기|기다)/u,
    callerTimeout: /(?:timeout|시간 제한).*?(?:caller-facing|호출자).*?`close\(\)`.*?(?:reject|거부)/u,
    language: 'Korean',
    path: 'docs/getting-started/bootstrap-paths.ko.md',
    retainedClose: /(?:기반|underlying).*?Fastify.*?close.*?cleanup.*?(?:(?:계속|유지).*?(?:settle|완료)|(?:settle|완료).*?(?:계속|유지))/u,
    withoutRetainedClose: '5. Fastify는 서버 close 완료를 `shutdownTimeoutMs`까지 대기하며, timeout되면 caller-facing `close()` promise를 reject합니다.',
  },
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Fastify bounded-close bootstrap documentation check failed: ${message}`);
  }
}

function shutdownStep(content: string, relativePath: string): string {
  const shutdownHeading = content.indexOf('## Shutdown Sequence');
  const nextHeading = content.indexOf('\n## ', shutdownHeading + 1);
  const shutdownSection = content.slice(shutdownHeading, nextHeading === -1 ? undefined : nextHeading);
  const step = shutdownSection.match(/^5\.\s+(.+)$/mu);

  assert(shutdownHeading >= 0, `${relativePath} must contain a Shutdown Sequence section.`);
  assert(step !== null, `${relativePath} must contain the Fastify shutdown step.`);

  return step[1];
}

function enforceBoundedCloseExecution(adapterSource: string): void {
  assert(
    /return waitForCloseWithTimeout\(this\.closeInFlight,\s*this\.shutdownTimeoutMs\);/u.test(adapterSource),
    `${adapterPath} must expose close() through the shutdownTimeoutMs-bounded wait.`,
  );
  assert(
    /function waitForCloseWithTimeout\([\s\S]*?setTimeout\(\(\) => \{\s*reject\([\s\S]*?shutdown timeout exceeded[\s\S]*?void closePromise\.then\(/u.test(adapterSource),
    `${adapterPath} must reject the caller-facing wait on timeout while retaining the close promise.`,
  );
}

function enforceBoundedCloseBootstrapDocumentation(readText = read): void {
  enforceBoundedCloseExecution(readText(adapterPath));

  for (const document of documents) {
    const step = shutdownStep(readText(document.path), document.path);

    assert(
      document.boundedWait.test(step),
      `${document.language} bootstrap protocol must state that Fastify close waits only up to shutdownTimeoutMs.`,
    );
    assert(
      document.callerTimeout.test(step),
      `${document.language} bootstrap protocol must state that timeout rejects the caller-facing close() promise.`,
    );
    assert(
      document.retainedClose.test(step),
      `${document.language} bootstrap protocol must state that underlying Fastify close and cleanup continue until settlement.`,
    );
  }
}

function replaceShutdownStep(content: string, replacement: string): string {
  const shutdownHeading = content.indexOf('## Shutdown Sequence');
  const nextHeading = content.indexOf('\n## ', shutdownHeading + 1);
  const shutdownSection = content.slice(shutdownHeading, nextHeading === -1 ? undefined : nextHeading);
  const mutatedSection = shutdownSection.replace(/^5\.\s+.+$/mu, replacement);

  assert(mutatedSection !== shutdownSection, 'Mutation fixture must replace the Fastify shutdown step.');

  return content.slice(0, shutdownHeading) + mutatedSection + content.slice(nextHeading === -1 ? content.length : nextHeading);
}

function overrideDocument(
  relativePath: string,
  transform: (content: string) => string,
): (requestedPath: string) => string {
  return (requestedPath) => {
    const original = read(requestedPath);

    if (requestedPath !== relativePath) {
      return original;
    }

    const mutated = transform(original);

    assert(
      mutated !== original,
      `Governance fixture for ${relativePath} left the source unchanged: update its anchor so this test continues to prove documentation drift.`,
    );

    return mutated;
  };
}

describe('Fastify bounded-close bootstrap documentation', () => {
  it('keeps the bootstrap protocol aligned with the bounded Fastify close execution seam', () => {
    expect(() => enforceBoundedCloseBootstrapDocumentation()).not.toThrow();
  });

  it.each(documents)('rejects an unbounded completion guarantee in the $language bootstrap protocol', (document) => {
    const readWithUnboundedClose = overrideDocument(
      document.path,
      (content) => replaceShutdownStep(content, '5. Fastify waits for server close completion.'),
    );

    expect(() => enforceBoundedCloseBootstrapDocumentation(readWithUnboundedClose)).toThrow(
      /waits only up to shutdownTimeoutMs/i,
    );
  });

  it.each(documents)('rejects timeout documentation that drops retained close cleanup in $language', (document) => {
    const readWithoutRetainedClose = overrideDocument(
      document.path,
      (content) => replaceShutdownStep(content, document.withoutRetainedClose),
    );

    expect(() => enforceBoundedCloseBootstrapDocumentation(readWithoutRetainedClose)).toThrow(
      /continue until settlement/i,
    );
  });
});
