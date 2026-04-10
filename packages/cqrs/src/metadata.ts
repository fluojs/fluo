import { type MetadataPropertyKey } from '@fluojs/core';
import { metadataSymbol } from '@fluojs/core/internal';

import type {
  CommandHandlerMetadata,
  CommandType,
  CqrsEventType,
  EventHandlerMetadata,
  QueryHandlerMetadata,
  QueryType,
  SagaMetadata,
} from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;

const commandHandlerMetadataStore = new WeakMap<Function, CommandHandlerMetadata>();
const queryHandlerMetadataStore = new WeakMap<Function, QueryHandlerMetadata>();
const eventHandlerMetadataStore = new WeakMap<Function, EventHandlerMetadata>();
const sagaMetadataStore = new WeakMap<Function, SagaMetadata>();

const standardCommandHandlerMetadataKey = Symbol.for('konekti.cqrs.standard.command-handler');
const standardQueryHandlerMetadataKey = Symbol.for('konekti.cqrs.standard.query-handler');
const standardEventHandlerMetadataKey = Symbol.for('konekti.cqrs.standard.event-handler');
const standardSagaMetadataKey = Symbol.for('konekti.cqrs.standard.saga');

function isObjectRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCommandType(value: unknown): value is CommandType {
  return typeof value === 'function';
}

function isQueryType(value: unknown): value is QueryType {
  return typeof value === 'function';
}

function isEventType(value: unknown): value is CqrsEventType {
  return typeof value === 'function';
}

function isEventTypeList(value: unknown): value is readonly CqrsEventType[] {
  return Array.isArray(value) && value.every((eventType) => isEventType(eventType));
}

function getStandardMetadataBag(target: Function): StandardMetadataBag | undefined {
  const metadata = (target as unknown as Record<symbol, unknown>)[metadataSymbol];
  return isObjectRecord(metadata) ? metadata : undefined;
}

function cloneCommandHandlerMetadata(metadata: CommandHandlerMetadata): CommandHandlerMetadata {
  return {
    commandType: metadata.commandType,
  };
}

function cloneQueryHandlerMetadata(metadata: QueryHandlerMetadata): QueryHandlerMetadata {
  return {
    queryType: metadata.queryType,
  };
}

function cloneEventHandlerMetadata(metadata: EventHandlerMetadata): EventHandlerMetadata {
  return {
    eventType: metadata.eventType,
  };
}

function cloneSagaMetadata(metadata: SagaMetadata): SagaMetadata {
  return {
    eventTypes: [...metadata.eventTypes],
  };
}

function getStandardCommandHandlerMetadata(target: Function): CommandHandlerMetadata | undefined {
  const raw = getStandardMetadataBag(target)?.[standardCommandHandlerMetadataKey];

  if (!isObjectRecord(raw) || !isCommandType(raw.commandType)) {
    return undefined;
  }

  return {
    commandType: raw.commandType,
  };
}

function getStandardQueryHandlerMetadata(target: Function): QueryHandlerMetadata | undefined {
  const raw = getStandardMetadataBag(target)?.[standardQueryHandlerMetadataKey];

  if (!isObjectRecord(raw) || !isQueryType(raw.queryType)) {
    return undefined;
  }

  return {
    queryType: raw.queryType,
  };
}

function getStandardEventHandlerMetadata(target: Function): EventHandlerMetadata | undefined {
  const raw = getStandardMetadataBag(target)?.[standardEventHandlerMetadataKey];

  if (!isObjectRecord(raw) || !isEventType(raw.eventType)) {
    return undefined;
  }

  return {
    eventType: raw.eventType,
  };
}

function getStandardSagaMetadata(target: Function): SagaMetadata | undefined {
  const raw = getStandardMetadataBag(target)?.[standardSagaMetadataKey];

  if (!isObjectRecord(raw) || !isEventTypeList(raw.eventTypes)) {
    return undefined;
  }

  return {
    eventTypes: [...raw.eventTypes],
  };
}

/**
 * Stores command-handler metadata on a class for compatibility with manual metadata registration.
 *
 * @param target Handler class constructor receiving the metadata.
 * @param metadata Command-handler metadata to store.
 */
export function defineCommandHandlerMetadata(target: Function, metadata: CommandHandlerMetadata): void {
  commandHandlerMetadataStore.set(target, cloneCommandHandlerMetadata(metadata));
}

/**
 * Reads command-handler metadata from either the compatibility store or standard decorator metadata.
 *
 * @param target Handler class constructor to inspect.
 * @returns The resolved command-handler metadata, if present.
 */
export function getCommandHandlerMetadata(target: Function): CommandHandlerMetadata | undefined {
  const stored = commandHandlerMetadataStore.get(target);
  const standard = getStandardCommandHandlerMetadata(target);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneCommandHandlerMetadata(stored ?? standard!);
}

/**
 * Stores query-handler metadata on a class for compatibility with manual metadata registration.
 *
 * @param target Handler class constructor receiving the metadata.
 * @param metadata Query-handler metadata to store.
 */
export function defineQueryHandlerMetadata(target: Function, metadata: QueryHandlerMetadata): void {
  queryHandlerMetadataStore.set(target, cloneQueryHandlerMetadata(metadata));
}

/**
 * Reads query-handler metadata from either the compatibility store or standard decorator metadata.
 *
 * @param target Handler class constructor to inspect.
 * @returns The resolved query-handler metadata, if present.
 */
export function getQueryHandlerMetadata(target: Function): QueryHandlerMetadata | undefined {
  const stored = queryHandlerMetadataStore.get(target);
  const standard = getStandardQueryHandlerMetadata(target);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneQueryHandlerMetadata(stored ?? standard!);
}

/**
 * Stores event-handler metadata on a class for compatibility with manual metadata registration.
 *
 * @param target Handler class constructor receiving the metadata.
 * @param metadata Event-handler metadata to store.
 */
export function defineEventHandlerMetadata(target: Function, metadata: EventHandlerMetadata): void {
  eventHandlerMetadataStore.set(target, cloneEventHandlerMetadata(metadata));
}

/**
 * Reads event-handler metadata from either the compatibility store or standard decorator metadata.
 *
 * @param target Handler class constructor to inspect.
 * @returns The resolved event-handler metadata, if present.
 */
export function getEventHandlerMetadata(target: Function): EventHandlerMetadata | undefined {
  const stored = eventHandlerMetadataStore.get(target);
  const standard = getStandardEventHandlerMetadata(target);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneEventHandlerMetadata(stored ?? standard!);
}

/**
 * Stores saga metadata on a class for compatibility with manual metadata registration.
 *
 * @param target Saga class constructor receiving the metadata.
 * @param metadata Saga metadata to store.
 */
export function defineSagaMetadata(target: Function, metadata: SagaMetadata): void {
  sagaMetadataStore.set(target, cloneSagaMetadata(metadata));
}

/**
 * Reads saga metadata from either the compatibility store or standard decorator metadata.
 *
 * @param target Saga class constructor to inspect.
 * @returns The resolved saga metadata, if present.
 */
export function getSagaMetadata(target: Function): SagaMetadata | undefined {
  const stored = sagaMetadataStore.get(target);
  const standard = getStandardSagaMetadata(target);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneSagaMetadata(stored ?? standard!);
}

/**
 * Returns the normalized command-handler metadata entry used by public-surface tests and tooling.
 *
 * @param target Handler instance or prototype whose constructor should be inspected.
 * @returns The command-handler metadata entry for the canonical `execute` method, if present.
 */
export function getCommandHandlerMetadataEntry(
  target: object,
): { metadata: CommandHandlerMetadata; propertyKey: MetadataPropertyKey } | undefined {
  const constructor = (target as { constructor?: Function }).constructor;

  if (!constructor) {
    return undefined;
  }

  const metadata = getCommandHandlerMetadata(constructor);

  if (!metadata) {
    return undefined;
  }

  return {
    metadata,
    propertyKey: 'execute',
  };
}

/**
 * Returns the normalized query-handler metadata entry used by public-surface tests and tooling.
 *
 * @param target Handler instance or prototype whose constructor should be inspected.
 * @returns The query-handler metadata entry for the canonical `execute` method, if present.
 */
export function getQueryHandlerMetadataEntry(
  target: object,
): { metadata: QueryHandlerMetadata; propertyKey: MetadataPropertyKey } | undefined {
  const constructor = (target as { constructor?: Function }).constructor;

  if (!constructor) {
    return undefined;
  }

  const metadata = getQueryHandlerMetadata(constructor);

  if (!metadata) {
    return undefined;
  }

  return {
    metadata,
    propertyKey: 'execute',
  };
}

/** Standard decorator metadata key used to store command-handler metadata. */
export const commandHandlerMetadataSymbol = standardCommandHandlerMetadataKey;
/** Standard decorator metadata key used to store query-handler metadata. */
export const queryHandlerMetadataSymbol = standardQueryHandlerMetadataKey;
/** Standard decorator metadata key used to store event-handler metadata. */
export const eventHandlerMetadataSymbol = standardEventHandlerMetadataKey;
/** Standard decorator metadata key used to store saga metadata. */
export const sagaMetadataSymbol = standardSagaMetadataKey;
