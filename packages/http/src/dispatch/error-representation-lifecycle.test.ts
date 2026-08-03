import { Scope as ScopeDecorator } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { describe, expect, it, vi } from 'vitest';

import type {
  FrameworkResponse,
  HttpErrorRepresentationContext,
} from '../index.js';
import {
  createRequest,
  createResponse,
  createTestDispatcher,
} from './error-representation.test-fixture.js';

class CountingContainer extends Container {
  requestScopeDisposeCount = 0;

  override createRequestScope(): Container {
    const scope = super.createRequestScope();
    const dispose = scope.dispose.bind(scope);
    scope.dispose = async () => {
      this.requestScopeDisposeCount += 1;
      await dispose();
    };
    return scope;
  }
}

describe('HTTP error representation lifecycle', () => {
  it('falls back once to the original canonical JSON outcome when the HTML provider fails', async () => {
    const representationFailure = new Error('representation failed');
    const logger = { error: vi.fn() };
    const { dispatcher } = createTestDispatcher({
      render() {
        throw representationFailure;
      },
    }, { logger });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/missing', 'text/html'), response);

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND', status: 404 } });
    expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(logger.error).toHaveBeenCalledWith(
      'HTML error representation provider threw before response commit; falling back to canonical JSON.',
      representationFailure,
      'HttpDispatcher',
    );
  });

  it('does not merge unknown failures into the HttpException representation phase', async () => {
    const render = vi.fn(() => '<main>unused</main>');
    const { dispatcher } = createTestDispatcher({ render });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/failures/unknown', 'text/html'), response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({ error: { code: 'INTERNAL_SERVER_ERROR', status: 500 } });
    expect(render).not.toHaveBeenCalled();
  });

  it('does not invoke a provider after onError handles or the response is already committed', async () => {
    const render = vi.fn(() => '<main>unused</main>');
    const onError = vi.fn((_error, _request, response: FrameworkResponse) => {
      response.setStatus(418);
      void response.send({ handled: true });
      return true;
    });
    const handled = createTestDispatcher({ render }, { onError });
    const handledResponse = createResponse();

    await handled.dispatcher.dispatch(createRequest('/missing', 'text/html'), handledResponse);

    expect(handledResponse.statusCode).toBe(418);
    expect(handledResponse.body).toEqual({ handled: true });
    expect(render).not.toHaveBeenCalled();

    const committed = createTestDispatcher({ render });
    const committedResponse = createResponse();
    await committed.dispatcher.dispatch(createRequest('/failures/committed', 'text/html'), committedResponse);

    expect(committedResponse.statusCode).toBeUndefined();
    expect(committedResponse.body).toBe('handler-owned');
    expect(render).not.toHaveBeenCalled();
  });

  it('stops without fallback commit when the request aborts while the provider is rendering', async () => {
    const abortController = new AbortController();
    const { dispatcher } = createTestDispatcher({
      render() {
        abortController.abort();
        return '<main>late</main>';
      },
    });
    const request = createRequest('/missing', 'text/html');
    request.signal = abortController.signal;
    const response = createResponse();

    await dispatcher.dispatch(request, response);

    expect(response.committed).toBe(false);
    expect(response.statusCode).toBeUndefined();
    expect(response.body).toBeUndefined();
  });

  it('lets unmatched HTML providers resolve request-scoped application dependencies', async () => {
    @ScopeDecorator('request')
    class ErrorDocumentState {
      readonly requestId = 'scoped-2889';
    }

    const render = vi.fn(async ({ container, handler, json }: HttpErrorRepresentationContext) => {
      const state = await container.resolve(ErrorDocumentState);
      expect(handler).toBeUndefined();
      return `<main>${json.error.status}:${state.requestId}</main>`;
    });
    const rootContainer = new CountingContainer();
    const fixture = createTestDispatcher({ render }, {}, rootContainer);
    fixture.rootContainer.register(ErrorDocumentState);
    const response = createResponse();

    await fixture.dispatcher.dispatch(createRequest('/unmatched', 'text/html'), response);

    expect(response.body).toBe('<main>404:scoped-2889</main>');
    expect(rootContainer.requestScopeDisposeCount).toBe(1);
  });
});
