import { describe, expect, it, vi } from 'vitest';
import { Container } from '@fluojs/di';

import {
  BadRequestException, Controller, createHandlerMapping, ForbiddenException, Get,
  type HttpErrorRepresentationContext, UnauthorizedException,
} from '../index.js';
import {
  createRequest,
  createResponse,
  createTestDispatcher,
} from './error-representation.test-fixture.js';

describe('HTTP-owned error representations', () => {
  @Controller('/navigation-failures')
  class NavigationFailureController {
    @Get('/unauthorized')
    unauthorized(): never {
      throw new UnauthorizedException('Session expired.');
    }

    @Get('/forbidden')
    forbidden(): never {
      throw new ForbiddenException('Permission denied.');
    }
  }

  it.each([
    ['/navigation-failures/unauthorized', 401, 'UNAUTHORIZED'],
    ['/navigation-failures/forbidden', 403, 'FORBIDDEN'],
    ['/missing', 404, 'NOT_FOUND'],
  ] as const)('preserves navigation GET HTTP status for %s (%i) with an HTML provider', async (path, status, code) => {
    // Given: a real dispatcher with matched auth failures and an application HTML provider.
    const canRender = vi.fn(() => true);
    const render = vi.fn(() => '<main>must not render</main>');
    const { dispatcher } = createTestDispatcher({ canRender, render }, {
      handlerMapping: createHandlerMapping([{ controllerToken: NavigationFailureController }]),
    }, new Container().register(NavigationFailureController));
    const response = createResponse();
    // When: the exact GET v2 protocol requests an error, not a successful destination.
    await dispatcher.dispatch(createRequest(path, 'application/vnd.fluo.react-navigation+json;v=2'), response);
    // Then: canonical HTTP errors retain status without HTML, page approval or public grant.
    expect(response.statusCode).toBe(status);
    expect(response.body).toMatchObject({ error: { code, status } });
    expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(response.headers.Vary).toBe('Accept');
    expect(response.headers['X-Fluo-Navigation-Prefetch']).toBeUndefined();
    expect(response.body).not.toHaveProperty('destination');
    expect(canRender).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', 'application/vnd.fluo.react-navigation+json;v=1'],
    ['GET', 'application/vnd.fluo.react-navigation+json;v=3'],
    ['GET', 'application/vnd.fluo.react-navigation+json;v=2;q=0'],
    ['HEAD', 'application/vnd.fluo.react-navigation+json;v=2'],
    ['POST', 'application/vnd.fluo.react-navigation+json;v=2'],
    ['PUT', 'application/vnd.fluo.react-navigation+json;v=2'],
  ] as const)('keeps unsupported navigation error negotiation at 406 for %s %s', async (method, accept) => {
    // Given: an unsupported method/version/quality with the same application HTML provider.
    const render = vi.fn(() => '<main>unused</main>');
    const { dispatcher } = createTestDispatcher({ render });
    const response = createResponse();
    // When: the request is outside the exact GET v2 error protocol.
    await dispatcher.dispatch(createRequest('/missing', accept, method), response);
    // Then: existing 406 and HEAD body suppression remain intact.
    expect(response.statusCode).toBe(406);
    expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
    if (method === 'HEAD') expect(response.body).toBeUndefined();
    else expect(response.body).toMatchObject({ error: { code: 'NOT_ACCEPTABLE', status: 406 } });
    expect(render).not.toHaveBeenCalled();
  });

  it.each(['application/json', 'text/html'])('preserves a compatible duplicate-copy HTTP exception for %s', async (accept) => {
    const duplicateError = new BadRequestException('Invalid request.', {
      details: [{ code: 'INVALID_NAME', field: 'name', message: 'Name is invalid.' }],
      meta: { duplicate: true },
    });
    vi.resetModules();
    const { writeErrorResponse } = await import('./dispatch-error-representation.js');
    const render = vi.fn(({ json }: HttpErrorRepresentationContext) => JSON.stringify(json));
    const response = createResponse();

    await writeErrorResponse(duplicateError, {
      container: {} as never,
      metadata: {},
      request: createRequest('/duplicate', accept),
      requestId: 'duplicate-request',
      response,
    }, { representation: { html: { render } } });

    expect(response.statusCode).toBe(400);
    if (accept === 'application/json') {
      expect(response.body).toMatchObject({
        error: {
          code: 'BAD_REQUEST',
          details: [{ code: 'INVALID_NAME', field: 'name', message: 'Name is invalid.' }],
          meta: { duplicate: true },
          status: 400,
        },
      });
    } else {
      expect(render).toHaveBeenCalledOnce();
    }
  });

  it.each([
    { accept: 'application/json', contentType: 'application/json; charset=utf-8', htmlCalls: 0, kind: 'json' },
    { accept: 'text/html', contentType: 'text/html; charset=utf-8', htmlCalls: 1, kind: 'html' },
    { accept: 'application/json;q=0.2, text/html;q=0.9', contentType: 'text/html; charset=utf-8', htmlCalls: 1, kind: 'html' },
    { accept: 'application/json;q=0.9, text/html;q=0.2', contentType: 'application/json; charset=utf-8', htmlCalls: 0, kind: 'json' },
    { accept: 'text/*', contentType: 'text/html; charset=utf-8', htmlCalls: 1, kind: 'html' },
    { accept: 'text/html;q=0, */*;q=1', contentType: 'application/json; charset=utf-8', htmlCalls: 0, kind: 'json' },
    { accept: '*/*', contentType: 'application/json; charset=utf-8', htmlCalls: 0, kind: 'json' },
    { accept: undefined, contentType: 'application/json; charset=utf-8', htmlCalls: 0, kind: 'json' },
  ])('selects $kind deterministically for Accept=$accept', async ({ accept, contentType, htmlCalls, kind }) => {
    const render = vi.fn(async ({ error }: HttpErrorRepresentationContext) => `<main>${error.code}</main>`);
    const { dispatcher } = createTestDispatcher({ render });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/missing', accept), response);

    expect(response.statusCode).toBe(404);
    expect(response.headers['Content-Type']).toBe(contentType);
    expect(response.headers.Vary).toBe('Accept');
    expect(render).toHaveBeenCalledTimes(htmlCalls);
    if (kind === 'html') {
      expect(response.body).toBe('<main>NOT_FOUND</main>');
    } else {
      expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND', status: 404 } });
    }
  });

  it('returns a canonical JSON 406 without recursively invoking HTML for unsupported media types', async () => {
    const render = vi.fn(() => '<main>unused</main>');
    const { dispatcher } = createTestDispatcher({ render });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/missing', 'image/avif'), response);

    expect(response.statusCode).toBe(406);
    expect(response.body).toMatchObject({ error: { code: 'NOT_ACCEPTABLE', status: 406 } });
    expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(render).not.toHaveBeenCalled();
  });

  it('negotiates HTML from mixed-case Accept headers', async () => {
    const render = vi.fn(async ({ error }: HttpErrorRepresentationContext) => `<main>${error.code}</main>`);
    const { dispatcher } = createTestDispatcher({ render });
    const response = createResponse();

    await dispatcher.dispatch(
      {
        ...createRequest('/missing'),
        headers: { aCcEpT: 'text/html' },
      },
      response,
    );

    expect(response.statusCode).toBe(404);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.body).toBe('<main>NOT_FOUND</main>');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('negotiates HTML from blank-first duplicate-case Accept headers', async () => {
    const render = vi.fn(async ({ error }: HttpErrorRepresentationContext) => `<main>${error.code}</main>`);
    const { dispatcher } = createTestDispatcher({ render });
    const response = createResponse();

    await dispatcher.dispatch(
      {
        ...createRequest('/missing'),
        headers: {
          Accept: '   ',
          aCcEpT: 'text/html',
        },
      },
      response,
    );

    expect(response.statusCode).toBe(404);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.body).toBe('<main>NOT_FOUND</main>');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('does not consult the HTML provider when a specific q=0 range rejects HTML', async () => {
    const canRender = vi.fn(() => true);
    const render = vi.fn(() => '<main>unused</main>');
    const { dispatcher } = createTestDispatcher({ canRender, render });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/missing', 'text/html;q=0, */*;q=1'), response);

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND', status: 404 } });
    expect(canRender).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('uses provider constraints without treating success @Produces metadata as error representation ownership', async () => {
    const canRender = vi.fn(({ handler }: HttpErrorRepresentationContext) => handler?.methodName !== 'badRequest');
    const render = vi.fn(() => '<main>unused</main>');
    const { dispatcher } = createTestDispatcher({ canRender, render });
    const response = createResponse();

    await dispatcher.dispatch(
      createRequest('/failures/bad-request', 'text/html;q=1, application/json;q=0.5'),
      response,
    );

    expect(canRender).toHaveBeenCalledWith(expect.objectContaining({
      handler: expect.objectContaining({ methodName: 'badRequest' }),
    }));
    expect(render).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'BAD_REQUEST',
        details: [{ code: 'INVALID_NAME', field: 'name', message: 'Name is invalid.', source: 'body' }],
        message: 'Invalid request.',
        meta: { retryable: false },
        requestId: 'request-2889',
        status: 400,
      },
    });
  });

  it('keeps HEAD status and negotiated headers without rendering or emitting a body', async () => {
    const canRender = vi.fn(() => true);
    const render = vi.fn(() => '<main>must not render</main>');
    const { dispatcher } = createTestDispatcher({ canRender, render });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/failures/head', 'text/html', 'HEAD'), response);

    expect(response.statusCode).toBe(404);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.headers.Vary).toBe('Accept');
    expect(response.body).toBeUndefined();
    expect(response.committed).toBe(true);
    expect(canRender).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
  });

  it.each(['/missing', '/failures/head'])(
    'suppresses provider-less canonical JSON bodies for HEAD request %s',
    async (path) => {
      const render = vi.fn(() => '<main>unused</main>');
      const { dispatcher } = createTestDispatcher({ render }, { errorRepresentation: undefined });
      const response = createResponse();

      await dispatcher.dispatch(createRequest(path, undefined, 'HEAD'), response);

      expect(response.statusCode).toBe(404);
      expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
      expect(response.body).toBeUndefined();
      expect(response.committed).toBe(true);
      expect(render).not.toHaveBeenCalled();
    },
  );

  it('suppresses canonical JSON bodies for HEAD 406 outcomes', async () => {
    const render = vi.fn(() => '<main>unused</main>');
    const { dispatcher } = createTestDispatcher({ render });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/missing', 'image/avif', 'HEAD'), response);

    expect(response.statusCode).toBe(406);
    expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(response.headers.Vary).toBe('Accept');
    expect(response.body).toBeUndefined();
    expect(response.committed).toBe(true);
    expect(render).not.toHaveBeenCalled();
  });

  it('preserves wildcard vary headers when negotiated responses add Accept', async () => {
    const render = vi.fn(() => '<main>unused</main>');
    const { dispatcher } = createTestDispatcher({ render });
    const response = createResponse();
    response.setHeader('vary', '*, Accept-Encoding');

    await dispatcher.dispatch(createRequest('/missing', 'application/json'), response);

    expect(response.headers.vary).toBe('*');
    expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
  });

});
