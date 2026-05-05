/** Describes one file emitted by a generator factory before it is written to disk. */
export interface GeneratedFile {
  content: string;
  path: string;
}

/** Optional generation flags that influence overwrite behavior, target placement, plan previews, and sibling-aware templates. */
export interface GenerateOptions {
  /** Preview planned writes and module updates without mutating the workspace. */
  dryRun?: boolean;
  /** Import specifier used by generated e2e tests to load the application root module. */
  e2eRootModuleImport?: string;
  /** Overwrite existing generated files instead of skipping them. */
  force?: boolean;
  /** Indicates that a repository sibling exists and should be imported by service templates. */
  hasRepo?: boolean;
  /** Indicates that a service sibling exists and should be imported by controller templates. */
  hasService?: boolean;
  /**
   * Feature or slice directory that should receive feature-local files such as request DTOs.
   */
  targetFeature?: string;
  /** Emit resource-level slice test coverage with provider override examples. */
  withSliceTest?: boolean;
  /** Emit module-level test coverage for schematics that support companion tests. */
  withTest?: boolean;
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
