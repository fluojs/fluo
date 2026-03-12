import { InvariantError, type Token } from '@konekti/core';
import type { Container } from '@konekti-internal/di';

import { HandlerNotFoundError } from './errors';
import { HttpException, InternalServerException, NotFoundException, createErrorResponse } from './exceptions';
import { DefaultBinder } from './binding';
import { runGuardChain } from './guards';
import { runInterceptorChain } from './interceptors';
import { runMiddlewareChain } from './middleware';
import { createRequestContext, runWithRequestContext } from './request-context';
import { DefaultValidator } from './validation';
import type {
  ArgumentResolverContext,
  Dispatcher,
  FrameworkRequest,
  FrameworkResponse,
  GuardContext,
  HandlerDescriptor,
  HandlerMapping,
  InterceptorContext,
  MiddlewareLike,
  RequestContext,
} from './types';

const defaultBinder = new DefaultBinder();
const defaultValidator = new DefaultValidator();

export interface CreateDispatcherOptions {
  appMiddleware?: MiddlewareLike[];
  handlerMapping: HandlerMapping;
  rootContainer: Container;
}

function createDispatchRequest(request: FrameworkRequest): FrameworkRequest {
  return {
    ...request,
    params: { ...request.params },
  };
}

function createDispatchContext(
  request: FrameworkRequest,
  response: FrameworkResponse,
  rootContainer: Container,
): RequestContext {
  return createRequestContext({
    container: rootContainer.createRequestScope(),
    metadata: {},
    request,
    response,
  });
}

function updateRequestParams(context: RequestContext, params: Readonly<Record<string, string>>): void {
  context.request = {
    ...context.request,
    params,
  };
}

async function invokeControllerHandler(
  handler: HandlerDescriptor,
  requestContext: RequestContext,
): Promise<unknown> {
  const controller = await requestContext.container.resolve(handler.controllerToken as Token<object>);
  const method = (controller as Record<string, unknown>)[handler.methodName];

  if (typeof method !== 'function') {
    throw new InvariantError(
      `Controller ${handler.controllerToken.name} does not expose handler method ${handler.methodName}.`,
    );
  }

  const argumentResolverContext: ArgumentResolverContext = {
    handler,
    requestContext,
  };
  const input = handler.route.request
    ? await defaultBinder.bind(handler.route.request, argumentResolverContext)
    : undefined;

  if (handler.route.request) {
    await defaultValidator.validate(input, handler.route.request);
  }

  return method.call(controller, input, requestContext);
}

async function writeSuccessResponse(handler: HandlerDescriptor, response: FrameworkResponse, value: unknown): Promise<void> {
  if (response.committed) {
    return;
  }

  if (handler.route.successStatus !== undefined) {
    response.setStatus(handler.route.successStatus);
  }

  await response.send(value);
}

function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  if (error instanceof HandlerNotFoundError) {
    return new NotFoundException(error.message, { cause: error });
  }

  return new InternalServerException('Internal server error.', {
    cause: error,
  });
}

async function writeErrorResponse(error: unknown, response: FrameworkResponse, requestId?: string): Promise<void> {
  if (response.committed) {
    return;
  }

  const httpError = toHttpException(error);
  response.setStatus(httpError.status);
  await response.send(createErrorResponse(httpError, requestId));
}

async function dispatchMatchedHandler(handler: HandlerDescriptor, requestContext: RequestContext): Promise<void> {
  const guardContext: GuardContext = {
    handler,
    requestContext,
  };
  const interceptorContext: InterceptorContext = {
    handler,
    requestContext,
  };

  await runGuardChain(handler.route.guards ?? [], guardContext);

  if (requestContext.response.committed) {
    return;
  }

  const result = await runInterceptorChain(handler.route.interceptors ?? [], interceptorContext, () =>
    invokeControllerHandler(handler, requestContext),
  );

  await writeSuccessResponse(handler, requestContext.response, result);
}

export function createDispatcher(options: CreateDispatcherOptions): Dispatcher {
  return {
    async dispatch(request: FrameworkRequest, response: FrameworkResponse): Promise<void> {
      const requestContext = createDispatchContext(createDispatchRequest(request), response, options.rootContainer);

      await runWithRequestContext(requestContext, async () => {
        try {
          await runMiddlewareChain(options.appMiddleware ?? [], {
            request: requestContext.request,
            requestContext,
            response,
          }, async () => {
            if (response.committed) {
              return;
            }

            const match = options.handlerMapping.match(requestContext.request);

            if (!match) {
              throw new HandlerNotFoundError(`No handler registered for ${request.method} ${request.path}.`);
            }

            updateRequestParams(requestContext, match.params);

            await runMiddlewareChain(match.descriptor.metadata.moduleMiddleware ?? [], {
              request: requestContext.request,
              requestContext,
              response,
            }, async () => {
              await dispatchMatchedHandler(match.descriptor, requestContext);
            });
          });
        } catch (error) {
          await writeErrorResponse(error, response, requestContext.requestId);
        }
      });
    },
  };
}
