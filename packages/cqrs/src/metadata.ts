import { metadataSymbol, type MetadataPropertyKey } from '@konekti/core';

import type {
  CommandHandlerMetadata,
  CommandType,
  CqrsEventType,
  EventHandlerMetadata,
  QueryHandlerMetadata,
  QueryType,
} from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;

const commandHandlerMetadataStore = new WeakMap<Function, CommandHandlerMetadata>();
const queryHandlerMetadataStore = new WeakMap<Function, QueryHandlerMetadata>();
const eventHandlerMetadataStore = new WeakMap<Function, EventHandlerMetadata>();

const standardCommandHandlerMetadataKey = Symbol.for('konekti.cqrs.standard.command-handler');
const standardQueryHandlerMetadataKey = Symbol.for('konekti.cqrs.standard.query-handler');
const standardEventHandlerMetadataKey = Symbol.for('konekti.cqrs.standard.event-handler');

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

export function defineCommandHandlerMetadata(target: Function, metadata: CommandHandlerMetadata): void {
  commandHandlerMetadataStore.set(target, cloneCommandHandlerMetadata(metadata));
}

export function getCommandHandlerMetadata(target: Function): CommandHandlerMetadata | undefined {
  const stored = commandHandlerMetadataStore.get(target);
  const standard = getStandardCommandHandlerMetadata(target);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneCommandHandlerMetadata(stored ?? standard!);
}

export function defineQueryHandlerMetadata(target: Function, metadata: QueryHandlerMetadata): void {
  queryHandlerMetadataStore.set(target, cloneQueryHandlerMetadata(metadata));
}

export function getQueryHandlerMetadata(target: Function): QueryHandlerMetadata | undefined {
  const stored = queryHandlerMetadataStore.get(target);
  const standard = getStandardQueryHandlerMetadata(target);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneQueryHandlerMetadata(stored ?? standard!);
}

export function defineEventHandlerMetadata(target: Function, metadata: EventHandlerMetadata): void {
  eventHandlerMetadataStore.set(target, cloneEventHandlerMetadata(metadata));
}

export function getEventHandlerMetadata(target: Function): EventHandlerMetadata | undefined {
  const stored = eventHandlerMetadataStore.get(target);
  const standard = getStandardEventHandlerMetadata(target);

  if (!stored && !standard) {
    return undefined;
  }

  return cloneEventHandlerMetadata(stored ?? standard!);
}

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

export const commandHandlerMetadataSymbol = standardCommandHandlerMetadataKey;
export const queryHandlerMetadataSymbol = standardQueryHandlerMetadataKey;
export const eventHandlerMetadataSymbol = standardEventHandlerMetadataKey;
