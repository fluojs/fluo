/** Describes one file emitted by a generator factory before it is written to disk. */
export interface GeneratedFile {
  content: string;
  path: string;
}

/** Optional generation flags that influence overwrite behavior, target placement, plan previews, and sibling-aware templates. */
export interface GenerateOptions {
  /** Preview planned writes and module updates without mutating the workspace. */
  dryRun?: boolean;
  force?: boolean;
  hasRepo?: boolean;
  hasService?: boolean;
  /**
   * Feature or slice directory that should receive feature-local files such as request DTOs.
   */
  targetFeature?: string;
}

/**
 * Produces the in-memory files for one schematic/resource pair.
 */
export type GeneratorFactory = (name: string, options?: GenerateOptions) => GeneratedFile[];

/** Registry shape used by generator manifests to bind a factory to CLI metadata. */
export interface GeneratorRegistration {
  collectionId?: string;
  factory: GeneratorFactory;
  description?: string;
}

/** Describes a supported option for generator metadata, help output, and docs alignment tests. */
export interface GeneratorOptionSchema {
  aliases: readonly string[];
  description: string;
  name: string;
  value: 'boolean' | 'path';
}
