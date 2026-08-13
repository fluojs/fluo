import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceDenoHostOwnedLifecycleContract } from './deno-host-owned-lifecycle-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function overrideFile(
  relativePath: string,
  transform: (content: string) => string,
): (requestedPath: string) => string {
  return (requestedPath) => requestedPath === relativePath ? transform(read(requestedPath)) : read(requestedPath);
}

describe('Deno host-owned fetch handler discoverability', () => {
  it('keeps source-backed lifecycle ownership aligned across governed English and Korean docs', () => {
    // Given / When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleContract();

    // Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it.each([
    ['docs/getting-started/migrate-from-nestjs.md', '`createDenoFetchHandler(...)` starts a Deno server.'],
    ['docs/getting-started/migrate-from-nestjs.md', '`createDenoFetchHandler(...)` installs signal handlers.'],
    ['docs/getting-started/migrate-from-nestjs.md', '`createDenoFetchHandler(...)` owns shutdown.'],
    ['docs/getting-started/migrate-from-nestjs.md', '`createDenoFetchHandler(...)` automatically performs websocket upgrades.'],
    ['docs/getting-started/migrate-from-nestjs.md', '`createDenoFetchHandler(...)` does not start a server, but it installs signal handlers.'],
    ['docs/getting-started/migrate-from-nestjs.md', '`createDenoFetchHandler(...)` returns a handler. It installs signal handlers.'],
    ['docs/getting-started/migrate-from-nestjs.md', '`createDenoFetchHandler(...)` does not start a server while it owns shutdown.'],
    ['docs/getting-started/migrate-from-nestjs.md', 'The host-owned `createDenoFetchHandler(...)` path starts a Deno server.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`createDenoFetchHandler(...)`가 Deno server를 시작합니다.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`createDenoFetchHandler(...)`가 signal handler를 설치합니다.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`createDenoFetchHandler(...)`가 shutdown을 소유합니다.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`createDenoFetchHandler(...)`가 websocket upgrade를 자동 수행합니다.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`createDenoFetchHandler(...)`는 server를 시작하지 않지만 signal handler를 설치합니다.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`createDenoFetchHandler(...)`는 handler를 반환합니다. 이 handler는 signal handler를 설치합니다.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`createDenoFetchHandler(...)`는 server를 시작하지 않으면서 shutdown을 소유합니다.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', 'Host-owned `createDenoFetchHandler(...)` 경로가 Deno server를 시작합니다.'],
  ] as const)('rejects contradictory host-owned lifecycle guidance in %s', (relativePath, contradiction) => {
    // Given
    const readWithContradiction = (requestedPath: string): string =>
      requestedPath === relativePath ? `${read(requestedPath)}\n${contradiction}` : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleContract(readWithContradiction);

    // Then
    expect(runGovernanceGuard).toThrow(/must not claim that createDenoFetchHandler/);
  });

  it.each([
    ['docs/getting-started/migrate-from-nestjs.md', '`createDenoFetchHandler(...)` returns a handler. It does not install signal handlers or own shutdown.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`createDenoFetchHandler(...)`는 handler를 반환합니다. 이 handler는 signal handler를 설치하지 않고 shutdown도 소유하지 않습니다.'],
  ] as const)('accepts direct negative lifecycle guidance across sentences in %s', (relativePath, guidance) => {
    // Given
    const readWithNegativeGuidance = overrideFile(relativePath, (content) => `${content}\n${guidance}`);

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleContract(readWithNegativeGuidance);

    // Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it.each([
    ['docs/getting-started/migrate-from-nestjs.md', '`app.listen()` does not register shutdown signal handlers.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`app.listen()`은 shutdown signal handler를 등록하지 않습니다.'],
  ] as const)('accepts direct negative app.listen signal guidance in %s', (relativePath, guidance) => {
    // Given
    const readWithNegativeGuidance = overrideFile(relativePath, (content) => `${content}\n${guidance}`);

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleContract(readWithNegativeGuidance);

    // Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it.each([
    ['docs/getting-started/migrate-from-nestjs.md', '`app.listen()` registers shutdown signal handlers.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`app.listen()`이 shutdown signal handler를 등록합니다.'],
    ['packages/platform-deno/README.md', '`app.listen()` registers shutdown signal handlers.'],
    ['packages/platform-deno/README.ko.md', '`app.listen()`이 shutdown signal handler를 등록합니다.'],
  ] as const)('rejects app.listen signal ownership in %s', (relativePath, contradiction) => {
    // Given
    const readWithAppListenSignalOwnership = overrideFile(relativePath, (content) => `${content}\n${contradiction}`);

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleContract(readWithAppListenSignalOwnership);

    // Then
    expect(runGovernanceGuard).toThrow(/app\.listen\(\).*must not own shutdown signal registration/);
  });

  it.each([
    ['docs/CONTEXT.md', 'docs/getting-started/migrate-from-nestjs.md'],
    ['docs/CONTEXT.ko.md', 'docs/getting-started/migrate-from-nestjs.ko.md'],
  ] as const)('requires the migration map link in the Deno context entry in %s', (relativePath, migrationPath) => {
    // Given
    const readWithoutDenoMigrationLink = (requestedPath: string): string => {
      const content = read(requestedPath);
      return requestedPath === relativePath
        ? content
            .split('\n')
            .map((line) => line.includes('createDenoFetchHandler(...)') ? line.replace(migrationPath, '') : line)
            .join('\n')
        : content;
    };

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleContract(readWithoutDenoMigrationLink);

    // Then
    expect(runGovernanceGuard).toThrow(/must link the Deno lifecycle contract/);
  });
});
