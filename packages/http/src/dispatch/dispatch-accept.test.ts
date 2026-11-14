import { describe, expect, it } from 'vitest';
import { Container } from '@fluojs/di';

import { Controller, createHandlerMapping, Get } from '../index.js';
import { createRequest, createResponse, createTestDispatcher } from './error-representation.test-fixture.js';

describe('shared Accept grammar through dispatch', () => {
  @Controller('/accept')
  class AcceptController {
    @Get('/')
    success() {
      return { ok: true };
    }
  }

  function createNegotiatingDispatcher(defaultMediaType = 'text/html') {
    return createTestDispatcher({ render: () => '<main>NOT_FOUND</main>' }, {
      contentNegotiation: {
        defaultMediaType,
        formatters: [
          { mediaType: 'text/html', format: () => '<main>ok</main>' },
          { mediaType: 'application/json', format: (body) => JSON.stringify(body) },
          { mediaType: 'application/problem+json', format: (body) => JSON.stringify(body) },
        ],
      },
      handlerMapping: createHandlerMapping([{ controllerToken: AcceptController }]),
    }, new Container().register(AcceptController)).dispatcher;
  }

  it.each([
    'text/html;q=0x1', 'text/html/garbage', '*/html',
    'text/html;q=0.1234', 'text/html;q=1.0000',
    'text/html;q=0.5;q=1', 'text/html;q=0.5;q=0.5',
    'text/html;q', 'text/html;q=', 'text/html;q=-0.1', 'text/html;q=1.001',
  ])('rejects malformed Accept=%s for success and errors with canonical 406', async (accept) => {
    const dispatcher = createNegotiatingDispatcher();

    for (const path of ['/accept', '/missing']) {
      const response = createResponse();

      await dispatcher.dispatch(createRequest(path, accept), response);

      expect(response.statusCode).toBe(406);
      expect(response.body).toMatchObject({ error: { status: 406, code: 'NOT_ACCEPTABLE' } });
      expect(response.headers.Vary).toBe('Accept');
    }
  });

  it.each([
    ['text/html;q=0x1, application/json;q=0.001', 'application/json'],
    ['text/html;q=0.5;q=0.5, application/json', 'application/json'],
    ['text/html;q=, text/html;q=1.', 'text/html'],
    ['text/html;q=0., */*;q=1.000', 'application/json'],
    ['TEXT/HTML;Q=0.123, application/json;q=0.122', 'text/html'],
    ['text/html;q=0, text/html;q=1, */*', 'application/json'],
  ] as const)('preserves valid alternatives and specificity for Accept=%s', async (accept, mediaType) => {
    const dispatcher = createNegotiatingDispatcher();

    for (const path of ['/accept', '/missing']) {
      const response = createResponse();

      await dispatcher.dispatch(createRequest(path, accept), response);

      expect(response.statusCode).toBe(path === '/accept' ? 200 : 404);
      expect(response.headers['Content-Type']).toBe(
        path === '/accept' ? mediaType : `${mediaType}; charset=utf-8`,
      );
    }
  });

  it.each(['*/*', 'text/html;q=0.5, application/json;q=0.5'])(
    'keeps success default and error JSON tie policies distinct for Accept=%s',
    async (accept) => {
      const dispatcher = createNegotiatingDispatcher();
      const success = createResponse();
      const failure = createResponse();

      await dispatcher.dispatch(createRequest('/accept', accept), success);
      await dispatcher.dispatch(createRequest('/missing', accept), failure);

      expect(success.headers['Content-Type']).toBe('text/html');
      expect(failure.headers['Content-Type']).toBe('application/json; charset=utf-8');
    },
  );

  it('keeps success declaration order when the configured default is outside a tie', async () => {
    const dispatcher = createNegotiatingDispatcher('application/problem+json');
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/accept', 'application/json, text/html'), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/html');
  });

  it('keeps structured suffix matching for successful representations', async () => {
    const dispatcher = createNegotiatingDispatcher();
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/accept', 'application/*+json'), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/problem+json');
    expect(response.body).toBe('{"ok":true}');
  });
});
