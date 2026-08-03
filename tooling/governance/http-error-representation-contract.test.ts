import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function expectIdentifiers(document: string, identifiers: readonly string[]): void {
  for (const identifier of identifiers) {
    expect(document).toContain(identifier);
  }
}

describe('HTTP error representation documentation contract', () => {
  it('keeps the bilingual architecture decision discoverable from both documentation hubs', () => {
    expect(read('docs/README.md')).toContain('./architecture/http-error-representations.md');
    expect(read('docs/README.ko.md')).toContain('./architecture/http-error-representations.ko.md');
    expect(read('docs/CONTEXT.md')).toContain('docs/architecture/http-error-representations.md');
    expect(read('docs/CONTEXT.ko.md')).toContain('docs/architecture/http-error-representations.ko.md');
  });

  it('keeps ownership and negotiation identifiers aligned across the bilingual decision pair', () => {
    for (const path of [
      'docs/architecture/http-error-representations.md',
      'docs/architecture/http-error-representations.ko.md',
    ]) {
      expectIdentifiers(read(path), [
        'HttpErrorRepresentationOptions',
        'HtmlErrorRepresentationProvider',
        'HandlerNotFoundError',
        'HttpException',
        'application/json',
        'text/html',
        'HEAD',
        '406',
      ]);
    }
  });

  it('keeps package-level bootstrap, React, and portability entrypoints documented in both locales', () => {
    for (const path of ['packages/http/README.md', 'packages/http/README.ko.md']) {
      expectIdentifiers(read(path), ['HttpErrorRepresentationOptions', 'application/json', 'text/html', 'HEAD', '406']);
    }

    for (const path of ['packages/runtime/README.md', 'packages/runtime/README.ko.md']) {
      expectIdentifiers(read(path), ['BootstrapApplicationOptions.errorRepresentation', 'FluoFactory.create(...)']);
    }

    for (const path of ['packages/react/README.md', 'packages/react/README.ko.md']) {
      expectIdentifiers(read(path), [
        'createReactErrorRepresentationProvider',
        'ReactServerEntry.status',
        'ReactServerEntry.headers',
      ]);
    }

    for (const path of ['packages/testing/README.md', 'packages/testing/README.ko.md']) {
      expectIdentifiers(read(path), [
        'assertSupportsHttpErrorRepresentations()',
        'createErrorRepresentationBootstrapOptions',
      ]);
    }
  });
});
