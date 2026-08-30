import { Container } from '@fluojs/di';
import type { RequestContext } from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { bootstrapApplication } from '../bootstrap.js';
import { defineRuntimeModuleMetadata } from '../internal/core-metadata.js';
import type { ApplicationLogger } from '../types.js';
import { StudioDevtoolsRuntime } from './studio-runtime.js';

const logger: ApplicationLogger = {
  debug() {},
  error() {},
  log() {},
  warn() {},
};

describe('Studio runtime transport failures', () => {
  it('does not reject bootstrap when the host transport throws synchronously', async () => {
    // Given
    class AppModule {}
    defineRuntimeModuleMetadata(AppModule, {});
    const studio = new StudioDevtoolsRuntime({
      appId: 'sync-throw-app',
      runtime: 'bun',
      transport: { publish() { throw new Error('host transport failed'); } },
    });

    // When
    const app = await bootstrapApplication({ logger, rootModule: AppModule, studio });

    // Then
    expect(app.bootstrapTiming).toBeDefined();
    await app.close();
  });

  it('does not break request observation when the host transport throws synchronously', () => {
    // Given
    const studio = new StudioDevtoolsRuntime({
      appId: 'sync-throw-app',
      runtime: 'bun',
      transport: { publish() { throw new Error('host transport failed'); } },
    });
    const requestContext = {
      container: new Container(),
      metadata: {},
      request: {
        cookies: {},
        headers: {},
        method: 'GET',
        params: {},
        path: '/health',
        query: {},
        raw: {},
        requestId: 'request-1',
        url: '/health',
      },
      response: {
        committed: false,
        headers: {},
        redirect() {},
        async send() {},
        setHeader() {},
        setStatus() {},
        statusCode: 200,
      },
    } satisfies RequestContext;

    // When
    const observeRequest = () => {
      studio.requestObserver.onRequestStart?.({ requestContext });
      studio.requestObserver.onRequestFinish?.({ requestContext });
    };

    // Then
    expect(observeRequest).not.toThrow();
  });
});
