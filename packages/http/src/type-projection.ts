import type { Constructor, MetadataPropertyKey, MetadataSource } from '@fluojs/core';

import { getCompiledDtoBindingPlan } from './adapters/dto-binding-plan.js';
import type { HandlerDescriptor } from './types.js';

declare const httpWireInput: unique symbol;

/**
 * Type-only converter input declaration, preserving the server property's type.
 *
 * @remarks
 * Annotate a converted DTO property with `HttpWire<number, string>` when HTTP
 * receives text but its field or global converter produces a number. This
 * declaration has no runtime marker, converter, validation or default behavior.
 */
export type HttpWire<Server, Wire> = Server & { readonly [httpWireInput]?: Wire };

/** One authoritative HTTP binding projected for compiler tooling. */
export type HttpTypeProjectionField = {
  readonly converted: boolean;
  readonly optional: boolean;
  readonly property: MetadataPropertyKey;
  readonly source: MetadataSource;
  readonly wire: string;
};

/** Compiler-tooling view retaining real constructor identities and binder metadata. */
export type HttpTypeProjection = {
  readonly controller: Constructor;
  readonly input?: Constructor;
  readonly fields: readonly HttpTypeProjectionField[];
};

/**
 * Project the compiled route's actual DTO bindings without evaluating application input.
 *
 * @param descriptor HTTP-owned compiled descriptor from the current application.
 * @returns Frozen source aliases and materialization metadata with original object identities.
 * @internal
 */
export function createHttpTypeProjection(descriptor: HandlerDescriptor): HttpTypeProjection {
  const input = descriptor.route.request;
  return Object.freeze({
    controller: descriptor.controllerToken,
    ...(input === undefined ? {} : { input }),
    fields: Object.freeze(input === undefined ? [] : getCompiledDtoBindingPlan(input).entries.map((entry) =>
      Object.freeze({
        converted: entry.converter !== undefined,
        optional: entry.optional,
        property: entry.propertyKey,
        source: entry.source,
        wire: entry.sourceKey,
      }))),
  });
}
