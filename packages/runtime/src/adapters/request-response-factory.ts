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
  const frameworkResponse = factory.createResponse(rawResponse, rawRequest);
  const signal = factory.createRequestSignal(rawResponse);

  try {
    const frameworkRequest = await factory.createRequest(rawRequest, signal);
    await factory.materializeRequest?.(frameworkRequest);

    if (!dispatcher) {
      throw new Error(dispatcherNotReadyMessage);
    }

    await dispatcher.dispatch(frameworkRequest, frameworkResponse);

    if (!frameworkResponse.committed) {
      await frameworkResponse.send(undefined);
    }

    return frameworkResponse;
  } catch (error: unknown) {
    if (signal.aborted || frameworkResponse.committed) {
      return frameworkResponse;
    }

    await factory.writeErrorResponse(error, frameworkResponse, factory.resolveRequestId(rawRequest));
    return frameworkResponse;
  }
}
