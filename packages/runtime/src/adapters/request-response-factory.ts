import type { Dispatcher, FrameworkRequest, FrameworkResponse } from '@fluojs/http';

/** Request/response factory seam used by shared HTTP adapter dispatch helpers. */
export interface RequestResponseFactory<
  RawRequest,
  RawResponse,
  Response extends FrameworkResponse = FrameworkResponse,
> {
  createRequest(rawRequest: RawRequest, signal: AbortSignal): Promise<FrameworkRequest>;
  createRequestSignal(rawResponse: RawResponse): AbortSignal;
  createResponse(rawResponse: RawResponse, rawRequest: RawRequest): Response;
  materializeRequest?(request: FrameworkRequest): Promise<void>;
  resolveRequestId(rawRequest: RawRequest): string | undefined;
  writeErrorResponse(error: unknown, response: Response, requestId?: string): Promise<void>;
}

/** Options for dispatching one raw platform request through a request/response factory. */
export interface DispatchWithRequestResponseFactoryOptions<
  RawRequest,
  RawResponse,
  Response extends FrameworkResponse = FrameworkResponse,
> {
  dispatcher?: Dispatcher;
  dispatcherNotReadyMessage: string;
  factory: RequestResponseFactory<RawRequest, RawResponse, Response>;
  rawRequest: RawRequest;
  rawResponse: RawResponse;
}

/** An in-progress factory dispatch with its response shell available immediately. */
export interface StartedRequestResponseFactoryDispatch<Response extends FrameworkResponse> {
  readonly completion: Promise<Response>;
  readonly response: Response;
}

/**
 * Starts one raw platform request dispatch while exposing its mutable response shell.
 *
 * @param options - Factory, dispatcher, and raw platform request/response values for one dispatch.
 * @returns The response shell and its independently settling dispatch lifecycle.
 */
export function startDispatchWithRequestResponseFactory<
  RawRequest,
  RawResponse,
  Response extends FrameworkResponse = FrameworkResponse,
>({
  dispatcher,
  dispatcherNotReadyMessage,
  factory,
  rawRequest,
  rawResponse,
}: DispatchWithRequestResponseFactoryOptions<RawRequest, RawResponse, Response>): StartedRequestResponseFactoryDispatch<Response> {
  const response = factory.createResponse(rawResponse, rawRequest);
  const signal = factory.createRequestSignal(rawResponse);
  let frameworkRequest: FrameworkRequest | undefined;
  const completion = (async (): Promise<Response> => {
    try {
      frameworkRequest = await factory.createRequest(rawRequest, signal);
      const materializeRequest = factory.materializeRequest;

      if (materializeRequest) {
        await materializeRequest(frameworkRequest);
      }

      if (!dispatcher) {
        throw new Error(dispatcherNotReadyMessage);
      }

      await dispatcher.dispatch(frameworkRequest, response);

      if (!response.committed) {
        await response.send(undefined);
      }

      return response;
    } catch (error: unknown) {
      if (signal.aborted || response.committed) {
        return response;
      }

      await factory.writeErrorResponse(error, response, factory.resolveRequestId(rawRequest));
      return response;
    } finally {
      await finalizeRouteOwnedMultipartBody(frameworkRequest);
    }
  })();

  return { completion, response };
}

/**
 * Dispatches one raw platform request through the shared request/response factory lifecycle.
 *
 * @param options - Factory, dispatcher, and raw platform request/response values for one dispatch.
 * @returns The framework response after dispatch, error serialization, or default finalization.
 */
export async function dispatchWithRequestResponseFactory<
  RawRequest,
  RawResponse,
  Response extends FrameworkResponse = FrameworkResponse,
>({
  dispatcher,
  dispatcherNotReadyMessage,
  factory,
  rawRequest,
  rawResponse,
}: DispatchWithRequestResponseFactoryOptions<RawRequest, RawResponse, Response>): Promise<Response> {
  return await startDispatchWithRequestResponseFactory({
    dispatcher,
    dispatcherNotReadyMessage,
    factory,
    rawRequest,
    rawResponse,
  }).completion;
}

/**
 * Finalizes a route-owned multipart body iterator after dispatch completes.
 *
 * @param request Framework request whose multipart body may need finalization.
 * @returns A promise that resolves after the iterator has been returned when applicable.
 */
export async function finalizeRouteOwnedMultipartBody(request: FrameworkRequest | undefined): Promise<void> {
  const body = request?.body;

  if (!isAsyncIterable(body)) {
    return;
  }

  const iterator = body[Symbol.asyncIterator]();

  if (iterator.return) {
    await iterator.return();
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && Symbol.asyncIterator in value
    && typeof value[Symbol.asyncIterator] === 'function'
  );
}
