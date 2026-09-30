import { InvariantError, type Token } from '@fluojs/core';
import type { RequestScopeContainer } from '@fluojs/di';

import { DefaultBinder } from '../adapters/binding.js';
import { getCompiledDtoBindingPlan } from '../adapters/dto-binding-plan.js';
import { HttpDtoValidationAdapter } from '../adapters/dto-validation-adapter.js';
import { HTTP_FORM_VALIDATION } from '../form-representation.js';
import type { ArgumentResolverContext, Binder, HandlerDescriptor, RequestContext } from '../types.js';

const defaultBinder = new DefaultBinder();
const defaultValidator = new HttpDtoValidationAdapter();

/**
 * Invoke controller handler.
 *
 * @param handler The handler.
 * @param requestContext The request context.
 * @param binder The binder.
 * @param controllerContainer Container used for resolving the controller instance before handler invocation.
 * @returns The invoke controller handler result.
 */
export async function invokeControllerHandler(
  handler: HandlerDescriptor,
  requestContext: RequestContext,
  binder: Binder = defaultBinder,
  controllerContainer: RequestScopeContainer = requestContext.container,
): Promise<unknown> {
  const controller = await controllerContainer.resolve(handler.controllerToken as Token<object>);
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
  const requestDto = handler.route.request;
  const input = requestDto
    ? await binder.bind(requestDto, argumentResolverContext)
    : undefined;

  if (requestDto && getCompiledDtoBindingPlan(requestDto).needsValidation) {
    try {
      await defaultValidator.validate(input, requestDto);
    } catch (error) {
      requestContext.metadata[HTTP_FORM_VALIDATION] = error;
      throw error;
    }
  }

  return method.call(controller, input, requestContext);
}
