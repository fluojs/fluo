import { Container } from '@fluojs/di';

import {
  BadRequestException,
  type CreateDispatcherOptions,
  Controller,
  createDispatcher,
  createHandlerMapping,
  type FrameworkRequest,
  type FrameworkResponse,
  Get,
  Head,
  type HtmlErrorRepresentationProvider,
  NotFoundException,
  type RequestContext,
} from '../index.js';

export type TestResponse = FrameworkResponse & { body?: unknown };

@Controller('/failures')
class FailureController {
  @Get('/bad-request')
  badRequest(): never {
    throw new BadRequestException('Invalid request.', {
      details: [{ code: 'INVALID_NAME', field: 'name', message: 'Name is invalid.', source: 'body' }],
      meta: { retryable: false },
    });
  }

  @Head('/head')
  head(): never {
    throw new NotFoundException('HEAD resource missing.');
  }

  @Get('/unknown')
  unknown(): never {
    throw new Error('Unknown pipeline failure.');
  }

  @Get('/committed')
  committed(_input: undefined, context: RequestContext): never {
    void context.response.send('handler-owned');
    throw new NotFoundException('Too late to replace.');
  }
}

export function createRequest(
  path: string,
  accept?: string,
  method: FrameworkRequest['method'] = 'GET',
): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: accept === undefined ? {} : { accept },
    method,
    params: {},
    path,
    query: {},
    raw: {},
    requestId: 'request-2889',
    url: path,
  };
}

export function createResponse(): TestResponse {
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
  };
}

export function createTestDispatcher(
  provider: HtmlErrorRepresentationProvider,
  overrides: Partial<CreateDispatcherOptions> = {},
  rootContainer: Container = new Container(),
) {
  rootContainer.register(FailureController);
  const options: CreateDispatcherOptions = {
    errorRepresentation: { html: provider },
    handlerMapping: createHandlerMapping([{ controllerToken: FailureController }]),
    rootContainer,
    ...overrides,
  };

  return { dispatcher: createDispatcher(options), rootContainer };
}
