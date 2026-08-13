import {
  Controller,
  Get,
  Head,
  Header,
  HttpCode,
  type HttpErrorRepresentationOptions,
  type Middleware,
  NotFoundException,
  type RequestContext,
} from '@fluojs/http';
import { defineModule, type ModuleType } from '@fluojs/runtime';

type ErrorRepresentationBootstrapOptions = {
  readonly cors: false;
  readonly errorRepresentation: HttpErrorRepresentationOptions | undefined;
  readonly middleware: Middleware[];
};

type RepresentationResponses = {
  readonly committed: Response;
  readonly head: Response;
  readonly html: Response;
  readonly json: Response;
  readonly jsonHead: Response;
  readonly successHead: Response;
  readonly unsupported: Response;
  readonly unsupportedHead: Response;
};

function hasErrorCode(value: unknown, code: string): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const error: unknown = Reflect.get(value, 'error');
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === code;
}

function assertStatus(response: Response, expected: number, name: string, scenario: string): void {
  if (response.status !== expected) {
    throw new Error(`${name} changed ${scenario} status: expected ${String(expected)}, received ${String(response.status)}.`);
  }
}

export async function assertProviderlessHeadResponse(name: string, response: Response): Promise<void> {
  assertStatus(response, 404, name, 'provider-less canonical JSON HEAD error representation');
  if (await response.text() !== '') {
    throw new Error(`${name} changed provider-less canonical JSON HEAD body suppression.`);
  }
}

export async function assertRepresentationResponses(
  name: string,
  responses: RepresentationResponses,
): Promise<void> {
  assertStatus(responses.html, 404, name, 'HTML error representation');
  assertStatus(responses.json, 404, name, 'JSON error representation');
  assertStatus(responses.head, 404, name, 'HEAD error representation');
  assertStatus(responses.jsonHead, 404, name, 'canonical JSON HEAD error representation');
  assertStatus(responses.successHead, 202, name, 'successful HEAD response');
  assertStatus(responses.unsupported, 406, name, 'unsupported error representation');
  assertStatus(responses.unsupportedHead, 406, name, 'unsupported HEAD error representation');
  assertStatus(responses.committed, 202, name, 'already-committed response');

  const [html, json, head, jsonHead, successHead, unsupported, unsupportedHead, committed] = await Promise.all([
    responses.html.text(),
    responses.json.json(),
    responses.head.text(),
    responses.jsonHead.text(),
    responses.successHead.text(),
    responses.unsupported.json(),
    responses.unsupportedHead.text(),
    responses.committed.text(),
  ]);

  if (!responses.html.headers.get('content-type')?.includes('text/html') || !html.includes('404:NOT_FOUND')) {
    throw new Error(`${name} changed negotiated HTML error representation semantics.`);
  }
  if (!hasErrorCode(json, 'NOT_FOUND')) {
    throw new Error(`${name} changed canonical JSON error representation semantics.`);
  }
  if (!responses.head.headers.get('content-type')?.includes('text/html') || head !== '') {
    throw new Error(`${name} changed HEAD error representation body suppression.`);
  }
  if (!responses.jsonHead.headers.get('content-type')?.includes('application/json') || jsonHead !== '') {
    throw new Error(`${name} changed canonical JSON HEAD error representation body suppression.`);
  }
  if (responses.successHead.headers.get('x-head-contract') !== 'preserved' || successHead !== '') {
    throw new Error(`${name} changed successful HEAD status, header, or body semantics.`);
  }
  if (!hasErrorCode(unsupported, 'NOT_ACCEPTABLE')) {
    throw new Error(`${name} changed unsupported error representation fallback semantics.`);
  }
  if (!responses.unsupportedHead.headers.get('content-type')?.includes('application/json') || unsupportedHead !== '') {
    throw new Error(`${name} changed unsupported HEAD error representation body suppression.`);
  }
  if (committed !== 'handler-owned') {
    throw new Error(`${name} rewrote an already-committed response through the error provider.`);
  }
}

export function createRepresentationFixture(): ModuleType {
  @Controller('/error-representations')
  class ErrorRepresentationController {
    @Get('/json')
    json(): never {
      throw new NotFoundException('Matched resource missing.');
    }

    @Head('/head')
    head(): never {
      throw new NotFoundException('HEAD resource missing.');
    }

    @Head('/success-head')
    @Header('x-head-contract', 'preserved')
    @HttpCode(202)
    successHead() {
      return { ok: true };
    }

    @Get('/committed')
    async committed(_input: undefined, context: RequestContext): Promise<never> {
      context.response.setStatus(202);
      await context.response.send('handler-owned');
      throw new NotFoundException('Committed response must not be replaced.');
    }
  }

  class AppModule {}
  defineModule(AppModule, { controllers: [ErrorRepresentationController] });
  return AppModule;
}

export function createErrorRepresentationOptions(): ErrorRepresentationBootstrapOptions {
  return {
    cors: false,
    errorRepresentation: {
      html: {
        render({ json }: { readonly json: { readonly error: { readonly code: string; readonly status: number } } }) {
          return `<html><body>${String(json.error.status)}:${json.error.code}</body></html>`;
        },
      },
    },
    middleware: [],
  };
}

export function createProviderlessErrorRepresentationOptions(): ErrorRepresentationBootstrapOptions {
  return {
    cors: false,
    errorRepresentation: undefined,
    middleware: [],
  };
}
