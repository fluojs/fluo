import { Controller, Post, type RequestContext } from '@fluojs/http';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';
import bodyParserCases from '../../../tooling/testing/body-parser-cases.json';
import { createCloudflareWorkerAdapter } from './adapter.js';

@Controller('/body')
class BodyController {
  @Post('/')
  echo(_input: undefined, { request }: RequestContext) {
    return { body: request.body, mime: request.headers['content-type'], raw: Array.from(request.rawBody ?? []) };
  }
}

class BodyModule {}
defineModule(BodyModule, { controllers: [BodyController] });

describe('Workers inherited bounded parser conformance', () => {
  it.each(bodyParserCases)('preserves %j with %s through the actual fetch adapter', async (body, mime) => {
    const adapter = createCloudflareWorkerAdapter({ bodyParser: 'text', rawBody: true });
    const app = await FluoFactory.create(BodyModule, { adapter });
    const lifecycles: Promise<unknown>[] = [];
    try {
      await app.listen();
      const request = new Request('https://worker.test/body', {
        method: 'POST', body, headers: { 'content-type': mime },
      });
      const response = await adapter.fetch(request, {}, { waitUntil: (pending) => { lifecycles.push(pending); } });
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ body, mime, raw: Array.from(new TextEncoder().encode(body)) });
      expect(request.headers.get('content-type')).toBe(mime);
      expect(request.bodyUsed).toBe(false);
      await expect(request.text()).resolves.toBe(body);
      expect(lifecycles).toHaveLength(1);
      await Promise.all(lifecycles);
    } finally { await app.close(); }
  });

  it('inherits custom parsing and UTF-8 limits before invoking the callback', async () => {
    let calls = 0;
    const adapter = createCloudflareWorkerAdapter({
      maxBodySize: 3,
      bodyParser(text, context) {
        calls += 1;
        return { text, path: context.path };
      },
    });
    const app = await FluoFactory.create(BodyModule, { adapter });
    const lifecycles: Promise<unknown>[] = [];
    try {
      await app.listen();
      for (const [body, status] of [['한', 201], ['한a', 413]] as const) {
        const response = await adapter.fetch(new Request('https://worker.test/body', {
          method: 'POST', body, headers: { 'content-type': 'application/json' },
        }), {}, { waitUntil: (pending) => { lifecycles.push(pending); } });
        expect(response.status).toBe(status);
        if (status === 201) await expect(response.json()).resolves.toMatchObject({ body: { text: '한', path: '/body' } });
      }
      expect(calls).toBe(1);
      await Promise.all(lifecycles);
    } finally { await app.close(); }
  });
});
