import type { Constructor, MetadataPropertyKey } from '@fluojs/core';
import {
  ensureRequestPipelineMetadataSymbol,
  getRequestPipelineMetadataBag,
} from '@fluojs/core/request-pipeline';

import type { HandlerDescriptor } from './types.js';

const dtoPolicyKey = Symbol.for('fluo.http.input-policy');
const routePolicyKey = Symbol.for('fluo.http.route-input-policy');

ensureRequestPipelineMetadataSymbol();

/**
 * Opt-in policies for the top-level body consumed by HTTP input binding.
 *
 * Omission preserves unknown-field rejection and non-object rejection.
 * Null and absent bodies retain the existing missing-field behavior.
 */
export interface InputPolicyOptions {
  readonly unknownFields?: 'reject' | 'strip';
  readonly nonObjects?: 'reject' | 'empty';
}

type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;
type LegacyClassDecoratorFn = (target: Function) => void;
type LegacyMethodDecoratorFn = (target: object, propertyKey: MetadataPropertyKey, descriptor?: PropertyDescriptor) => void;
type InputPolicyDecorator = StandardClassDecoratorFn & StandardMethodDecoratorFn & LegacyClassDecoratorFn & LegacyMethodDecoratorFn;

type PolicyMap = ReadonlyMap<MetadataPropertyKey, Readonly<InputPolicyOptions>>;
type PolicyOwner = {
  [dtoPolicyKey]?: Readonly<InputPolicyOptions>;
  [routePolicyKey]?: PolicyMap;
};

/**
 * Declare body input policies on a DTO class or HTTP route method.
 *
 * @param options Policies to merge with inherited DTO or existing route policies.
 * @returns A standard or legacy class/method decorator; explicit route fields override DTO fields.
 * @throws TypeError When a JavaScript caller supplies an unsupported policy value.
 * @remarks Projection never assigns to RequestContext.request.body. This decorator does
 * not change parser, guard, interceptor, converter, or validation execution order.
 */
export function InputPolicy(options: InputPolicyOptions): InputPolicyDecorator {
  if (
    (options.unknownFields !== undefined && options.unknownFields !== 'reject' && options.unknownFields !== 'strip')
    || (options.nonObjects !== undefined && options.nonObjects !== 'reject' && options.nonObjects !== 'empty')
  ) {
    throw new TypeError('Unsupported HTTP input policy.');
  }
  const snapshot: InputPolicyOptions = {
    ...(options.unknownFields === undefined ? {} : { unknownFields: options.unknownFields }),
    ...(options.nonObjects === undefined ? {} : { nonObjects: options.nonObjects }),
  };

  return (
    value: Function | object,
    context?: ClassDecoratorContext | ClassMethodDecoratorContext | MetadataPropertyKey,
    _descriptor?: PropertyDescriptor,
  ): void => {
    if (typeof context === 'string' || typeof context === 'symbol') {
      const owner = value as PolicyOwner;
      const map = new Map(owner[routePolicyKey]);
      map.set(context, Object.freeze({ ...map.get(context), ...snapshot }));
      Object.defineProperty(owner, routePolicyKey, { configurable: true, value: map });
      return;
    }
    if (context?.kind === 'method') {
      const bag = context.metadata as Record<PropertyKey, unknown>;
      const map = new Map(bag[routePolicyKey] as PolicyMap | undefined);
      map.set(context.name, Object.freeze({ ...map.get(context.name), ...snapshot }));
      bag[routePolicyKey] = map;
      return;
    }
    const owner = value as PolicyOwner;
    Object.defineProperty(owner, dtoPolicyKey, {
      configurable: true,
      value: Object.freeze({ ...owner[dtoPolicyKey], ...snapshot }),
    });
  };
}

/**
 * Resolve DTO and route input policy records for one binding invocation.
 *
 * @param dto DTO constructor selected by the existing RequestDto metadata.
 * @param handler Matched handler whose explicit policy fields take precedence.
 * @returns The merged policy without mutating either metadata record.
 * @internal
 */
export function getInputPolicy(dto: Constructor, handler: HandlerDescriptor): InputPolicyOptions {
  const standard = getRequestPipelineMetadataBag(handler.controllerToken)?.[routePolicyKey] as PolicyMap | undefined;
  const legacy = (handler.controllerToken.prototype as PolicyOwner)[routePolicyKey];
  return {
    ...(dto as PolicyOwner)[dtoPolicyKey],
    ...(standard?.get(handler.methodName) ?? legacy?.get(handler.methodName)),
  };
}
