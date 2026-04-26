import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const tutorialPaths = [
  '../../../book/intermediate/ch13-websockets.md',
  '../../../book/intermediate/ch13-websockets.ko.md',
  '../../../book/intermediate/ch22-bun.md',
  '../../../book/intermediate/ch22-bun.ko.md',
  '../../../book/intermediate/ch23-deno.md',
  '../../../book/intermediate/ch23-deno.ko.md',
  '../../../book/intermediate/ch24-cloudflare.md',
  '../../../book/intermediate/ch24-cloudflare.ko.md',
] as const;

function readTutorial(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('@fluojs/websockets tutorial API alignment', () => {
  it('does not document stale Nest-style lifecycle APIs', () => {
    for (const relativePath of tutorialPaths) {
      const content = readTutorial(relativePath);

      expect(content, relativePath).not.toContain('OnGatewayConnection');
      expect(content, relativePath).not.toContain('SubscribeMessage');
    }
  });

  it('keeps fetch-style runtime tutorials wired to their runtime modules', () => {
    const bun = readTutorial('../../../book/intermediate/ch22-bun.md');
    const bunKo = readTutorial('../../../book/intermediate/ch22-bun.ko.md');
    const deno = readTutorial('../../../book/intermediate/ch23-deno.md');
    const denoKo = readTutorial('../../../book/intermediate/ch23-deno.ko.md');
    const workers = readTutorial('../../../book/intermediate/ch24-cloudflare.md');
    const workersKo = readTutorial('../../../book/intermediate/ch24-cloudflare.ko.md');

    expect(bun).toContain("import { BunWebSocketModule } from '@fluojs/websockets/bun';");
    expect(bun).toContain('BunWebSocketModule.forRoot()');
    expect(bunKo).toContain("import { BunWebSocketModule } from '@fluojs/websockets/bun';");
    expect(bunKo).toContain('BunWebSocketModule.forRoot()');

    expect(deno).toContain("import { DenoWebSocketModule } from '@fluojs/websockets/deno';");
    expect(deno).toContain('DenoWebSocketModule.forRoot()');
    expect(denoKo).toContain("import { DenoWebSocketModule } from '@fluojs/websockets/deno';");
    expect(denoKo).toContain('DenoWebSocketModule.forRoot()');

    expect(workers).toContain("import { CloudflareWorkersWebSocketModule } from '@fluojs/websockets/cloudflare-workers';");
    expect(workers).toContain('CloudflareWorkersWebSocketModule.forRoot()');
    expect(workersKo).toContain("import { CloudflareWorkersWebSocketModule } from '@fluojs/websockets/cloudflare-workers';");
    expect(workersKo).toContain('CloudflareWorkersWebSocketModule.forRoot()');
  });

  it('documents portable pre-upgrade guard header access', () => {
    const chapter = readTutorial('../../../book/intermediate/ch13-websockets.md');
    const chapterKo = readTutorial('../../../book/intermediate/ch13-websockets.ko.md');

    expect(chapter).toContain('request instanceof Request');
    expect(chapter).toContain("request.headers.get('authorization')");
    expect(chapter).toContain('request.headers.authorization');
    expect(chapterKo).toContain('request instanceof Request');
    expect(chapterKo).toContain("request.headers.get('authorization')");
    expect(chapterKo).toContain('request.headers.authorization');
  });
});
