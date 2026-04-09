import type { GeneratorKind as ManifestGeneratorKind } from './generators/manifest.js';

export type { GenerateOptions, GeneratedFile } from './generator-types.js';

/** Union of all generator kinds accepted by the CLI generate workflow. */
export type GeneratorKind = ManifestGeneratorKind;

/**
 * Minimal registration metadata used by tests and helper utilities that reason about module wiring.
 */
export interface ModuleRegistration {
  className: string;
  kind: 'controller' | 'provider';
}
