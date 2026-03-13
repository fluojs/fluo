export type OrmFamily = 'Drizzle' | 'Prisma';
export type DatabaseFamily = 'MySQL' | 'PostgreSQL';
export type PackageManager = 'npm' | 'pnpm' | 'yarn';
export type SupportTier = 'official' | 'preview' | 'recommended';
export type DependencySource = 'local' | 'published';

export interface CreateKonektiOptions {
  database: DatabaseFamily;
  dependencySource?: DependencySource;
  orm: OrmFamily;
  packageManager: PackageManager;
  projectName: string;
  repoRoot?: string;
  skipInstall?: boolean;
  targetDirectory: string;
}

export interface CreatePrompt {
  key: keyof CreateKonektiAnswers | 'tierNote';
  label: string;
}

export interface CreateKonektiAnswers {
  database: DatabaseFamily;
  orm: OrmFamily;
  packageManager: PackageManager;
  projectName: string;
  targetDirectory: string;
}

export interface NewCommandOptions {
  dependencySource?: DependencySource;
  repoRoot?: string;
  skipInstall?: boolean;
}
