import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('WebSocket room injection token and backpressure runtime limit discoverability', () => {
  it('documents the supported lifecycle service injection token instead of injecting the type-only WebSocketRoomService contract', () => {
    const englishDocs = [
      read('packages/websockets/README.md'),
      read('docs/reference/package-surface.md'),
      read('docs/CONTEXT.md'),
      read('docs/getting-started/migrate-from-nestjs.md'),
      read('book/intermediate/ch13-websockets.md'),
    ];
    const koreanDocs = [
      read('packages/websockets/README.ko.md'),
      read('docs/reference/package-surface.ko.md'),
      read('docs/CONTEXT.ko.md'),
      read('docs/getting-started/migrate-from-nestjs.ko.md'),
      read('book/intermediate/ch13-websockets.ko.md'),
    ];

    for (const source of [...englishDocs, ...koreanDocs]) {
      expect(source).toContain('WebSocketGatewayLifecycleService');
      expect(source).toContain('@Inject');
      expect(source).toContain('WebSocketRoomService');
    }
  });

  it('limits room broadcast backpressure claims to the Node.js-backed adapter', () => {
    const englishDocs = [
      read('packages/websockets/README.md'),
      read('docs/reference/package-surface.md'),
      read('docs/CONTEXT.md'),
      read('docs/getting-started/migrate-from-nestjs.md'),
      read('book/intermediate/ch13-websockets.md'),
    ];
    const koreanDocs = [
      read('packages/websockets/README.ko.md'),
      read('docs/reference/package-surface.ko.md'),
      read('docs/CONTEXT.ko.md'),
      read('docs/getting-started/migrate-from-nestjs.ko.md'),
      read('book/intermediate/ch13-websockets.ko.md'),
    ];

    for (const source of [...englishDocs, ...koreanDocs]) {
      expect(source).toContain('backpressure');
      expect(source).toContain('Node');
    }

    expect(englishDocs.join('\n')).toContain('fetch-style runtimes');
    expect(englishDocs.join('\n')).toContain('do not apply a backpressure policy to room broadcasts');
    expect(koreanDocs.join('\n')).toContain('fetch-style runtime');
    expect(koreanDocs.join('\n')).toContain('backpressure policy를 적용하지 않');
  });
});