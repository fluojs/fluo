import { describe, expect, it } from 'vitest';

import type { HttpApplicationAdapter } from '@fluojs/http';
import { createBunAdapter } from '@fluojs/platform-bun';
import { createCloudflareWorkerAdapter } from '@fluojs/platform-cloudflare-workers';
import { createDenoAdapter } from '@fluojs/platform-deno';
import { createExpressAdapter } from '@fluojs/platform-express';
import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { createNodejsAdapter } from '@fluojs/platform-nodejs';

const adapters: ReadonlyArray<readonly [string, () => HttpApplicationAdapter]> = [
  ['Node.js', () => createNodejsAdapter()],
  ['Express', () => createExpressAdapter()],
  ['Fastify', () => createFastifyAdapter()],
  ['Web/Bun', () => createBunAdapter()],
  ['Web/Deno', () => createDenoAdapter()],
  ['Web/Cloudflare Workers', () => createCloudflareWorkerAdapter()],
];

describe.each(adapters)('%s streaming multipart capability', (_name, createAdapter) => {
  it('reports the equivalent portable buffered and streaming contract', () => {
    expect(createAdapter().getMultipartCapability?.()).toEqual({
      contract: 'portable-multipart',
      kind: 'multipart',
      modes: ['buffered', 'streaming'],
      version: 1,
    });
  });
});
