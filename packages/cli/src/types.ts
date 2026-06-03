import type { GeneratorKind as ManifestGeneratorKind } from './generators/manifest.js';

export type { GenerateOptions, GeneratedFile } from './generator-types.js';

/** Union of all generator kinds accepted by the CLI generate workflow. */
export type GeneratorKind = ManifestGeneratorKind;

/**
 * Minimal registration metadata used by tests and helper utilities that reason about module wiring.
 *
 * @remarks Middleware registrations target the module `middleware` array; controllers and providers
 * target their matching module metadata arrays.
 */
export interface ModuleRegistration {
  /** Class name inserted into the target module metadata array. */
  className: string;
  /** Module metadata kind used by the generated class. */
  kind: 'controller' | 'provider' | 'middleware';
}
