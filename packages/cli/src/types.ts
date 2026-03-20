import type { GeneratorKind as ManifestGeneratorKind } from './generators/manifest.js';

export type { GenerateOptions, GeneratedFile, GeneratorFactory, GeneratorRegistration } from './generator-types.js';

export type GeneratorKind = ManifestGeneratorKind;

export interface ModuleRegistration {
  className: string;
  kind: 'controller' | 'provider';
}
