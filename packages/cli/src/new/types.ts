/** Supported package managers for generated starters. */
export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';
/** Source for resolving starter package dependencies. */
export type DependencySource = 'local' | 'published';
/** Supported starter shapes for `fluo new`. */
export type BootstrapShape = 'application' | 'microservice' | 'mixed';
/** Supported runtime families for the current starter matrix. */
export type BootstrapRuntime = 'node';
/** Supported platform adapters for the current starter matrix. */
export type BootstrapPlatform = 'fastify' | 'none';
/** Supported transport families for the current starter matrix. */
export type BootstrapTransport = 'grpc' | 'http' | 'kafka' | 'mqtt' | 'nats' | 'rabbitmq' | 'redis' | 'redis-streams' | 'tcp';
/** Supported tooling presets for the current starter matrix. */
export type BootstrapToolingPreset = 'standard';

/** Topology settings for the generated starter layout. */
export interface BootstrapTopology {
  deferred: boolean;
  mode: 'single-package';
}

/** Shape-first scaffold schema resolved before file generation. */
export interface BootstrapSchema {
  platform: BootstrapPlatform;
  runtime: BootstrapRuntime;
  shape: BootstrapShape;
  tooling: BootstrapToolingPreset;
  topology: BootstrapTopology;
  transport: BootstrapTransport;
}

/** Full scaffold options used by the file emitter and post-write steps. */
export interface BootstrapOptions extends BootstrapSchema {
  dependencySource?: DependencySource;
  force?: boolean;
  initializeGit?: boolean;
  installDependencies?: boolean;
  packageManager: PackageManager;
  projectName: string;
  repoRoot?: string;
  skipInstall?: boolean;
  targetDirectory: string;
}

/** Prompt descriptor for bootstrap answer collection. */
export interface BootstrapPrompt {
  key: keyof BootstrapAnswers;
  label: string;
}

/** Resolved answers shared by flag-driven, interactive, and programmatic flows. */
export interface BootstrapAnswers extends BootstrapSchema {
  initializeGit: boolean;
  installDependencies: boolean;
  packageManager: PackageManager;
  projectName: string;
  targetDirectory: string;
}

/** Programmatic overrides for `runNewCommand(...)`. */
export interface NewCommandOptions {
  dependencySource?: DependencySource;
  force?: boolean;
  initializeGit?: boolean;
  installDependencies?: boolean;
  repoRoot?: string;
  skipInstall?: boolean;
}
