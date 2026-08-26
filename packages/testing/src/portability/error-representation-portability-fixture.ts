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
  readonly binary: Response;
  readonly binaryHead: Response;
  readonly committed: Response;
  readonly head: Response;
  readonly html: Response;
  readonly json: Response;
  readonly jsonHead: Response;
  readonly plain: Response;
  readonly plainHead: Response;
  readonly success: Response;
  readonly successHead: Response;
  readonly unsupported: Response;
  readonly unsupportedHead: Response;
};

type HeadRepresentationPair = {
  readonly headResponse: Response;
  readonly response: Response;
  readonly scenario: string;
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

async function assertHeadRepresentationParity(
  name: string,
  pair: HeadRepresentationPair,
): Promise<void> {
  const contentType = pair.response.headers.get('content-type');
  const headContentType = pair.headResponse.headers.get('content-type');
  if (contentType === null || headContentType !== contentType) {
    throw new Error(
      `${name} changed ${pair.scenario} HEAD content type parity: GET=${String(contentType)}, HEAD=${String(headContentType)}.`,
    );
  }
  const contentLength = pair.response.headers.get('content-length');
  const headContentLength = pair.headResponse.headers.get('content-length');
  if (contentLength !== null && headContentLength !== contentLength) {
    throw new Error(
      `${name} changed ${pair.scenario} HEAD content length parity: GET=${String(contentLength)}, HEAD=${String(headContentLength)}.`,
    );
  }
  if (await pair.response.arrayBuffer().then((body) => body.byteLength) === 0 || await pair.headResponse.text() !== '') {
    throw new Error(`${name} changed ${pair.scenario} GET body or HEAD body suppression semantics.`);
  }
}

/**
 * Verifies provider-less canonical JSON metadata and body suppression for a HEAD response.
 *
 * @param name Adapter name included in assertion failures.
 * @param response Provider-less HEAD response returned by the adapter.
 * @returns A promise that resolves when the response preserves the portable contract.
 */
export async function assertProviderlessHeadResponse(name: string, response: Response): Promise<void> {
  assertStatus(response, 404, name, 'provider-less canonical JSON HEAD error representation');
  if (response.headers.get('content-type') !== 'application/json; charset=utf-8' || await response.text() !== '') {
    throw new Error(`${name} changed provider-less canonical JSON HEAD representation metadata or body suppression.`);
  }
}

/**
 * Verifies negotiated error and successful HEAD responses returned by an adapter.
 *
 * @param name Adapter name included in assertion failures.
 * @param responses Responses collected from the shared representation fixture.
 * @returns A promise that resolves when every response preserves the portable contract.
 */
export async function assertRepresentationResponses(
  name: string,
  responses: RepresentationResponses,
): Promise<void> {
  assertStatus(responses.html, 404, name, 'HTML error representation');
  assertStatus(responses.json, 404, name, 'JSON error representation');
  assertStatus(responses.head, 404, name, 'HEAD error representation');
  assertStatus(responses.jsonHead, 404, name, 'canonical JSON HEAD error representation');
  assertStatus(responses.success, 202, name, 'successful JSON response');
  assertStatus(responses.successHead, 202, name, 'successful HEAD response');
  assertStatus(responses.plain, 200, name, 'successful plain text response');
  assertStatus(responses.plainHead, 200, name, 'successful plain text HEAD response');
  assertStatus(responses.binary, 200, name, 'successful binary response');
  assertStatus(responses.binaryHead, 200, name, 'successful binary HEAD response');
  assertStatus(responses.unsupported, 406, name, 'unsupported error representation');
  assertStatus(responses.unsupportedHead, 406, name, 'unsupported HEAD error representation');
  assertStatus(responses.committed, 202, name, 'already-committed response');

  const [html, json, head, jsonHead, unsupported, unsupportedHead, committed] = await Promise.all([
    responses.html.text(),
    responses.json.json(),
    responses.head.text(),
    responses.jsonHead.text(),
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
  if (responses.jsonHead.headers.get('content-type') !== 'application/json; charset=utf-8' || jsonHead !== '') {
    throw new Error(`${name} changed canonical JSON HEAD error representation metadata or body suppression.`);
  }
  if (responses.successHead.headers.get('x-head-contract') !== 'preserved') {
    throw new Error(`${name} changed successful HEAD explicit header semantics.`);
  }
  await assertHeadRepresentationParity(name, {
    headResponse: responses.successHead,
    response: responses.success,
    scenario: 'successful JSON',
  });
  await assertHeadRepresentationParity(name, {
    headResponse: responses.plainHead,
    response: responses.plain,
    scenario: 'successful plain text',
  });
  await assertHeadRepresentationParity(name, {
    headResponse: responses.binaryHead,
    response: responses.binary,
    scenario: 'successful binary',
  });
  if (!hasErrorCode(unsupported, 'NOT_ACCEPTABLE')) {
    throw new Error(`${name} changed unsupported error representation fallback semantics.`);
  }
  if (responses.unsupportedHead.headers.get('content-type') !== 'application/json; charset=utf-8' || unsupportedHead !== '') {
    throw new Error(`${name} changed unsupported HEAD error representation metadata or body suppression.`);
  }
  if (committed !== 'handler-owned') {
    throw new Error(`${name} rewrote an already-committed response through the error provider.`);
  }
}

/**
 * Creates the shared application module used by error-representation portability checks.
 *
 * @returns A module containing success, error, HEAD, and committed-response routes.
 */
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
    @Header('Content-Length', '11')
    @Header('x-head-contract', 'preserved')
    @HttpCode(202)
    successHead() {
      return { ok: true };
    }

    @Get('/success-head')
    @Header('Content-Length', '11')
    @HttpCode(202)
    success() {
      return { ok: true };
    }

    @Head('/plain-head')
    plainHead() {
      return 'plain response';
    }

    @Get('/plain-head')
    plain() {
      return 'plain response';
    }

    @Head('/binary-head')
    binaryHead() {
      return new Uint8Array([1, 2, 3]);
    }

    @Get('/binary-head')
    binary() {
      return new Uint8Array([1, 2, 3]);
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

/**
 * Creates bootstrap options with the shared HTML error-representation provider enabled.
 *
 * @returns Common adapter bootstrap options for negotiated representation checks.
 */
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

/**
 * Creates bootstrap options without an HTML error-representation provider.
 *
 * @returns Common adapter bootstrap options for canonical JSON fallback checks.
 */
export function createProviderlessErrorRepresentationOptions(): ErrorRepresentationBootstrapOptions {
  return {
    cors: false,
    errorRepresentation: undefined,
    middleware: [],
  };
}
