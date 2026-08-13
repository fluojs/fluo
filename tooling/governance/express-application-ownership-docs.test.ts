import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceExpressApplicationOwnershipDocs } from './express-application-ownership-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const governedDocuments = [
  ['packages/platform-express/README.md', 'You can adopt an existing Express application and pass it to the adapter.'],
  ['packages/platform-express/README.ko.md', '기존 Express application을 adapter에 전달해 채택할 수 있습니다.'],
  ['docs/getting-started/migrate-from-nestjs.md', 'After bootstrap, you can call `use(...)` to append native middleware.'],
  ['docs/getting-started/migrate-from-nestjs.ko.md', 'bootstrap 후 `use(...)`를 호출해 native middleware를 추가할 수 있습니다.'],
  ['book/intermediate/ch21-express-node.md', 'An existing Express app may be reused by the fluo adapter.'],
  ['book/intermediate/ch21-express-node.ko.md', '기존 Express app을 fluo adapter가 재사용할 수 있습니다.'],
  ['apps/docs/content/docs/guides/runtime-adapters.mdx', 'Post-bootstrap code may call `use(...)` to register another native handler.'],
  ['apps/docs/content/docs/guides/runtime-adapters.ko.mdx', 'post-bootstrap code에서 `use(...)`로 native handler를 등록할 수 있습니다.'],
  ['docs/reference/package-surface.md', 'The adapter supports adopting an existing Express application.'],
  ['docs/reference/package-surface.ko.md', 'Adapter는 기존 Express application 채택을 지원합니다.'],
  ['docs/reference/package-chooser.md', 'You may supply an existing Express application to this package.'],
  ['docs/reference/package-chooser.ko.md', '이 패키지에 기존 Express application을 전달할 수 있습니다.'],
  ['docs/CONTEXT.md', 'After bootstrap, callers can use `use(...)` to mutate the native middleware stack.'],
  ['docs/CONTEXT.ko.md', 'bootstrap 후 caller가 `use(...)`로 native middleware stack을 변경할 수 있습니다.'],
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('Express application ownership migration documentation', () => {
  it('keeps source-backed ownership guidance synchronized across governed surfaces', () => {
    // Given / When
    const runGovernanceGuard = () => enforceExpressApplicationOwnershipDocs();

    // Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it.each(governedDocuments)('rejects contradictory ownership guidance in %s', (relativePath, contradiction) => {
    // Given
    const readWithContradiction = (requestedPath: string): string =>
      requestedPath === relativePath ? `${read(requestedPath)}\n${contradiction}` : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceExpressApplicationOwnershipDocs(readWithContradiction);

    // Then
    expect(runGovernanceGuard).toThrow(/Express application ownership contract check failed/);
  });

  it('rejects an existing application adoption option in the adapter source', () => {
    // Given
    const readWithApplicationOption = (relativePath: string): string => {
      const content = read(relativePath);
      return relativePath === 'packages/platform-express/src/adapter.ts'
        ? content.replace('  host?: string;', '  app?: Express;\n  host?: string;')
        : content;
    };

    // When
    const runGovernanceGuard = () => enforceExpressApplicationOwnershipDocs(readWithApplicationOption);

    // Then
    expect(runGovernanceGuard).toThrow(/existing Express application adoption options/);
  });

  it('rejects a public post-bootstrap use method on the adapter', () => {
    // Given
    const readWithUseMethod = (relativePath: string): string => {
      const content = read(relativePath);
      return relativePath === 'packages/platform-express/src/adapter.ts'
        ? content.replace(
            '  getServer(): ExpressServer {',
            '  use(_middleware: ExpressNativeMiddleware): void {}\n\n  getServer(): ExpressServer {',
          )
        : content;
    };

    // When
    const runGovernanceGuard = () => enforceExpressApplicationOwnershipDocs(readWithUseMethod);

    // Then
    expect(runGovernanceGuard).toThrow(/post-bootstrap native stack mutation surface/);
  });
});
