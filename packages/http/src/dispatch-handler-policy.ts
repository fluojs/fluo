import { InvariantError, type Token } from '@konekti/core';

import { DefaultBinder } from './binding.js';
import { HttpDtoValidationAdapter } from './dto-validation-adapter.js';
import type { ArgumentResolverContext, Binder, HandlerDescriptor, RequestContext } from './types.js';

const defaultBinder = new DefaultBinder();
const defaultValidator = new HttpDtoValidationAdapter();

export async function invokeControllerHandler(
  handler: HandlerDescriptor,
  requestContext: RequestContext,
  binder: Binder = defaultBinder,
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
    ? await binder.bind(handler.route.request, argumentResolverContext)
    : undefined;

  if (handler.route.request) {
    await defaultValidator.validate(input, handler.route.request);
  }

  return method.call(controller, input, requestContext);
}
