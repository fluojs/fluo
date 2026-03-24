import { Inject, InvariantError } from '@konekti/core';
import {
  APPLICATION_LOGGER,
  COMPILED_MODULES,
  RUNTIME_CONTAINER,
  type OnApplicationBootstrap,
} from '@konekti/runtime';

import { CommandHandlerNotFoundException, DuplicateCommandHandlerError } from './errors.js';
import { getCommandHandlerMetadata } from './metadata.js';
import { CqrsBusBase, createDuplicateHandlerMessage } from './discovery.js';
import type {
  CommandBus,
  CommandHandlerDescriptor,
  CommandType,
  ICommand,
  ICommandHandler,
} from './types.js';

function isCommandHandler(value: unknown): value is ICommandHandler<ICommand, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as { execute?: unknown }).execute === 'function';
}

@Inject([RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER])
export class CommandBusLifecycleService extends CqrsBusBase implements CommandBus, OnApplicationBootstrap {
  private descriptors = new Map<CommandType, CommandHandlerDescriptor>();
  private discoveryPromise: Promise<void> | undefined;
  private discovered = false;

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureDiscovered();
  }

  async execute<TCommand extends ICommand, TResult = void>(command: TCommand): Promise<TResult> {
    await this.ensureDiscovered();

    const commandType = command.constructor as CommandType<TCommand>;
    const descriptor = this.descriptors.get(commandType);

    if (!descriptor) {
      throw new CommandHandlerNotFoundException(`No command handler registered for ${commandType.name}.`);
    }

    const instance = await this.resolveHandlerInstance(descriptor.token);

    if (!isCommandHandler(instance)) {
      throw new InvariantError(`Command handler ${descriptor.targetType.name} must implement execute(command).`);
    }

    return await instance.execute(command) as TResult;
  }

  private async ensureDiscovered(): Promise<void> {
    if (this.discovered) {
      return;
    }

    if (this.discoveryPromise) {
      await this.discoveryPromise;
      return;
    }

    this.discoveryPromise = this.discoverHandlers();
    await this.discoveryPromise;
  }

  private async discoverHandlers(): Promise<void> {
    try {
      this.descriptors = this.discoverCommandDescriptors();
      this.handlerInstances.clear();

      for (const descriptor of this.descriptors.values()) {
        await this.preloadHandlerInstance(descriptor.token);
      }

      this.discovered = true;
    } finally {
      this.discoveryPromise = undefined;
    }
  }

  private discoverCommandDescriptors(): Map<CommandType, CommandHandlerDescriptor> {
    const descriptors = new Map<CommandType, CommandHandlerDescriptor>();
    const seenByTarget = new WeakMap<Function, Set<CommandType>>();

    for (const candidate of this.discoveryCandidates()) {
      const metadata = getCommandHandlerMetadata(candidate.targetType);

      if (!metadata) {
        continue;
      }

      if (candidate.scope !== 'singleton') {
        this.logger.warn(
          `${candidate.targetType.name} in module ${candidate.moduleName} declares @CommandHandler() but is registered with ${candidate.scope} scope. Command handlers are registered only for singleton providers.`,
          'CommandBusLifecycleService',
        );
        continue;
      }

      const seenCommandTypes = seenByTarget.get(candidate.targetType) ?? new Set<CommandType>();

      if (seenCommandTypes.has(metadata.commandType)) {
        continue;
      }

      seenCommandTypes.add(metadata.commandType);
      seenByTarget.set(candidate.targetType, seenCommandTypes);

      const existing = descriptors.get(metadata.commandType);

      if (existing && existing.targetType !== candidate.targetType) {
        throw new DuplicateCommandHandlerError(
          createDuplicateHandlerMessage('command', metadata.commandType, existing, {
            moduleName: candidate.moduleName,
            targetType: candidate.targetType,
          }),
        );
      }

      if (!existing) {
        descriptors.set(metadata.commandType, {
          commandType: metadata.commandType,
          moduleName: candidate.moduleName,
          targetType: candidate.targetType,
          token: candidate.token,
        });
      }
    }

    return descriptors;
  }
}
