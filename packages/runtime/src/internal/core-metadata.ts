import type { Token } from '@fluojs/core';
import {
  defineClassDiMetadata as definePeerClassDiMetadata,
  defineModuleMetadata as definePeerModuleMetadata,
  getClassDiMetadata as getPeerClassDiMetadata,
  getClassDiMetadataVersion as getPeerClassDiMetadataVersion,
  getModuleMetadata as getPeerModuleMetadata,
  getModuleMetadataVersion as getPeerModuleMetadataVersion,
  getOwnClassDiMetadata as getPeerOwnClassDiMetadata,
} from '@fluojs/core/internal';
import type { Scope } from '@fluojs/di';

import type { ModuleDefinition } from '../types.js';

/** Runtime-local view of DI forward references consumed by module graph compilation. */
export type RuntimeForwardRef = { __forwardRef__: true; forwardRef: () => Token };
/** Runtime-local view of optional DI tokens consumed by module graph compilation. */
export type RuntimeOptionalToken = { __optional__: true; token: Token };
/** Runtime-local union for DI dependency metadata consumed by module graph compilation. */
export type RuntimeInjectionToken = Token | RuntimeForwardRef | RuntimeOptionalToken;

/** Runtime-local class DI metadata view used for provider scope and dependency validation. */
export interface RuntimeClassDiMetadata {
  inject?: readonly RuntimeInjectionToken[];
  scope?: Scope;
}

/** Runtime-local writable class DI metadata shape used by explicit metadata-version tests. */
export interface RuntimeWritableClassDiMetadata {
  inject?: Token[];
  scope?: Scope;
}

/** Runtime-local module metadata view used while compiling application module graphs. */
export type RuntimeModuleMetadata = Pick<
  ModuleDefinition,
  'controllers' | 'exports' | 'global' | 'imports' | 'middleware' | 'providers'
>;

/** Runtime-local writable module metadata shape used by decorators, tests, and dynamic module normalization. */
export interface RuntimeWritableModuleMetadata {
  controllers?: unknown[];
  exports?: unknown[];
  global?: boolean;
  imports?: unknown[];
  middleware?: unknown[];
  providers?: unknown[];
}

/** Runtime-owned seam for writing module metadata during dynamic module normalization. */
export function defineRuntimeModuleMetadata(target: Function, metadata: RuntimeWritableModuleMetadata): void {
  definePeerModuleMetadata(target, metadata);
}

/** Runtime-owned seam for tests that need to mutate class DI metadata versions explicitly. */
export function defineRuntimeClassDiMetadata(target: Function, metadata: RuntimeWritableClassDiMetadata): void {
  definePeerClassDiMetadata(target, metadata);
}

/** Runtime-owned seam for reading class DI metadata without spreading peer internal imports. */
export function getRuntimeClassDiMetadata(target: Function): RuntimeClassDiMetadata | undefined {
  return getPeerClassDiMetadata(target) as RuntimeClassDiMetadata | undefined;
}

/** Runtime-owned seam for reading own class DI metadata without spreading peer internal imports. */
export function getOwnRuntimeClassDiMetadata(target: Function): RuntimeClassDiMetadata | undefined {
  return getPeerOwnClassDiMetadata(target) as RuntimeClassDiMetadata | undefined;
}

/** Runtime-owned seam for module metadata versioning used by compile-cache keys. */
export function getRuntimeModuleMetadataVersion(): number {
  return getPeerModuleMetadataVersion();
}

/** Runtime-owned seam for class DI metadata versioning used by compile-cache keys. */
export function getRuntimeClassDiMetadataVersion(): number {
  return getPeerClassDiMetadataVersion();
}

/** Runtime-owned seam for reading module metadata during graph compilation. */
export function getRuntimeModuleMetadata(target: Function): RuntimeModuleMetadata {
  return getPeerModuleMetadata(target) as RuntimeModuleMetadata;
}
