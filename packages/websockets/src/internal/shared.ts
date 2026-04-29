import type { MetadataPropertyKey, Token } from '@fluojs/core';
import { getClassDiMetadata } from '@fluojs/core/internal';
import type { Provider, Container } from '@fluojs/di';
import type { ApplicationLogger, CompiledModule } from '@fluojs/runtime';

import { getWebSocketGatewayMetadata, getWebSocketHandlerMetadataEntries } from '../metadata.js';
import type {
  WebSocketGatewayDescriptor,
  WebSocketGatewayHandlerDescriptor,
} from '../types.js';

const textDecoder = new TextDecoder();

/**
 * Describes the discovery candidate contract.
 */
export interface DiscoveryCandidate {
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
}

interface ClassProviderLike {
  provide: Token;
  scope?: 'request' | 'singleton' | 'transient';
  useClass: new (...args: unknown[]) => unknown;
}

/**
 * Describes the resolved gateway instance contract.
 */
export interface ResolvedGatewayInstance {
  descriptor: WebSocketGatewayDescriptor;
  instance: unknown;
}

/**
 * Defines the parsed web socket message type.
 */
export type ParsedWebSocketMessage = {
  event?: string;
  payload: unknown;
};

/**
 * Defines the shared web socket incoming message type.
 */
export type SharedWebSocketIncomingMessage =
  | ArrayBuffer
  | ArrayBufferView
  | Uint8Array[]
  | string;

/**
 * Is finite positive integer.
 *
 * @param value The value.
 * @returns The is finite positive integer result.
 */
export function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isInteger(value);
}

/**
 * Normalize gateway path.
 *
 * @param path The path.
 * @returns The normalize gateway path result.
 */
export function normalizeGatewayPath(path: string): string {
  if (path === '/') {
    return '/';
  }

  const normalized = `/${path.replace(/^\/+/, '').replace(/\/+$/, '')}`;

  return normalized === '' ? '/' : normalized;
}

/**
 * Parse incoming message.
 *
 * @param data The data.
 * @returns The parse incoming message result.
 */
export function parseIncomingMessage(data: SharedWebSocketIncomingMessage): ParsedWebSocketMessage {
  let text: string;

  if (typeof data === 'string') {
    text = data;
  } else if (data instanceof ArrayBuffer) {
    text = textDecoder.decode(data);
  } else if (Array.isArray(data)) {
    const totalLength = data.reduce((length, chunk) => length + chunk.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of data) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    text = textDecoder.decode(merged);
  } else {
    text = textDecoder.decode(data);
  }

  let parsed: unknown = text;

  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { payload: text };
  }

  if (typeof parsed === 'object' && parsed !== null && 'event' in parsed) {
    const event = (parsed as { event?: unknown }).event;

    if (typeof event === 'string') {
      return {
        event,
        payload: (parsed as { data?: unknown }).data,
      };
    }
  }

  return {
    payload: parsed,
  };
}

/**
 * Discover gateway descriptors.
 *
 * @param compiledModules The compiled modules.
 * @param logger The logger.
 * @param loggerContext The logger context.
 * @returns The discover gateway descriptors result.
 */
export function discoverGatewayDescriptors(
  compiledModules: readonly CompiledModule[],
  logger: ApplicationLogger,
  loggerContext: string,
): WebSocketGatewayDescriptor[] {
  const seenTargets = new Set<Function>();
  const descriptors: WebSocketGatewayDescriptor[] = [];

  for (const candidate of discoveryCandidates(compiledModules)) {
    const gatewayMetadata = getWebSocketGatewayMetadata(candidate.targetType);

    if (!gatewayMetadata) {
      continue;
    }

    if (candidate.scope !== 'singleton') {
      logger.warn(
        `${candidate.targetType.name} in module ${candidate.moduleName} declares @WebSocketGateway() but is registered with ${candidate.scope} scope. WebSocket gateways are registered only for singleton providers.`,
        loggerContext,
      );
      continue;
    }

    if (seenTargets.has(candidate.targetType)) {
      continue;
    }

    seenTargets.add(candidate.targetType);
    descriptors.push(createGatewayDescriptor(candidate, gatewayMetadata.path));
  }

  return descriptors;
}

/**
 * Resolve gateway instance.
 *
 * @param runtimeContainer The runtime container.
 * @param descriptor The descriptor.
 * @param logger The logger.
 * @param loggerContext The logger context.
 * @returns The resolve gateway instance result.
 */
export async function resolveGatewayInstance(
  runtimeContainer: Container,
  descriptor: WebSocketGatewayDescriptor,
  logger: ApplicationLogger,
  loggerContext: string,
): Promise<unknown | undefined> {
  try {
    return await runtimeContainer.resolve(descriptor.token);
  } catch (error) {
    logger.error(
      `Failed to resolve WebSocket gateway ${descriptor.targetName} from module ${descriptor.moduleName}.`,
      error,
      loggerContext,
    );
    return undefined;
  }
}

/**
 * Dispatch gateway message.
 *
 * @param resolved The resolved.
 * @param socket The socket.
 * @param request The request.
 * @param data The data.
 * @param logger The logger.
 * @param loggerContext The logger context.
 * @returns The dispatch gateway message result.
 */
export async function dispatchGatewayMessage<TSocket, TRequest>(
  resolved: readonly ResolvedGatewayInstance[],
  socket: TSocket,
  request: TRequest,
  data: SharedWebSocketIncomingMessage,
  logger: ApplicationLogger,
  loggerContext: string,
): Promise<void> {
  const parsed = parseIncomingMessage(data);

  for (const { descriptor, instance } of resolved) {
    const handlers = descriptor.handlers.filter(
      (handler) =>
        handler.type === 'message' &&
        (handler.event === undefined || handler.event === parsed.event),
    );

    for (const handler of handlers) {
      await invokeGatewayMethod(instance, descriptor, handler, [parsed.payload, socket, request], logger, loggerContext);
    }
  }
}

/**
 * Dispatch gateway disconnect.
 *
 * @param resolved The resolved.
 * @param socket The socket.
 * @param code The code.
 * @param reason The reason.
 * @param socketId The socket id.
 * @param logger The logger.
 * @param loggerContext The logger context.
 * @returns The dispatch gateway disconnect result.
 */
export async function dispatchGatewayDisconnect<TSocket>(
  resolved: readonly ResolvedGatewayInstance[],
  socket: TSocket,
  code: number,
  reason: string,
  socketId: string,
  logger: ApplicationLogger,
  loggerContext: string,
): Promise<void> {
  for (const { descriptor, instance } of resolved) {
    await runGatewayHandlers(instance, descriptor, 'disconnect', [socket, code, reason, socketId], logger, loggerContext);
  }
}

/**
 * Run gateway handlers.
 *
 * @param instance The instance.
 * @param descriptor The descriptor.
 * @param type The type.
 * @param args The args.
 * @param logger The logger.
 * @param loggerContext The logger context.
 * @returns The run gateway handlers result.
 */
export async function runGatewayHandlers(
  instance: unknown,
  descriptor: WebSocketGatewayDescriptor,
  type: WebSocketGatewayHandlerDescriptor['type'],
  args: unknown[],
  logger: ApplicationLogger,
  loggerContext: string,
): Promise<void> {
  const handlers = descriptor.handlers.filter((handler) => handler.type === type);

  for (const handler of handlers) {
    await invokeGatewayMethod(instance, descriptor, handler, args, logger, loggerContext);
  }
}

async function invokeGatewayMethod(
  instance: unknown,
  descriptor: WebSocketGatewayDescriptor,
  handler: WebSocketGatewayHandlerDescriptor,
  args: unknown[],
  logger: ApplicationLogger,
  loggerContext: string,
): Promise<void> {
  const value = (instance as Record<MetadataPropertyKey, unknown>)[handler.methodKey];

  if (typeof value !== 'function') {
    logger.warn(
      `WebSocket gateway handler ${descriptor.targetName}.${handler.methodName} is not callable and was skipped.`,
      loggerContext,
    );
    return;
  }

  try {
    await Promise.resolve((value as (this: unknown, ...handlerArgs: unknown[]) => unknown).call(instance, ...args));
  } catch (error) {
    logger.error(
      `WebSocket gateway handler ${descriptor.targetName}.${handler.methodName} failed.`,
      error,
      loggerContext,
    );
  }
}

function discoveryCandidates(compiledModules: readonly CompiledModule[]): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];

  for (const compiledModule of compiledModules) {
    for (const provider of compiledModule.definition.providers ?? []) {
      if (typeof provider === 'function') {
        candidates.push({
          moduleName: compiledModule.type.name,
          scope: scopeFromProvider(provider),
          targetType: provider,
          token: provider as Token,
        });
        continue;
      }

      if (isClassProvider(provider)) {
        candidates.push({
          moduleName: compiledModule.type.name,
          scope: scopeFromProvider(provider),
          targetType: provider.useClass,
          token: provider.provide,
        });
      }
    }

    for (const controller of compiledModule.definition.controllers ?? []) {
      candidates.push({
        moduleName: compiledModule.type.name,
        scope: scopeFromProvider(controller),
        targetType: controller,
        token: controller,
      });
    }
  }

  return candidates;
}

function createGatewayDescriptor(candidate: DiscoveryCandidate, path: string): WebSocketGatewayDescriptor {
  const gatewayMetadata = getWebSocketGatewayMetadata(candidate.targetType);

  if (!gatewayMetadata) {
    throw new Error(`Missing websocket gateway metadata for ${candidate.targetType.name}.`);
  }

  return {
    handlers: getWebSocketHandlerMetadataEntries(candidate.targetType.prototype).map((entry) => ({
      event: entry.metadata.event,
      methodKey: entry.propertyKey,
      methodName: methodKeyToName(entry.propertyKey),
      type: entry.metadata.type,
    })),
    moduleName: candidate.moduleName,
    path: normalizeGatewayPath(path),
    serverBacked: gatewayMetadata.serverBacked
      ? {
          port: gatewayMetadata.serverBacked.port,
        }
      : undefined,
    targetName: candidate.targetType.name,
    token: candidate.token,
  };
}

function scopeFromProvider(provider: Provider): 'request' | 'singleton' | 'transient' {
  if (typeof provider === 'function') {
    return getClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useClass' in provider) {
    const classProvider = provider as ClassProviderLike;
    return classProvider.scope ?? getClassDiMetadata(classProvider.useClass)?.scope ?? 'singleton';
  }

  return 'scope' in provider ? provider.scope ?? 'singleton' : 'singleton';
}

function methodKeyToName(methodKey: MetadataPropertyKey): string {
  return typeof methodKey === 'symbol' ? methodKey.toString() : methodKey;
}

function isClassProvider(provider: Provider): provider is ClassProviderLike {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}
