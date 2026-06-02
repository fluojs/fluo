import type { Token } from '@fluojs/core';
import type { RequestScopeContainer } from '@fluojs/di';

import { DefaultBinder } from '../../adapters/binding.js';
import { getCompiledDtoBindingPlan } from '../../adapters/dto-binding-plan.js';
import { HttpDtoValidationAdapter } from '../../adapters/dto-validation-adapter.js';
import { SseResponse } from '../../context/sse.js';
import { RequestAbortedError } from '../../errors.js';
import { type ResolvedContentNegotiation, writeSuccessResponse } from '../dispatch-response-policy.js';
import type {
  Binder,
  FrameworkRequest,
  FrameworkResponse,
  HandlerDescriptor,
  RequestContext,
} from '../../types.js';
import type { FastPathExecutionResult } from './eligibility-checker.js';

const defaultBinder = new DefaultBinder();
const defaultValidator = new HttpDtoValidationAdapter();

type Thenable<T> = {
  then(onFulfilled: (value: T) => unknown, onRejected?: (reason: unknown) => unknown): unknown;
};

interface ExecuteFastPathOptions {
  binder?: Binder;
  contentNegotiation?: ResolvedContentNegotiation;
  controllerContainer: RequestScopeContainer;
  controller?: object;
  handler: HandlerDescriptor;
  method?: (this: object, input: unknown, requestContext: RequestContext) => unknown;
  request: FrameworkRequest;
  requestContext: RequestContext;
  response: FrameworkResponse;
}

/**
 * Execute a handler through the compiled dispatcher fast path.
 *
 * @param options Controller, handler, request, response, and binding state for the route.
 * @returns The fast-path execution result, synchronously when the route does not need awaiting.
 */
export function executeFastPath(
  options: ExecuteFastPathOptions,
): FastPathExecutionResult | Promise<FastPathExecutionResult> {
  const { controllerContainer, handler } = options;

  try {
    const controllerOrPromise = options.controller ?? controllerContainer.resolve(handler.controllerToken as Token<object>);

    if (isThenable(controllerOrPromise)) {
      return resolveControllerFastPath(options, controllerOrPromise);
    }

    return executeResolvedFastPath(options, controllerOrPromise);
  } catch (error) {
    return { error, executed: false };
  }
}

function executeResolvedFastPath(
  options: ExecuteFastPathOptions,
  controller: object,
): FastPathExecutionResult | Promise<FastPathExecutionResult> {
  const { handler, requestContext } = options;

  try {
    const method = options.method ?? (controller as Record<string, unknown>)[handler.methodName];

    if (!isFastPathControllerMethod(method)) {
      return {
        error: new Error(
          `Controller ${handler.controllerToken.name} does not expose handler method ${handler.methodName}.`,
        ),
        executed: false,
      };
    }

    const requestDto = handler.route.request;

    if (requestDto) {
      return executeBoundFastPath(options, controller, method, requestDto);
    }

    const maybeResult = method.call(controller, undefined, requestContext);

    if (isThenable(maybeResult)) {
      return resolveAsyncFastPathResult(options, maybeResult);
    }

    return writeFastPathResult(options, maybeResult);
  } catch (error) {
    return { error, executed: false };
  }
}

async function resolveControllerFastPath(
  options: ExecuteFastPathOptions,
  controllerPromise: Thenable<object>,
): Promise<FastPathExecutionResult> {
  try {
    const controller = await controllerPromise;
    return await executeResolvedFastPath(options, controller);
  } catch (error) {
    return { error, executed: false };
  }
}

async function resolveAsyncFastPathResult(
  options: ExecuteFastPathOptions,
  resultPromise: Thenable<unknown>,
): Promise<FastPathExecutionResult> {
  try {
    const result = await resultPromise;
    return await writeFastPathResult(options, result);
  } catch (error) {
    return { error, executed: false };
  }
}

async function executeBoundFastPath(
  options: ExecuteFastPathOptions,
  controller: object,
  method: (this: object, input: unknown, requestContext: RequestContext) => unknown,
  requestDto: NonNullable<HandlerDescriptor['route']['request']>,
): Promise<FastPathExecutionResult> {
  const { binder, handler, requestContext } = options;

  try {
    const bindingPlan = getCompiledDtoBindingPlan(requestDto);
    const activeBinder = binder ?? defaultBinder;
    const input = await activeBinder.bind(requestDto, {
      handler,
      requestContext,
    });

    if (bindingPlan.needsValidation) {
      await defaultValidator.validate(input, requestDto);
    }

    const maybeResult = method.call(controller, input, requestContext);
    const result = isThenable(maybeResult) ? await maybeResult : maybeResult;
    return await writeFastPathResult(options, result);
  } catch (error) {
    return { error, executed: false };
  }
}

function writeFastPathResult(
  options: ExecuteFastPathOptions,
  result: unknown,
): FastPathExecutionResult | Promise<FastPathExecutionResult> {
  const { contentNegotiation, handler, request, response } = options;

  try {
    if (isRequestAborted(request)) {
      throw new RequestAbortedError();
    }

    if (result instanceof SseResponse || response.committed) {
      return { executed: true, result };
    }

    const writeResult = writeSuccessResponse(handler, request, response, result, contentNegotiation);

    if (isThenable(writeResult)) {
      return writeResult.then(
        () => ({ executed: true, result }),
        (error: unknown) => ({ error, executed: false }),
      );
    }

    return { executed: true, result };
  } catch (error) {
    return { error, executed: false };
  }
}

function isFastPathControllerMethod(
  value: unknown,
): value is (this: object, input: unknown, requestContext: RequestContext) => unknown {
  return typeof value === 'function';
}

function isThenable<T>(value: T | Thenable<T>): value is Thenable<T> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function';
}

/**
 * Decide whether a request can use the compiled fast-path branch.
 *
 * @param eligibility Compiled route eligibility for the matched handler.
 * @param request Framework request being dispatched.
 * @returns `true` when the route is fast-path eligible and the request is still active.
 */
export function shouldUseFastPathForRequest(
  eligibility: { executionPath: 'fast' | 'full' } | undefined,
  request: FrameworkRequest,
): boolean {
  if (!eligibility) {
    return false;
  }
  if (eligibility.executionPath !== 'fast') {
    return false;
  }
  if (isRequestAborted(request)) {
    return false;
  }
  return true;
}

function isRequestAborted(request: FrameworkRequest): boolean {
  return request.isAborted?.() ?? request.signal?.aborted === true;
}
