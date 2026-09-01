import { resolve } from 'node:path';

import { renderAliasList, renderHelpTable } from '../help.js';
import {
  getWarningCategoryLabel,
  groupWarningsByCategory,
  MIGRATION_TRANSFORMS,
  type MigrationReport,
  type MigrationTransformKind,
  renderTransformList,
  runNestJsMigration,
} from '../transforms/nestjs-migrate.js';
import { MIGRATION_TRANSFORM_CLI_TOKENS, parseMigrationTransformList } from './migration-transform-tokens.js';

type CliStream = {
  write(message: string): unknown;
};

/**
 * Runtime configuration for the migrate command.
 */
export interface MigrateCommandRuntimeOptions {
  /** Current working directory for path resolution. */
  cwd?: string;
  /** Custom stream for error output. */
  stderr?: CliStream;
  /** Custom stream for standard output. */
  stdout?: CliStream;
}

type MigrateOptionHelpEntry = {
  aliases: string[];
  description: string;
  option: string;
};

type ParsedMigrateArgs = {
  apply: boolean;
  json: boolean;
  path: string;
  transforms: Set<MigrationTransformKind>;
};

const MIGRATE_OPTION_HELP: MigrateOptionHelpEntry[] = [
  {
    aliases: ['-a'],
    description: 'Apply file changes. Dry-run is the default mode.',
    option: '--apply',
  },
  {
    aliases: [],
    description: 'Emit a machine-readable JSON migration report to stdout. Errors still go to stderr.',
    option: '--json',
  },
  {
    aliases: [],
    description: `Run only selected transforms. Available: ${MIGRATION_TRANSFORM_CLI_TOKENS.join(', ')}.`,
    option: '--only <comma-list>',
  },
  {
    aliases: [],
    description: `Skip selected transforms. Available: ${MIGRATION_TRANSFORM_CLI_TOKENS.join(', ')}.`,
    option: '--skip <comma-list>',
  },
  {
    aliases: ['-h'],
    description: 'Show help for the migrate command.',
    option: '--help',
  },
];

function isHelpFlag(value: string | undefined): boolean {
  return value === '--help' || value === '-h';
}

function parseArgs(argv: string[]): ParsedMigrateArgs {
  let pathArgument: string | undefined;
  let apply = false;
  let json = false;
  let onlyTransforms: MigrationTransformKind[] | undefined;
  let skipTransforms: MigrationTransformKind[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--apply' || arg === '-a') {
      apply = true;
      continue;
    }

    if (arg === '--json') {
      if (json) {
        throw new Error('Duplicate --json option.');
      }

      json = true;
      continue;
    }

    if (arg === '--only' || arg === '--skip') {
      const rawValue = argv[index + 1];
      if (!rawValue || rawValue.startsWith('-')) {
        throw new Error(`Expected ${arg} to have a comma-separated value.`);
      }

      const parsed = parseMigrationTransformList(rawValue, arg);
      if (arg === '--only') {
        if (onlyTransforms) {
          throw new Error('Duplicate --only option.');
        }

        onlyTransforms = parsed;
      } else {
        skipTransforms = [...skipTransforms, ...parsed];
      }

      index += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option for migrate command: ${arg}`);
    }

    if (pathArgument) {
      throw new Error(`Unexpected extra positional argument: ${arg}`);
    }

    pathArgument = arg;
  }

  if (!pathArgument) {
    throw new Error(migrateUsage());
  }

  const enabled = new Set<MigrationTransformKind>(onlyTransforms ?? MIGRATION_TRANSFORMS);
  for (const skipped of skipTransforms) {
    enabled.delete(skipped);
  }

  if (enabled.size === 0) {
    throw new Error('No transforms remain after applying --only/--skip filters.');
  }

  return {
    apply,
    json,
    path: pathArgument,
    transforms: enabled,
  };
}

function renderJsonReport(report: MigrationReport, transforms: readonly MigrationTransformKind[]): string {
  return `${JSON.stringify(
    {
      command: 'migrate',
      mode: report.apply ? 'apply' : 'dry-run',
      apply: report.apply,
      dryRun: !report.apply,
      transforms,
      scannedFiles: report.scannedFiles,
      changedFiles: report.changedFiles,
      warningCount: report.warningCount,
      files: report.fileResults.map((fileResult) => ({
        filePath: fileResult.filePath,
        changed: fileResult.changed,
        appliedTransforms: fileResult.appliedTransforms,
        warningCount: fileResult.warnings.length,
        warnings: fileResult.warnings.map((warning) => ({
          category: warning.category,
          categoryLabel: getWarningCategoryLabel(warning.category),
          filePath: warning.filePath,
          line: warning.line,
          message: warning.message,
        })),
      })),
    },
    null,
    2,
  )}\n`;
}

/**
 * Returns usage information for the migrate command.
 *
 * @returns Formatted help text including usage and options.
 */
export function migrateUsage(): string {
  return [
    'Usage: fluo migrate <path> [options]',
    '',
    'Options',
    renderHelpTable(MIGRATE_OPTION_HELP, [
      { header: 'Option', render: (entry) => entry.option },
      { header: 'Aliases', render: (entry) => renderAliasList(entry.aliases) },
      { header: 'Description', render: (entry) => entry.description },
    ]),
    '',
    'Next steps:',
    '  Review warnings in the output, then run again with --apply to write changes.',
    '',
    'Docs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/migrate-from-nestjs.md',
  ].join('\n');
}

/**
 * Executes the migrate command to transform NestJS projects into fluo.
 *
 * @param argv Command line arguments.
 * @param runtime Optional custom runtime configuration for output streams and working directory.
 * @returns Exit code (0 for success, 1 for failure).
 */
export async function runMigrateCommand(argv: string[], runtime: MigrateCommandRuntimeOptions = {}): Promise<number> {
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;

  try {
    if (argv.some(isHelpFlag)) {
      stdout.write(`${migrateUsage()}\n`);
      return 0;
    }

    const parsed = parseArgs(argv);
    const targetPath = resolve(runtime.cwd ?? process.cwd(), parsed.path);
    const transforms = [...parsed.transforms];
    const report = runNestJsMigration({
      apply: parsed.apply,
      enabledTransforms: parsed.transforms,
      targetPath,
    });

    if (parsed.json) {
      stdout.write(renderJsonReport(report, transforms));
      return 0;
    }

    stdout.write(`Mode: ${parsed.apply ? 'apply' : 'dry-run'}\n`);
    stdout.write(`Enabled transforms: ${renderTransformList(transforms)}\n`);
    stdout.write(`Scanned files: ${report.scannedFiles}\n`);
    stdout.write(`Changed files: ${report.changedFiles}\n`);
    stdout.write(`Warnings: ${report.warningCount}\n`);

    if (!parsed.apply && report.changedFiles > 0) {
      stdout.write('Run again with --apply to write transformed files.\n');
    }

    const changedPaths = report.fileResults
      .filter((fileResult) => fileResult.changed)
      .map((fileResult) => fileResult.filePath);

    if (changedPaths.length > 0) {
      stdout.write('\nAutomated rewrites:\n');
      for (const filePath of changedPaths) {
        stdout.write(`  ${filePath}\n`);
      }
    }

    const allWarnings = report.fileResults.flatMap((fileResult) => fileResult.warnings);
    if (allWarnings.length > 0) {
      stdout.write('\nManual follow-up required:\n');
      const grouped = groupWarningsByCategory(allWarnings);
      for (const [category, warnings] of grouped) {
        stdout.write(`\n  [${getWarningCategoryLabel(category)}]\n`);
        for (const warning of warnings) {
          stdout.write(`  - ${warning.filePath}:${warning.line} ${warning.message}\n`);
        }
      }
    }

    if (report.warningCount === 0 && report.changedFiles > 0) {
      stdout.write('\nAll transforms applied cleanly. No manual follow-ups detected.\n');
    }

    if (report.warningCount > 0) {
      stdout.write('\nDocs: https://github.com/fluojs/fluo/tree/main/docs/getting-started/migrate-from-nestjs.md\n');
      stdout.write('Use the post-codemod checklist in the migration guide to address each warning category.\n');
    }

    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }
}
