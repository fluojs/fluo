import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceDenoHostOwnedLifecycleContract } from './deno-host-owned-lifecycle-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
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
    ['docs/getting-started/migrate-from-nestjs.md', 'The host-owned `createDenoFetchHandler(...)` path starts a Deno server.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`createDenoFetchHandler(...)`가 Deno server를 시작합니다.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`createDenoFetchHandler(...)`가 signal handler를 설치합니다.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`createDenoFetchHandler(...)`가 shutdown을 소유합니다.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`createDenoFetchHandler(...)`가 websocket upgrade를 자동 수행합니다.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '`createDenoFetchHandler(...)`는 server를 시작하지 않지만 signal handler를 설치합니다.'],
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

  it('rejects lifecycle ownership options on the host-owned handler', () => {
    // Given
    const readWithSignalOption = (relativePath: string): string => {
      const content = read(relativePath);
      return relativePath === 'packages/platform-deno/src/fetch-handler.ts'
        ? content.replace('  readonly rawBody?: boolean;', '  readonly rawBody?: boolean;\n  readonly shutdownSignals?: boolean;')
        : content;
    };

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleContract(readWithSignalOption);

    // Then
    expect(runGovernanceGuard).toThrow(/must not expose server, shutdown, signal, or websocket ownership options/);
  });

  it('rejects server startup from the host-owned handler implementation', () => {
    // Given
    const readWithServeCall = (relativePath: string): string => {
      const content = read(relativePath);
      return relativePath === 'packages/platform-deno/src/fetch-handler.ts'
        ? content.replace(
            '  validateNonNegativeIntegerOption',
            '  globalThis.Deno?.serve({ port: 3000 }, async () => new Response());\n  validateNonNegativeIntegerOption',
          )
        : content;
    };

    // When
    const runGovernanceGuard = () => enforceDenoHostOwnedLifecycleContract(readWithServeCall);

    // Then
    expect(runGovernanceGuard).toThrow(/must not call serve/);
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
