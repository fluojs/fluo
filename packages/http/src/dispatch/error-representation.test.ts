import { describe, expect, it, vi } from 'vitest';

import type { HttpErrorRepresentationContext } from '../index.js';
import {
  createRequest,
  createResponse,
  createTestDispatcher,
} from './error-representation.test-fixture.js';

describe('HTTP-owned error representations', () => {
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

});
