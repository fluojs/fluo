export type PackageManager = 'npm' | 'pnpm' | 'yarn';
export type DependencySource = 'local' | 'published';

export interface BootstrapOptions {
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

export interface BootstrapAnswers {
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
