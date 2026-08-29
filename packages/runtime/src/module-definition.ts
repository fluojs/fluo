import { defineRuntimeModuleMetadata } from './internal/core-metadata.js';
import type { ModuleDefinition, ModuleType } from './types.js';

/**
 * Associates a portable module definition with a module type.
 *
 * @param moduleType Module class that should receive runtime module metadata.
 * @param definition Module definition contract (`imports`, `providers`, `controllers`, `exports`, etc.).
 * @returns The same `moduleType` reference for fluent helper composition.
 */
export function defineModule<T extends ModuleType>(moduleType: T, definition: ModuleDefinition): T {
  defineRuntimeModuleMetadata(moduleType, definition);

  return moduleType;
}
