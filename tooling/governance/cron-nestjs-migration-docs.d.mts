export interface CronNestjsMigrationOverlapProseClause {
  readonly name: string;
  readonly pattern: RegExp;
}

export const cronNestjsMigrationOverlapProseSurfaces: readonly string[];

export const cronNestjsMigrationOverlapProseClauses: Readonly<
  Record<'en' | 'ko', readonly CronNestjsMigrationOverlapProseClause[]>
>;

export function enforceCronNestjsMigrationDocs(
  readText?: (relativePath: string) => string,
): void;
