export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';
export type DependencySource = 'local' | 'published';
export type BootstrapShape = 'application' | 'microservice';
export type BootstrapRuntime = 'node';
export type BootstrapPlatform = 'fastify' | 'none';
export type BootstrapTransport = 'grpc' | 'http' | 'kafka' | 'mqtt' | 'nats' | 'rabbitmq' | 'redis' | 'redis-streams' | 'tcp';
export type BootstrapToolingPreset = 'standard';

export interface BootstrapTopology {
  deferred: boolean;
  mode: 'single-package';
}

export interface BootstrapSchema {
  platform: BootstrapPlatform;
  runtime: BootstrapRuntime;
  shape: BootstrapShape;
  tooling: BootstrapToolingPreset;
  topology: BootstrapTopology;
  transport: BootstrapTransport;
}

export interface BootstrapOptions extends BootstrapSchema {
  dependencySource?: DependencySource;
  force?: boolean;
  packageManager: PackageManager;
  projectName: string;
  repoRoot?: string;
  skipInstall?: boolean;
  targetDirectory: string;
}

export interface BootstrapPrompt {
  key: keyof BootstrapAnswers;
  label: string;
}

export interface BootstrapAnswers extends BootstrapSchema {
  packageManager: PackageManager;
  projectName: string;
  targetDirectory: string;
}

export interface NewCommandOptions {
  dependencySource?: DependencySource;
  force?: boolean;
  repoRoot?: string;
  skipInstall?: boolean;
}
