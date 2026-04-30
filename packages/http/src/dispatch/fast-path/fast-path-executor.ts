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

export async function executeFastPath(
  options: ExecuteFastPathOptions,
): Promise<FastPathExecutionResult> {
  const { binder, contentNegotiation, controllerContainer, handler, request, requestContext, response } = options;

  try {
    const controller = options.controller ?? await controllerContainer.resolve(handler.controllerToken as Token<object>);
    const method = options.method ?? (controller as Record<string, unknown>)[handler.methodName];

    if (typeof method !== 'function') {
      return {
        error: new Error(
          `Controller ${handler.controllerToken.name} does not expose handler method ${handler.methodName}.`,
        ),
        executed: false,
      };
    }

    const requestDto = handler.route.request;
    let input: unknown;

    if (requestDto) {
      const bindingPlan = getCompiledDtoBindingPlan(requestDto);
      const activeBinder = binder ?? defaultBinder;

      input = await activeBinder.bind(requestDto, {
        handler,
        requestContext,
      });

      if (bindingPlan.needsValidation) {
        await defaultValidator.validate(input, requestDto);
      }
    }

    const maybeResult = method.call(controller, input, requestContext);
    const result = isThenable(maybeResult) ? await maybeResult : maybeResult;

    if (isRequestAborted(request)) {
      throw new RequestAbortedError();
    }

    if (!(result instanceof SseResponse) && !response.committed) {
      const writeResult = writeSuccessResponse(handler, request, response, result, contentNegotiation);

      if (isThenable(writeResult)) {
        await writeResult;
      }
    }

    return { executed: true, result };
  } catch (error) {
    return { error, executed: false };
  }
}

function isThenable<T>(value: T | Thenable<T>): value is Thenable<T> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function';
}

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
