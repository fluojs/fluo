import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  type FrameworkRequest,
  type FrameworkResponse,
  Get,
  Header,
} from '../index.js';

type CustomResponseWriterContext = {
  readonly applySuccessResponseMetadata: () => void;
  readonly response: FrameworkResponse;
};

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

function createRequest(path: string, headers: FrameworkRequest['headers'] = {}): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers,
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

describe('dispatch response policy', () => {
  it('lets custom response writers bypass formatter negotiation before HTML streaming', async () => {
    const htmlEntry = { html: '<main>React SSR</main>' };

    Object.defineProperty(htmlEntry, Symbol.for('fluo.http.responseWriter'), {
      enumerable: false,
      value(context: CustomResponseWriterContext) {
        context.applySuccessResponseMetadata();
        context.response.setHeader('Content-Type', 'text/html; charset=utf-8');
        return context.response.send(htmlEntry.html);
      },
    });

    @Controller('/custom-writer-negotiation')
    class CustomWriterNegotiationController {
      @Header('x-react-route', 'html')
      @Get('/html')
      getValue() {
        return htmlEntry;
      }
    }

    const root = new Container().register(CustomWriterNegotiationController);
    const dispatcher = createDispatcher({
      contentNegotiation: {
        formatters: [
          {
            format(body) {
              return JSON.stringify(body);
            },
            mediaType: 'application/json',
          },
        ],
      },
      handlerMapping: createHandlerMapping([{ controllerToken: CustomWriterNegotiationController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/custom-writer-negotiation/html', { accept: 'text/plain' }), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-react-route']).toBe('html');
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.body).toBe('<main>React SSR</main>');
  });
});
