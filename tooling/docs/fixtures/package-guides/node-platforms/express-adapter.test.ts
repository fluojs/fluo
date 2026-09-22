import type { ExpressNativeMiddleware } from '@fluojs/platform-express';
import { ExpressHttpApplicationAdapter } from '@fluojs/platform-express';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { AppModule, SEED_POST } from './posts-app';

/**
 * Package-guide fixture for @fluojs/platform-express
 * (apps/docs/content/docs/packages/platform-express.mdx).
 *
 * Exercises the Express adapter's native-middleware boundary over a real
 * listener on an OS-assigned port: native handlers that call next() hand off
 * into fluo dispatch, native handlers may end the response early, and native
 * errors stay in the Express error chain instead of fluo error filters. Apps
 * close in finally; there are no sleeps.
 */

/**
 * Structural handler parameter types. express's own types are not resolvable
 * from the tooling tsconfig, so each handler declares the members it uses;
 * assigning the array to `readonly ExpressNativeMiddleware[]` still proves
 * the handlers are Express `RequestHandler`/`ErrorRequestHandler` compatible.
 */
type NativeRequest = { readonly path: string };
type NativeResponse = {
  setHeader(name: string, value: string): unknown;
  status(code: number): NativeResponse;
  json(body: unknown): unknown;
};
type NativeNext = (error?: unknown) => void;

const nativeHandlers: readonly ExpressNativeMiddleware[] = [
  // Runs for every request: tags the response, then continues into fluo.
  (_request: NativeRequest, response: NativeResponse, next: NativeNext): void => {
    response.setHeader('x-migration-host', 'express');
    next();
  },
  // Ends the response before fluo dispatch for its own path only.
  (request: NativeRequest, response: NativeResponse, next: NativeNext): void => {
    if (request.path === '/native-only') {
      response.status(200).json({ native: true });
      return;
    }
    next();
  },
  // Injects an error into the Express error chain for its own path only.
  (request: NativeRequest, _response: NativeResponse, next: NativeNext): void => {
    if (request.path === '/native-error') {
      next(new Error('native boom'));
      return;
    }
    next();
  },
  // Native Express error handler (runtime arity 4 is what makes Express treat
  // it as error middleware): fluo error filters never see pre-dispatch
  // failures, so this handler must respond in the same native stack.
  (error: unknown, _request: NativeRequest, response: NativeResponse, _next: NativeNext): void => {
    response.status(500).json({
      message: error instanceof Error ? error.message : String(error),
      source: 'native-error-handler',
    });
  },
];

describe('docs packages node-platforms — Express adapter', () => {
  it('keeps fluo dispatch after native middleware calls next()', async () => {
    const adapter = ExpressHttpApplicationAdapter.create({
      host: '127.0.0.1',
      nativeMiddleware: nativeHandlers,
      port: 0,
    });
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      await app.listen();
      const target = adapter.getListenTarget();
      expect(target.url.startsWith('http://127.0.0.1:')).toBe(true);

      const list = await fetch(`${target.url}/posts`);
      expect(list.status).toBe(200);
      expect(list.headers.get('x-migration-host')).toBe('express');
      await expect(list.json()).resolves.toEqual([SEED_POST]);

      const create = await fetch(`${target.url}/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Express', content: 'Created on the Express listener.' }),
      });
      expect(create.status).toBe(201);
      await expect(create.json()).resolves.toEqual({
        id: '2',
        title: 'Express',
        content: 'Created on the Express listener.',
      });
    } finally {
      await app.close();
    }
  });

  it('ends the response at the native handler without entering fluo dispatch', async () => {
    const adapter = ExpressHttpApplicationAdapter.create({
      host: '127.0.0.1',
      nativeMiddleware: nativeHandlers,
      port: 0,
    });
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      await app.listen();
      const target = adapter.getListenTarget();

      const native = await fetch(`${target.url}/native-only`);
      expect(native.status).toBe(200);
      expect(native.headers.get('x-migration-host')).toBe('express');
      await expect(native.json()).resolves.toEqual({ native: true });
    } finally {
      await app.close();
    }
  });

  it('keeps native failures in the Express error chain', async () => {
    const adapter = ExpressHttpApplicationAdapter.create({
      host: '127.0.0.1',
      nativeMiddleware: nativeHandlers,
      port: 0,
    });
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      await app.listen();
      const target = adapter.getListenTarget();

      const failed = await fetch(`${target.url}/native-error`);
      expect(failed.status).toBe(500);
      expect(failed.headers.get('x-migration-host')).toBe('express');

      const body = (await failed.json()) as { error?: unknown; message: string; source: string };
      expect(body.source).toBe('native-error-handler');
      expect(body.message).toBe('native boom');
      // The canonical fluo envelope ({ error: { code, status } }) must be absent:
      // the failure never reached the fluo dispatcher's error filters.
      expect(body).not.toHaveProperty('error');
    } finally {
      await app.close();
    }
  });
});
