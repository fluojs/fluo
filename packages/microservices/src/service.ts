import { Inject, fallbackClone, getClassDiMetadata, type MetadataPropertyKey, type Token } from '@konekti/core';
import type { Container, Provider } from '@konekti/di';
import {
  APPLICATION_LOGGER,
  COMPILED_MODULES,
  RUNTIME_CONTAINER,
  type ApplicationLogger,
  type CompiledModule,
  type MicroserviceRuntime,
  type OnApplicationShutdown,
} from '@konekti/runtime';

import { getHandlerMetadataEntries } from './metadata.js';
import { MICROSERVICE_OPTIONS } from './tokens.js';
import type {
  HandlerDescriptor,
  HandlerKind,
  Microservice,
  MicroserviceModuleOptions,
  Pattern,
  ServerStreamWriter,
  TransportPacket,
} from './types.js';

interface DiscoveryCandidate {
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
}

function clonePayload<T>(payload: T): T {
  try {
    return structuredClone(payload);
  } catch {
    return fallbackClone(payload) as T;
  }
}

function methodKeyToName(methodKey: MetadataPropertyKey): string {
  return typeof methodKey === 'symbol' ? methodKey.toString() : methodKey;
}

function scopeFromProvider(provider: Provider): 'request' | 'singleton' | 'transient' {
  if (typeof provider === 'function') {
    return getClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
  }

  return 'scope' in provider ? provider.scope ?? 'singleton' : 'singleton';
}

function isClassProvider(provider: Provider): provider is Extract<Provider, { provide: Token; useClass: Function }> {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}

@Inject([RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER, MICROSERVICE_OPTIONS])
export class MicroserviceLifecycleService implements Microservice, MicroserviceRuntime, OnApplicationShutdown {
  private readonly descriptors: HandlerDescriptor[] = [];
  private readonly handlerInstances = new Map<Token, Promise<unknown>>();
  private listening = false;
  private listenPromise: Promise<void> | undefined;

  constructor(
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
    private readonly moduleOptions: MicroserviceModuleOptions,
  ) {}

  async listen(): Promise<void> {
    if (this.listening) {
      return;
    }

    if (this.listenPromise) {
      await this.listenPromise;
      return;
    }

    this.listenPromise = (async () => {
      this.descriptors.length = 0;
      this.descriptors.push(...this.discoverHandlerDescriptors());

      const transport = this.moduleOptions.transport;

      if (transport.listenServerStreaming) {
        transport.listenServerStreaming(
          async (pattern: string, payload: unknown, writer: ServerStreamWriter) => {
            await this.dispatchServerStream(pattern, clonePayload(payload), writer);
          },
        );
      }

      await transport.listen(async (packet) => this.dispatchPacket(packet));
      this.listening = true;
    })();

    try {
      await this.listenPromise;
    } finally {
      this.listenPromise = undefined;
    }
  }

  async close(): Promise<void> {
    if (this.listenPromise) {
      await this.listenPromise;
    }

    await this.moduleOptions.transport.close();
    this.listening = false;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  async send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.moduleOptions.transport.send(pattern, clonePayload(payload), signal);
  }

  async emit(pattern: string, payload: unknown): Promise<void> {
    await this.moduleOptions.transport.emit(pattern, clonePayload(payload));
  }

  serverStream(pattern: string, payload: unknown, signal?: AbortSignal): AsyncIterable<unknown> {
    const transport = this.moduleOptions.transport;

    if (!transport.serverStream) {
      throw new Error('The configured transport does not support server streaming. Use a transport that implements serverStream().');
    }

    return transport.serverStream(pattern, clonePayload(payload), signal);
  }

  private async dispatchPacket(packet: TransportPacket): Promise<unknown> {
    const matches = this.descriptors.filter((descriptor) =>
      descriptor.kind === packet.kind && this.matchesPattern(descriptor.pattern, packet.pattern));

    if (packet.kind === 'message') {
      if (matches.length > 1) {
        throw new Error(
          `Multiple message handlers matched pattern "${packet.pattern}": ${matches
            .map((descriptor) => `${descriptor.targetName}.${descriptor.methodName}`)
            .join(', ')}.`,
        );
      }

      const first = matches[0];

      if (!first) {
        throw new Error(`No message handler registered for pattern "${packet.pattern}".`);
      }

      return await this.invokeHandler(first, clonePayload(packet.payload));
    }

    return await this.dispatchEventHandlers(matches, clonePayload(packet.payload));
  }

  private async dispatchServerStream(pattern: string, payload: unknown, writer: ServerStreamWriter): Promise<void> {
    const matches = this.descriptors.filter((descriptor) =>
      descriptor.kind === 'server-stream' && this.matchesPattern(descriptor.pattern, pattern));

    if (matches.length > 1) {
      const errorMsg = `Multiple server-stream handlers matched pattern "${pattern}": ${matches
        .map((descriptor) => `${descriptor.targetName}.${descriptor.methodName}`)
        .join(', ')}.`;
      writer.error(new Error(errorMsg));
      return;
    }

    const first = matches[0];

    if (!first) {
      writer.error(new Error(`No server-stream handler registered for pattern "${pattern}".`));
      return;
    }

    try {
      await this.invokeServerStreamHandler(first, payload, writer);
    } catch (error) {
      this.logger.error(
        `Server-stream handler ${first.targetName}.${first.methodName} failed.`,
        error,
        'MicroserviceLifecycleService',
      );
      writer.error(error instanceof Error ? error : new Error('Server-stream handler failed.'));
    }
  }

  private async invokeServerStreamHandler(
    descriptor: HandlerDescriptor,
    payload: unknown,
    writer: ServerStreamWriter,
  ): Promise<void> {
    if (descriptor.scope === 'singleton') {
      return await this.invokeResolvedServerStreamHandler(
        await this.resolveSingletonHandlerInstance(descriptor),
        descriptor,
        payload,
        writer,
      );
    }

    const streamScope = this.runtimeContainer.createRequestScope();

    try {
      const instance = await streamScope.resolve(descriptor.token);

      await this.invokeResolvedServerStreamHandler(instance, descriptor, payload, writer);
    } finally {
      try {
        await streamScope.dispose();
      } catch (error) {
        this.logger.error(
          `Failed to dispose microservice server-stream scope for ${descriptor.targetName}.${descriptor.methodName}.`,
          error,
          'MicroserviceLifecycleService',
        );
      }
    }
  }

  private async invokeResolvedServerStreamHandler(
    instance: unknown | undefined,
    descriptor: HandlerDescriptor,
    payload: unknown,
    writer: ServerStreamWriter,
  ): Promise<void> {
    if (!instance) {
      throw new Error(
        `Failed to resolve microservice target ${descriptor.targetName} from module ${descriptor.moduleName}.`,
      );
    }

    const value = (instance as Record<MetadataPropertyKey, unknown>)[descriptor.methodKey];

    if (typeof value !== 'function') {
      throw new Error(
        `Microservice handler ${descriptor.targetName}.${descriptor.methodName} must be a callable function.`,
      );
    }

    await Promise.resolve((value as (input: unknown, w: ServerStreamWriter) => unknown).call(instance, payload, writer));
  }

  private async dispatchEventHandlers(descriptors: HandlerDescriptor[], payload: unknown): Promise<undefined> {
    const singletonDescriptors = descriptors.filter((descriptor) => descriptor.scope === 'singleton');
    const scopedDescriptors = descriptors.filter((descriptor) => descriptor.scope !== 'singleton');

    const singletonResults = await Promise.allSettled(
      singletonDescriptors.map((descriptor) => this.invokeHandler(descriptor, clonePayload(payload))),
    );

    for (const result of singletonResults) {
      if (result.status === 'rejected') {
        this.logger.error(
          'Event handler failed during singleton dispatch.',
          result.reason,
          'MicroserviceLifecycleService',
        );
      }
    }

    if (scopedDescriptors.length === 0) {
      return undefined;
    }

    const perEventScope = this.runtimeContainer.createRequestScope();
    const scopeErrors: Error[] = [];

    try {
      const scopedResults = await Promise.allSettled(
        scopedDescriptors.map((descriptor) =>
          this.invokeResolvedHandlerInScope(perEventScope, descriptor, clonePayload(payload)),
        ),
      );

      for (const result of scopedResults) {
        if (result.status === 'rejected') {
          scopeErrors.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
        }
      }
    } finally {
      try {
        await perEventScope.dispose();
      } catch (disposeError) {
        this.logger.error(
          'Failed to dispose per-event scope.',
          disposeError,
          'MicroserviceLifecycleService',
        );
      }
    }

    if (scopeErrors.length > 0) {
      for (const error of scopeErrors) {
        this.logger.error(
          'Scoped event handler failed.',
          error,
          'MicroserviceLifecycleService',
        );
      }
    }

    return undefined;
  }

  private async invokeResolvedHandlerInScope(scope: Container, descriptor: HandlerDescriptor, payload: unknown): Promise<unknown> {
    const instance = await scope.resolve(descriptor.token);
    return await this.invokeResolvedHandler(instance, descriptor, payload);
  }

  private matchesPattern(pattern: Pattern, input: string): boolean {
    if (pattern instanceof RegExp) {
      pattern.lastIndex = 0;
      return pattern.test(input);
    }

    return pattern === input;
  }

  private discoverHandlerDescriptors(): HandlerDescriptor[] {
    const seen = new WeakMap<Function, Map<MetadataPropertyKey, Set<string>>>();
    const descriptors: HandlerDescriptor[] = [];

    for (const candidate of this.discoveryCandidates()) {
      const entries = getHandlerMetadataEntries(candidate.targetType.prototype);

      for (const entry of entries) {
        const dedupeKey = this.dedupeKey(entry.metadata.kind, entry.metadata.pattern);

        if (this.isDuplicate(seen, candidate.targetType, entry.propertyKey, dedupeKey)) {
          this.logger.warn(
            `Duplicate microservice handler registration for ${dedupeKey} on ${candidate.targetType.name}.${methodKeyToName(entry.propertyKey)} was ignored.`,
            'MicroserviceLifecycleService',
          );
          continue;
        }

        descriptors.push({
          kind: entry.metadata.kind,
          methodKey: entry.propertyKey,
          methodName: methodKeyToName(entry.propertyKey),
          moduleName: candidate.moduleName,
          pattern: entry.metadata.pattern,
          scope: candidate.scope,
          targetName: candidate.targetType.name,
          token: candidate.token,
        });
      }
    }

    return descriptors;
  }

  private dedupeKey(kind: HandlerKind, pattern: Pattern): string {
    if (pattern instanceof RegExp) {
      return `${kind}:/${pattern.source}/${pattern.flags}`;
    }

    return `${kind}:${pattern}`;
  }

  private isDuplicate(
    seen: WeakMap<Function, Map<MetadataPropertyKey, Set<string>>>,
    targetType: Function,
    methodKey: MetadataPropertyKey,
    dedupeKey: string,
  ): boolean {
    let methodsByKey = seen.get(targetType);

    if (!methodsByKey) {
      methodsByKey = new Map<MetadataPropertyKey, Set<string>>();
      seen.set(targetType, methodsByKey);
    }

    let seenPatterns = methodsByKey.get(methodKey);

    if (!seenPatterns) {
      seenPatterns = new Set<string>();
      methodsByKey.set(methodKey, seenPatterns);
    }

    if (seenPatterns.has(dedupeKey)) {
      return true;
    }

    seenPatterns.add(dedupeKey);
    return false;
  }

  private discoveryCandidates(): DiscoveryCandidate[] {
    const candidates: DiscoveryCandidate[] = [];

    for (const compiledModule of this.compiledModules) {
      for (const provider of compiledModule.definition.providers ?? []) {
        if (typeof provider === 'function') {
          candidates.push({
            moduleName: compiledModule.type.name,
            scope: scopeFromProvider(provider),
            targetType: provider,
            token: provider,
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

  private async invokeHandler(descriptor: HandlerDescriptor, payload: unknown): Promise<unknown> {
    if (descriptor.scope === 'singleton') {
      return await this.invokeResolvedHandler(await this.resolveSingletonHandlerInstance(descriptor), descriptor, payload);
    }

    const messageScope = this.runtimeContainer.createRequestScope();

    try {
      const instance = await messageScope.resolve(descriptor.token);
      return await this.invokeResolvedHandler(instance, descriptor, payload);
    } finally {
      try {
        await messageScope.dispose();
      } catch (error) {
        this.logger.error(
          `Failed to dispose microservice request scope for ${descriptor.targetName}.${descriptor.methodName}.`,
          error,
          'MicroserviceLifecycleService',
        );
      }
    }
  }

  private async invokeResolvedHandler(instance: unknown | undefined, descriptor: HandlerDescriptor, payload: unknown): Promise<unknown> {
    if (!instance) {
      throw new Error(
        `Failed to resolve microservice target ${descriptor.targetName} from module ${descriptor.moduleName}.`,
      );
    }

    const value = (instance as Record<MetadataPropertyKey, unknown>)[descriptor.methodKey];

    if (typeof value !== 'function') {
      throw new Error(
        `Microservice handler ${descriptor.targetName}.${descriptor.methodName} must be a callable function.`,
      );
    }

    try {
      return await Promise.resolve((value as (input: unknown) => unknown).call(instance, payload));
    } catch (error) {
      this.logger.error(
        `Microservice handler ${descriptor.targetName}.${descriptor.methodName} failed.`,
        error,
        'MicroserviceLifecycleService',
      );
      throw error;
    }
  }

  private async resolveSingletonHandlerInstance(descriptor: HandlerDescriptor): Promise<unknown | undefined> {
    const cached = this.handlerInstances.get(descriptor.token);

    if (cached) {
      return await cached;
    }

    const resolving = this.runtimeContainer.resolve(descriptor.token);
    this.handlerInstances.set(descriptor.token, resolving);

    try {
      return await resolving;
    } catch (error) {
      this.handlerInstances.delete(descriptor.token);
      this.logger.error(
        `Failed to resolve microservice target ${descriptor.targetName} from module ${descriptor.moduleName}.`,
        error,
        'MicroserviceLifecycleService',
      );
      throw error;
    }
  }
}
