import { Inject, getClassDiMetadata, type MetadataPropertyKey, type Token } from '@konekti/core';
import type { Container, Provider } from '@konekti/di';
import {
  APPLICATION_LOGGER,
  COMPILED_MODULES,
  RUNTIME_CONTAINER,
  type ApplicationLogger,
  type CompiledModule,
  type OnApplicationBootstrap,
} from '@konekti/runtime';

import { getEventHandlerMetadataEntries } from './metadata.js';
import type { EventBus, EventHandlerDescriptor, EventType } from './types.js';

interface DiscoveryCandidate {
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
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

function methodKeyToName(methodKey: MetadataPropertyKey): string {
  return typeof methodKey === 'symbol' ? methodKey.toString() : methodKey;
}

function isClassProvider(provider: Provider): provider is Extract<Provider, { provide: Token; useClass: Function }> {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}

@Inject([RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER])
export class EventBusLifecycleService implements EventBus, OnApplicationBootstrap {
  private descriptors: EventHandlerDescriptor[] = [];
  private discovered = false;

  constructor(
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.discoverHandlers();
  }

  async publish(event: object): Promise<void> {
    this.ensureDiscovered();
    const matchingDescriptors = this.descriptors.filter((descriptor) => event instanceof descriptor.eventType);

    if (matchingDescriptors.length === 0) {
      return;
    }

    await Promise.allSettled(
      matchingDescriptors.map(async (descriptor) => {
        await this.invokeHandler(descriptor, event);
      }),
    );
  }

  private ensureDiscovered(): void {
    if (this.discovered) {
      return;
    }

    if (this.compiledModules.length === 0) {
      this.logger.warn(
        'EventBus.publish() was called before onApplicationBootstrap completed. Handlers may not yet be registered.',
        'EventBusLifecycleService',
      );
    }

    this.discoverHandlers();
  }

  private discoverHandlers(): void {
    this.descriptors = this.discoverHandlerDescriptors();
    this.discovered = true;
  }

  private discoverHandlerDescriptors(): EventHandlerDescriptor[] {
    const seen = new Set<string>();
    const descriptors: EventHandlerDescriptor[] = [];

    for (const candidate of this.discoveryCandidates()) {
      const entries = getEventHandlerMetadataEntries(candidate.targetType.prototype);

      if (candidate.scope !== 'singleton') {
        if (entries.length > 0) {
          this.logger.warn(
            `${candidate.targetType.name} in module ${candidate.moduleName} declares @OnEvent() methods but is registered with ${candidate.scope} scope. Event handlers are registered only for singleton providers.`,
            'EventBusLifecycleService',
          );
        }

        continue;
      }

      for (const entry of entries) {
        const methodName = methodKeyToName(entry.propertyKey);
        const eventType = entry.metadata.eventType;
        const dedupKey = `${candidate.targetType.name}::${methodName}::${String(eventType)}`;

        if (seen.has(dedupKey)) {
          continue;
        }

        seen.add(dedupKey);

        descriptors.push({
          eventType,
          methodKey: entry.propertyKey,
          methodName,
          moduleName: candidate.moduleName,
          targetName: candidate.targetType.name,
          token: candidate.token,
        });
      }
    }

    return descriptors;
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

  private async invokeHandler(descriptor: EventHandlerDescriptor, event: object): Promise<void> {
    let instance: unknown;

    try {
      instance = await this.runtimeContainer.resolve(descriptor.token);
    } catch (error) {
      this.logger.error(
        `Failed to resolve event handler target ${descriptor.targetName} from module ${descriptor.moduleName}.`,
        error,
        'EventBusLifecycleService',
      );
      return;
    }

    const value = (instance as Record<MetadataPropertyKey, unknown>)[descriptor.methodKey];

    if (typeof value !== 'function') {
      this.logger.warn(
        `Event handler ${descriptor.targetName}.${descriptor.methodName} is not callable and was skipped.`,
        'EventBusLifecycleService',
      );
      return;
    }

    try {
      await Promise.resolve((value as (this: unknown, event: object) => Promise<void>).call(instance, event));
    } catch (error) {
      this.logger.error(
        `Event handler ${descriptor.targetName}.${descriptor.methodName} failed.`,
        error,
        'EventBusLifecycleService',
      );
    }
  }
}
