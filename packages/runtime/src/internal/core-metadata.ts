import type { InjectionToken, Token } from '@fluojs/core';
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
  inject?: InjectionToken[];
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

/**
 * Writes runtime-visible module metadata through the runtime-owned core metadata seam.
 *
 * @param target Module constructor that should receive the metadata snapshot.
 * @param metadata Module metadata used by decorators, tests, or dynamic module normalization.
 */
export function defineRuntimeModuleMetadata(target: Function, metadata: RuntimeWritableModuleMetadata): void {
  definePeerModuleMetadata(target, metadata);
}

/**
 * Writes runtime-visible class DI metadata through the runtime-owned core metadata seam.
 *
 * @param target Class constructor that should receive DI metadata.
 * @param metadata DI metadata used by explicit runtime metadata-version tests.
 */
export function defineRuntimeClassDiMetadata(target: Function, metadata: RuntimeWritableClassDiMetadata): void {
  definePeerClassDiMetadata(target, metadata);
}

/**
 * Reads runtime-visible class DI metadata without spreading peer internal imports.
 *
 * @param target Class constructor whose effective DI metadata should be read.
 * @returns The effective class DI metadata when present.
 */
export function getRuntimeClassDiMetadata(target: Function): RuntimeClassDiMetadata | undefined {
  return getPeerClassDiMetadata(target) as RuntimeClassDiMetadata | undefined;
}

/**
 * Reads own runtime-visible class DI metadata without inherited metadata fallback.
 *
 * @param target Class constructor whose own DI metadata should be read.
 * @returns The own class DI metadata when present.
 */
export function getOwnRuntimeClassDiMetadata(target: Function): RuntimeClassDiMetadata | undefined {
  return getPeerOwnClassDiMetadata(target) as RuntimeClassDiMetadata | undefined;
}

/**
 * Reads the current module metadata version for runtime compile-cache keys.
 *
 * @returns Monotonic module metadata version maintained by the core metadata store.
 */
export function getRuntimeModuleMetadataVersion(): number {
  return getPeerModuleMetadataVersion();
}

/**
 * Reads the current class DI metadata version for runtime compile-cache keys.
 *
 * @returns Monotonic class DI metadata version maintained by the core metadata store.
 */
export function getRuntimeClassDiMetadataVersion(): number {
  return getPeerClassDiMetadataVersion();
}

/**
 * Reads runtime-visible module metadata during graph compilation.
 *
 * @param target Module constructor whose metadata should be read.
 * @returns Module metadata normalized by the core metadata store.
 */
export function getRuntimeModuleMetadata(target: Function): RuntimeModuleMetadata {
  return getPeerModuleMetadata(target) as RuntimeModuleMetadata;
}
