import { HandlerNotFoundError } from '../errors.js';
import {
  HttpException,
  InternalServerErrorException,
  NotAcceptableException,
  NotFoundException,
  createErrorResponse,
} from '../exceptions.js';
import type {
  DispatcherLogger,
  FrameworkResponse,
  HandlerDescriptor,
  HtmlErrorRepresentationProvider,
  HttpErrorRepresentationContext,
  HttpErrorRepresentationOptions,
  RequestContext,
} from '../types.js';
import {
  canNegotiateHtml,
  readAcceptHeader,
  selectErrorRepresentation,
} from './dispatch-error-negotiation.js';
import { isRequestAborted } from './request-abort.js';

const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const NOT_ACCEPTABLE_MESSAGE = 'No acceptable response representation found.';
const PROVIDER_FAILURE_MESSAGE = 'HTML error representation provider threw before response commit; falling back to canonical JSON.';

type WriteErrorResponseOptions = {
  readonly handler?: HandlerDescriptor;
  readonly logger?: DispatcherLogger;
  readonly representation?: HttpErrorRepresentationOptions;
};

function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  if (error instanceof HandlerNotFoundError) {
    const message = error instanceof Error ? error.message : 'Resource not found.';
    return new NotFoundException(message, { cause: error });
  }

  return new InternalServerErrorException('Internal server error.', { cause: error });
}

function isHttpRepresentationEligible(error: unknown): boolean {
  return error instanceof HttpException || error instanceof HandlerNotFoundError;
}

function createRepresentationContext(
  error: HttpException,
  requestContext: RequestContext,
  handler: HandlerDescriptor | undefined,
): HttpErrorRepresentationContext {
  return {
    container: requestContext.container,
    error,
    ...(handler === undefined ? {} : { handler }),
    json: createErrorResponse(error, requestContext.requestId),
    request: requestContext.request,
    ...(requestContext.requestId === undefined ? {} : { requestId: requestContext.requestId }),
  };
}

async function isHtmlAvailable(
  provider: HtmlErrorRepresentationProvider,
  context: HttpErrorRepresentationContext,
): Promise<boolean> {
  return provider.canRender === undefined || await provider.canRender(context);
}

function setNegotiatedHeaders(response: FrameworkResponse, contentType: string): void {
  response.setHeader('Content-Type', contentType);
  const varyEntry = Object.entries(response.headers).find(([name]) => name.toLowerCase() === 'vary');
  const varyValues = (Array.isArray(varyEntry?.[1]) ? varyEntry[1] : varyEntry?.[1]?.split(','))
    ?.map((value) => value.trim())
    .filter(Boolean) ?? [];

  if (!varyValues.some((value) => value.toLowerCase() === 'accept')) {
    varyValues.push('Accept');
  }
  response.setHeader(varyEntry?.[0] ?? 'Vary', varyValues.join(', '));
}

async function writeBody(
  requestContext: RequestContext,
  status: number,
  contentType: string,
  body: unknown,
): Promise<void> {
  if (requestContext.response.committed || isRequestAborted(requestContext.request)) {
    return;
  }

  requestContext.response.setStatus(status);
  setNegotiatedHeaders(requestContext.response, contentType);
  await requestContext.response.send(requestContext.request.method.toUpperCase() === 'HEAD' ? undefined : body);
}

async function writeCanonicalJson(error: HttpException, requestContext: RequestContext): Promise<void> {
  await writeBody(
    requestContext,
    error.status,
    JSON_CONTENT_TYPE,
    createErrorResponse(error, requestContext.requestId),
  );
}

export async function writeErrorResponse(
  error: unknown,
  requestContext: RequestContext,
  options: WriteErrorResponseOptions = {},
): Promise<void> {
  if (requestContext.response.committed || isRequestAborted(requestContext.request)) {
    return;
  }

  const httpError = toHttpException(error);
  const provider = options.representation?.html;

  if (provider === undefined || !isHttpRepresentationEligible(error)) {
    requestContext.response.setStatus(httpError.status);
    await requestContext.response.send(createErrorResponse(httpError, requestContext.requestId));
    return;
  }

  const acceptHeader = readAcceptHeader(requestContext);
  const representationContext = createRepresentationContext(httpError, requestContext, options.handler);
  let htmlAvailable = false;

  try {
    htmlAvailable = canNegotiateHtml(acceptHeader) && await isHtmlAvailable(provider, representationContext);
  } catch (providerError) {
    if (isRequestAborted(requestContext.request)) {
      return;
    }
    options.logger?.error(PROVIDER_FAILURE_MESSAGE, providerError, 'HttpDispatcher');
    await writeCanonicalJson(httpError, requestContext);
    return;
  }

  const selected = selectErrorRepresentation(acceptHeader, htmlAvailable);

  if (selected === undefined) {
    await writeCanonicalJson(new NotAcceptableException(NOT_ACCEPTABLE_MESSAGE), requestContext);
    return;
  }

  if (selected === 'json') {
    await writeCanonicalJson(httpError, requestContext);
    return;
  }

  if (requestContext.request.method.toUpperCase() === 'HEAD') {
    await writeBody(requestContext, httpError.status, HTML_CONTENT_TYPE, undefined);
    return;
  }

  try {
    const body = await provider.render(representationContext);
    await writeBody(requestContext, httpError.status, HTML_CONTENT_TYPE, body);
  } catch (providerError) {
    if (isRequestAborted(requestContext.request)) {
      return;
    }
    options.logger?.error(PROVIDER_FAILURE_MESSAGE, providerError, 'HttpDispatcher');
    await writeCanonicalJson(httpError, requestContext);
  }
}
