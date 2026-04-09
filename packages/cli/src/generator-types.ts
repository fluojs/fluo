/** Describes one file emitted by a generator factory before it is written to disk. */
export interface GeneratedFile {
  content: string;
  path: string;
}

/** Optional generation flags that influence overwrite behavior and sibling-aware templates. */
export interface GenerateOptions {
  force?: boolean;
  hasRepo?: boolean;
  hasService?: boolean;
}

/**
 * Produces the in-memory files for one schematic/resource pair.
 */
export type GeneratorFactory = (name: string, options?: GenerateOptions) => GeneratedFile[];

/** Registry shape used by generator manifests to bind a factory to CLI metadata. */
export interface GeneratorRegistration {
  factory: GeneratorFactory;
  description?: string;
}
